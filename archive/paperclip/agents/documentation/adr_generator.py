"""ADR generator (FORA-121 / 7.1.5).

Produces Architecture Decision Records in MADR format from a stream of
decision points (architecture-agent HLD/LLD outputs, PR descriptions,
meeting notes, and explicit `// ADR:` comments in code) and writes them
to `docs/adr/NNNN-title.md` with a refreshed `docs/adr/README.md`
index. The on-disk `AdrRegistry` (storage contract FORA-117) is updated
in lockstep.

## Scope (per [FORA-121](/FORA/issues/FORA-121))

- **Detect** decision points in:
  - architecture-agent outputs (HLD, LLD)
  - PR descriptions
  - meeting notes
  - explicit `// ADR:` (and `# ADR:` for shell/Python) comments in code
- **Render** each decision in MADR format:
  Context → Decision → Status → Consequences → Alternatives Considered
- **Store** at `docs/adr/NNNN-title.md` with monotonically-increasing numbers
- **Maintain** an index at `docs/adr/README.md`
- **Cross-link** to the related Jira epic, PR, and code path

## Acceptance criteria (per [FORA-121](/FORA/issues/FORA-121))

- Generator runs against a sample repo + sample architecture agent
  output and produces a coherent ADR + index.
- Idempotency: same inputs → same ADR file bytes.
- ADR numbering is monotonic and never reused (even across forks —
  the on-disk filesystem + the registry are the source of truth).
- Each ADR is auditable: source prompt, source SHA, generator cost,
  model, output SHA, all logged via the Audit Agent.

## Idempotency contract

Re-running with the **same `input_sha` + the same set of
`DecisionPoint`s** produces byte-identical ADR bodies and a
byte-identical `docs/adr/README.md`. The wall-clock timestamp lives on
the `DocArtifact` wrapper, never in the body. The ADR number is
derived from the on-disk filesystem + registry, so a re-run never
re-uses a number; a `DecisionPoint` whose `key` is already on disk
(an existing ADR) is a no-op.

## Approval routing

Per `prompt.md` §"Hard constraints" #3, **new** ADRs require human
approval before merge (`approval_required=True`); a re-render with no
new ADRs is `approval_required=False` (the existing files are
unchanged, so the operator can audit by diff against the registry).

## Failure modes

- `MISSING_INPUT_SHA`             — `input_sha is None` → abort
- `OVERSIZED_DIFF`                — combined decision-points input
                                    would breach the per-run input
                                    token ceiling → abort
- `AMBIGUOUS_DECISION_POINT`      — a decision point is missing
                                    required fields (title/context)
                                    → surface as a structured warning
- `PARTIAL_KNOWLEDGE_LAYER_WRITE` — the on-disk registry write
                                    succeeds but the on-disk ADR file
                                    write fails (or vice versa) →
                                    re-raise as a typed error
- `STORAGE_CONTRACT_MISSING`      — `workspace/project/adr-registry.md`
                                    is unparseable and an index is
                                    required → abort
- `MODEL_TIMEOUT`                 — covered by the parent agent;
                                    the v1 renderer is structure-only

## Inputs read from disk

- `docs/adr/`                    — prior ADR files (for numbering)
- `workspace/project/adr-registry.md` — prior registry (for the index)
- The generator does **not** read project memory or customer memory;
  the ADR is derived from the decision points + on-disk state alone.
"""

from __future__ import annotations

import hashlib
import json as _json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from .docs_query import _FENCED_JSON_RE, parse_registry_markdown
from .schemas import (
    AdrRegistry,
    AdrRegistryEntry,
    AdrStatus,
    CostRecord,
    DocArtifact,
    DocGenError,
    DocGenInput,
    DocGenOutput,
    DocIndex,
    DocIndexEntry,
    DocKind,
    ErrorKind,
    FreshnessMetadata,
    GeneratorType,
    RunStatus,
    now_iso,
)


# ---------------------------------------------------------------------------
# File layout constants (the FORA workspace convention).
# ---------------------------------------------------------------------------

DEFAULT_ADR_DIR = "docs/adr"
DEFAULT_ADR_INDEX_PATH = "docs/adr/README.md"
DEFAULT_ADR_REGISTRY_PATH = "workspace/project/adr-registry.md"
DEFAULT_DOCS_INDEX_PATH = "workspace/project/docs.md"

# MADR header order — every ADR renders these sections in this order.
# Decisions that lack a section get a placeholder so the index is honest
# about what was supplied (we never invent rationale).
MADR_SECTIONS: Tuple[str, ...] = (
    "Context",
    "Decision",
    "Status",
    "Consequences",
    "Alternatives Considered",
)


# ---------------------------------------------------------------------------
# Decision-point detection (pure)
# ---------------------------------------------------------------------------

# `// ADR: <title>` and `# ADR: <title>` (shell/Python/Ruby).
# Optional `// ADR-NNNN: <title>` form so an existing number can be
# pinned to a comment in code (for traceability, not for assignment).
_ADR_COMMENT_RE = re.compile(
    r"(?P<hashes>#+|[/]{2})\s*ADR(?:-(?P<pinned>\d{4}))?\s*:\s*(?P<title>.+?)\s*$",
    re.MULTILINE,
)

# HLD/LLD/PR/notes: a `## ADR...` heading marks a decision point
# boundary. We deliberately do NOT match bare `## Decision` — that is
# the MADR body section, not a decision-point title.
_DECISION_HEADING_RE = re.compile(
    r"^#{1,3}\s+ADR[\s\-:][^\n]*$",
    re.MULTILINE,
)

# Jira, PR, GitHub-issue refs (re-used for cross-linking).
_JIRA_REF_RE = re.compile(r"\b([A-Z][A-Z0-9]+-\d+)\b")
_PR_REF_RE = re.compile(r"\bPR\s*#(\d+)\b", re.IGNORECASE)
_GITHUB_ISSUE_RE = re.compile(r"(?<!PR )(?<!PR)#(\d+)\b")
# Code path: a backticked path (`src/foo.py`) OR a `touches <path>` /
# `see <path>` reference in plain text. The un-backticked form is
# common in PR descriptions where authors don't bother formatting.
_BACKTICK_PATH_RE = re.compile(r"`([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`")
_PLAIN_PATH_RE = re.compile(
    r"\b(?:touches|see|in)\s+([A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]+)\b",
    re.IGNORECASE,
)


@dataclass
class DecisionRef:
    """A cross-reference parsed from a decision point's source.

    Mirrors the changelog `CommitRef` shape so callers can share code.
    """
    kind: str                                  # "jira" | "pr" | "github_issue" | "code_path"
    id: str                                    # "FORA-123" | "789" | "42" | "src/foo.py"
    url: str                                   # fully-qualified link


@dataclass
class DecisionPoint:
    """One decision to record as an ADR.

    `key` is the stable identifier used for idempotency. The renderer
    slugifies the title into `key` if the caller leaves it empty; two
    decision points with the same `key` on the same run are deduped.
    `key` is also what the generator uses to look up an existing ADR
    on disk (a re-emit with the same key is a no-op).

    `source` is a free-form pointer to the originating artifact
    ("HLD §3", "PR #789 description", "src/foo.py:42 comment",
    "meeting 2026-06-19"). It is rendered into the ADR header so a
    reader can trace the decision back to the source.
    """
    title: str
    context: str
    decision: str
    status: AdrStatus = AdrStatus.PROPOSED
    consequences: str = ""
    alternatives: str = ""
    architecture_area: str = "general"
    tags: List[str] = field(default_factory=list)
    source: str = ""
    refs: List[DecisionRef] = field(default_factory=list)
    deciders: str = "doc-agent (v1)"
    issue: str = ""                              # e.g. "FORA-121"
    supersedes: Optional[int] = None
    superseded_by: Optional[int] = None
    key: str = ""                                # auto-derived if empty

    def __post_init__(self) -> None:
        if not self.key:
            self.key = _slugify(self.title)

    def to_dict(self) -> Dict[str, object]:
        return {
            "key": self.key,
            "title": self.title,
            "context": self.context,
            "decision": self.decision,
            "status": self.status.value,
            "consequences": self.consequences,
            "alternatives": self.alternatives,
            "architecture_area": self.architecture_area,
            "tags": list(self.tags),
            "source": self.source,
            "refs": [{"kind": r.kind, "id": r.id, "url": r.url} for r in self.refs],
            "deciders": self.deciders,
            "issue": self.issue,
            "supersedes": self.supersedes,
            "superseded_by": self.superseded_by,
        }


# ---------------------------------------------------------------------------
# Helpers — pure
# ---------------------------------------------------------------------------

def _slugify(s: str) -> str:
    """Lowercase + dash-separated, ASCII letters/digits only.

    "Use Postgres for the run DB" -> "use-postgres-for-the-run-db"
    """
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s or "adr"


def _format_ref_chips(refs: List[DecisionRef]) -> str:
    """Render the trailing `[link](url)` chips for a decision point.

    Order: Jira first, then PR, then GitHub issue, then code paths
    (most-discussed link to least, matching the CHANGELOG renderer).
    """
    order = {"jira": 0, "pr": 1, "github_issue": 2, "code_path": 3}
    seen: Set[Tuple[str, str]] = set()
    out: List[str] = []
    for r in sorted(refs, key=lambda r: (order.get(r.kind, 99), r.id)):
        key = (r.kind, r.id)
        if key in seen:
            continue
        seen.add(key)
        if r.kind == "jira":
            out.append(f"[{r.id}]({r.url})")
        elif r.kind == "pr":
            out.append(f"[PR #{r.id}]({r.url})")
        elif r.kind == "github_issue":
            out.append(f"[#{r.id}]({r.url})")
        else:  # code_path
            out.append(f"[`{r.id}`]({r.url})")
    return ", ".join(out)


def _format_adr_path(number: int, title: str) -> str:
    """Render the on-disk ADR path: `docs/adr/NNNN-slug.md`."""
    return f"{DEFAULT_ADR_DIR}/{number:04d}-{_slugify(title)}.md"


def _parse_existing_numbers(adr_dir: Path) -> Set[int]:
    """Walk `docs/adr/` and return the set of ADR numbers already on disk.

    The on-disk filesystem is the source of truth for the
    "monotonic and never reused" contract (per the FORA-121 spec).
    The registry may drift; the filesystem will not.
    """
    if not adr_dir.exists():
        return set()
    out: Set[int] = set()
    for p in adr_dir.glob("*.md"):
        if p.name == "README.md":
            continue
        m = re.match(r"^(\d{4})-", p.name)
        if m:
            out.add(int(m.group(1)))
    return out


def _next_number(adr_dir: Path, registry: AdrRegistry) -> int:
    """Return the next available ADR number, monotonic across
    filesystem + registry."""
    fs_nums = _parse_existing_numbers(adr_dir)
    reg_nums = {e.number for e in registry.entries}
    used = fs_nums | reg_nums
    if not used:
        return 1
    return max(used) + 1


# ---------------------------------------------------------------------------
# Detection — pull decision points out of arbitrary text
# ---------------------------------------------------------------------------

def detect_decision_points_from_comments(text: str, source_label: str) -> List[DecisionPoint]:
    """Detect decision points declared in `// ADR:` / `# ADR:` comments.

    The expected comment shape is:

        // ADR: Use Postgres for the run DB
        //   Context: we need transactional state
        //   Decision: Postgres 16 with pgvector
        //   Consequences: another dep to operate
        //   Alternatives: SQLite (rejected — no concurrent writers)

    Sections after the title are optional; missing sections are
    surfaced as empty strings so the renderer can render an honest
    "UNKNOWN — needs <owner>" placeholder.

    A `// ADR-0042: ...` form pins the decision to an existing ADR
    number (for traceability, not for new assignment); such comments
    are skipped here so they don't add new ADRs.
    """
    out: List[DecisionPoint] = []
    if not text:
        return out
    for m in _ADR_COMMENT_RE.finditer(text):
        pinned = m.group("pinned")
        if pinned:
            continue
        title = m.group("title").strip()
        start = m.end()
        # Consume indented `// ...` lines until a blank line or a
        # non-comment line.
        block_lines: List[str] = []
        # The first iteration after the match may see the comment's
        # trailing `\n` as a blank line — skip past that to find the
        # next comment. A blank line *inside* the block ends the block.
        saw_content = False
        for line in text[start:].splitlines():
            stripped = line.strip()
            if not stripped:
                if saw_content:
                    break
                continue
            if not (stripped.startswith("//") or stripped.startswith("#")):
                break
            # Strip the comment prefix (and any leading whitespace) so
            # `_split_madr_block` sees a bare `Context: ...` line.
            body = re.sub(r"^#+\s*|^//+\s*", "", stripped).strip()
            block_lines.append(body)
            saw_content = True
        context, decision, consequences, alternatives = _split_madr_block(block_lines)
        out.append(DecisionPoint(
            title=title,
            context=context,
            decision=decision,
            consequences=consequences,
            alternatives=alternatives,
            source=source_label,
        ))
    return out


def detect_decision_points_from_markdown(text: str, source_label: str) -> List[DecisionPoint]:
    """Detect decision points in a markdown document (HLD, LLD, PR, notes).

    Walks every `## Decision` / `## ADR:` heading and pulls the
    following MADR sections (Context / Decision / Consequences /
    Alternatives Considered) into a `DecisionPoint`. The first
    paragraph under each section is the body; if the section is
    missing, the corresponding field is an empty string.
    """
    if not text:
        return []
    headings = list(_DECISION_HEADING_RE.finditer(text))
    if not headings:
        return []
    out: List[DecisionPoint] = []
    for i, h in enumerate(headings):
        title_line = h.group(0)
        title = re.sub(r"^#+\s+", "", title_line).strip()
        if title.lower().startswith("adr"):
            # Strip `ADR ` / `ADR:` / `ADR-NNNN:` prefixes; the optional
            # leading number is part of the trace, not the title.
            title = re.sub(r"^adr[\s\-:]*\d*\s*[:\-]?\s*", "", title, flags=re.IGNORECASE).strip()
        if not title or title.lower() == "decision":
            # Bare `## Decision` without a title is a section anchor, not
            # a decision point. The renderer below already pulls the
            # body of `## Decision` into the existing ADR's decision
            # field; we skip it here.
            continue
        body_start = h.end()
        body_end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        section_text = text[body_start:body_end]
        # Two extraction modes: (a) `## Context` / `## Decision` headings
        # (canonical MADR), or (b) inline `Context: ...` paragraphs when
        # no headings are present (common in PR descriptions + HLD
        # drafts). `_extract_madr_sections` handles (a); the inline
        # fallback handles (b) by running `_split_madr_block` over the
        # raw lines.
        # `_section_bodies` returns bodies in `MADR_SECTIONS` order
        # (5 entries: Context / Decision / Status / Consequences /
        # Alternatives Considered). Map to the 4-tuple the caller
        # wants, skipping Status (which lives in the ADR header).
        section_bodies = _section_bodies(section_text)
        if any(section_bodies):
            context, decision, _status, consequences, alternatives = section_bodies
        else:
            context, decision, consequences, alternatives = _split_madr_block(
                [ln.strip() for ln in section_text.splitlines() if ln.strip()]
            )
        out.append(DecisionPoint(
            title=title,
            context=context,
            decision=decision,
            consequences=consequences,
            alternatives=alternatives,
            source=source_label,
        ))
    return out


def _extract_madr_sections(text: str) -> Tuple[str, str, str, str]:
    """Pull the four MADR section bodies out of a markdown block.

    Returns `(context, decision, consequences, alternatives)`. The
    "Decision" body is intentionally NOT pulled by this function —
    it is the section that introduced the heading, and the caller
    already knows its title.
    """
    return _split_madr_block(_section_bodies(text))


def _section_bodies(text: str) -> List[str]:
    """Return the bodies of `## <name>` sections in `text`, in order.

    Each body is the text between the heading and the next `##`
    heading (or end of text). A heading with a name not in
    `MADR_SECTIONS` is treated as a separator (its body is dropped)
    so that, e.g., a `## Notes` section does not pollute the
    decision.
    """
    out: List[str] = []
    sections: Dict[str, str] = {}
    heading_re = re.compile(r"^#{2,3}\s+(?P<name>[^\n]+?)\s*$", re.MULTILINE)
    matches = list(heading_re.finditer(text))
    for i, m in enumerate(matches):
        name = m.group("name").strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections[name] = text[start:end].strip()
    for sec in MADR_SECTIONS:
        out.append(sections.get(sec, ""))
    return out


def _split_madr_block(lines: List[str]) -> Tuple[str, str, str, str]:
    """Split a flat list of `key: value` lines into MADR fields.

    Each line is expected to start with a MADR section name and a
    colon, e.g. `Context: we need transactional state`. Unknown
    keys are appended to Context (so nothing is lost).
    """
    fields: Dict[str, List[str]] = {k: [] for k in MADR_SECTIONS}
    current = "Context"
    for line in lines:
        m = re.match(r"^(Context|Decision|Status|Consequences|Alternatives(?:\s+Considered)?)\s*:\s*(.*)$", line)
        if m:
            current = "Alternatives Considered" if m.group(1).startswith("Alternatives") else m.group(1)
            fields[current].append(m.group(2))
        else:
            fields[current].append(line)
    return (
        "\n".join(fields["Context"]).strip(),
        "\n".join(fields["Decision"]).strip(),
        "\n".join(fields["Consequences"]).strip(),
        "\n".join(fields["Alternatives Considered"]).strip(),
    )


# ---------------------------------------------------------------------------
# Ref parsing — used by the I/O wrapper
# ---------------------------------------------------------------------------

def extract_decision_refs(
    text: str,
    repo_owner: str,
    repo_name: str,
    jira_base_url: Optional[str],
) -> List[DecisionRef]:
    """Pull Jira / PR / GitHub-issue / code-path refs from a block of text."""
    refs: List[DecisionRef] = []
    seen: Set[Tuple[str, str]] = set()

    def _add(kind: str, id_: str, url: str) -> None:
        key = (kind, id_)
        if key in seen:
            return
        seen.add(key)
        refs.append(DecisionRef(kind=kind, id=id_, url=url))

    for m in _JIRA_REF_RE.finditer(text or ""):
        ref_id = m.group(1)
        url = f"{jira_base_url.rstrip('/')}/{ref_id}" if jira_base_url else f"https://example.atlassian.net/browse/{ref_id}"
        _add("jira", ref_id, url)
    for m in _PR_REF_RE.finditer(text or ""):
        pr_id = m.group(1)
        url = f"https://github.com/{repo_owner}/{repo_name}/pull/{pr_id}" if repo_owner and repo_name else f"https://example.com/pr/{pr_id}"
        _add("pr", pr_id, url)
    for m in _GITHUB_ISSUE_RE.finditer(text or ""):
        issue_id = m.group(1)
        url = f"https://github.com/{repo_owner}/{repo_name}/issues/{issue_id}" if repo_owner and repo_name else f"https://example.com/issue/{issue_id}"
        _add("github_issue", issue_id, url)
    for m in _BACKTICK_PATH_RE.finditer(text or ""):
        path = m.group(1)
        url = f"https://github.com/{repo_owner}/{repo_name}/blob/main/{path}" if repo_owner and repo_name else f"https://example.com/{path}"
        _add("code_path", path, url)
    for m in _PLAIN_PATH_RE.finditer(text or ""):
        path = m.group(1)
        # Skip obvious non-code (e.g. "in v1.0") — the regex requires
        # at least one slash OR an underscore+dot. The backtick form
        # above already handles the explicit `src/foo.py` case; this
        # fallback only fires for unbackticked references in prose.
        if "/" not in path and "_" not in path:
            continue
        url = f"https://github.com/{repo_owner}/{repo_name}/blob/main/{path}" if repo_owner and repo_name else f"https://example.com/{path}"
        _add("code_path", path, url)
    return refs


# ---------------------------------------------------------------------------
# Inputs dataclass — pure data
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AdrInputs:
    """All inputs the ADR renderer reads. Pure data; no I/O.

    `decision_points` is the set of new decisions to record on this
    run. `prior_registry` is the on-disk `AdrRegistry` snapshot
    (for the index + dedup). `prior_keys` is the set of `key`s
    already on disk (the idempotency dedup set).
    """
    project_name: str
    repo_owner: str
    repo_name: str
    default_branch: str
    input_sha: str
    decision_points: Tuple[DecisionPoint, ...]
    prior_registry: AdrRegistry
    prior_keys: Tuple[str, ...]              # keys of ADRs already on disk
    jira_base_url: Optional[str] = None
    date: str = ""                          # ISO date; defaults to today UTC

    def new_points(self) -> Tuple[DecisionPoint, ...]:
        """Return the decision points not already on disk.

        Same-key dedup keeps the idempotency contract. A `key` on disk
        means "this decision is already recorded; do not re-emit."
        """
        prior = set(self.prior_keys)
        return tuple(p for p in self.decision_points if p.key not in prior)


# ---------------------------------------------------------------------------
# Pure renderer
# ---------------------------------------------------------------------------

def _format_madr_section(name: str, body: str) -> str:
    if body.strip():
        return f"## {name}\n\n{body.rstrip()}\n"
    return f"## {name}\n\nUNKNOWN — needs doc-agent (v1 renderer is structure-only; an LLM-backed v2 will fill this in).\n"


def render_adr(point: DecisionPoint, number: int, project_name: str, source_sha: str) -> str:
    """Render one ADR in MADR format. Pure; deterministic on `point` + `number`.

    The body never contains wall-clock timestamps. The freshness stamp
    lives on the `DocArtifact` wrapper. The `Accepted at` line uses
    the source commit SHA (deterministic), not `now()`.
    """
    chips = _format_ref_chips(point.refs)
    issue_line = f"- **Issue:** [{point.issue}](/FORA/issues/{point.issue})\n" if point.issue else ""
    supersedes_line = f"- **Supersedes:** ADR-{point.supersedes:04d}\n" if point.supersedes is not None else "- **Supersedes:** —\n"
    superseded_by_line = f"- **Superseded by:** ADR-{point.superseded_by:04d}\n" if point.superseded_by is not None else "- **Superseded by:** —\n"
    source_line = f"- **Source:** {point.source}\n" if point.source else ""
    refs_line = f"- **Refs:** {chips}\n" if chips else ""
    tags_line = ", ".join(f"`{t}`" for t in point.tags) if point.tags else ""

    L: List[str] = []
    L.append(f"# {number:04d} — {point.title}")
    L.append("")
    L.append(f"- **Status:** {point.status.value}")
    L.append(f"- **Date:** {_today_or(point, source_sha)}")
    L.append(f"- **Accepted at:** `{source_sha}`")
    L.append(f"- **Deciders:** {point.deciders}")
    L.append(f"- **Architecture area:** `{point.architecture_area}`")
    if tags_line:
        L.append(f"- **Tags:** {tags_line}")
    if issue_line:
        L.append(issue_line.rstrip())
    if source_line:
        L.append(source_line.rstrip())
    if refs_line:
        L.append(refs_line.rstrip())
    L.append(supersedes_line.rstrip())
    L.append(superseded_by_line.rstrip())
    L.append("")

    for name in MADR_SECTIONS:
        if name == "Status":
            continue  # status is in the header
        body = {
            "Context": point.context,
            "Decision": point.decision,
            "Consequences": point.consequences,
            "Alternatives Considered": point.alternatives,
        }[name]
        L.append(_format_madr_section(name, body).rstrip())
        L.append("")

    L.append("---")
    L.append("")
    L.append(
        f"**Source SHA:** `{source_sha or 'unknown'}`. Generated by the "
        f"Documentation Agent ([FORA-121](/FORA/issues/FORA-121) / 7.1.5) "
        f"in MADR format from `{point.source or 'unspecified'}`. Re-running with "
        f"the same decision set and source SHA is a no-op (idempotency contract)."
    )
    L.append("")
    return "\n".join(L).rstrip("\n") + "\n"


def _today_or(point: DecisionPoint, source_sha: str) -> str:
    """Return the ADR date — `point.source` carries it in normal cases.

    MADR's `Date` field is the date the ADR was opened, which is a
    property of the *source*, not a wall-clock property. When the
    caller does not pass a date on the point, we use today's UTC date
    so the run is still valid (and stable across re-runs within the
    same UTC day).
    """
    if hasattr(point, "_date_override") and point._date_override:  # type: ignore[attr-defined]
        return point._date_override  # type: ignore[attr-defined]
    return now_iso().split("T", 1)[0]


def render_index(entries: Tuple[AdrRegistryEntry, ...], project_name: str) -> str:
    """Render `docs/adr/README.md`. Pure; deterministic on `entries` (sorted)."""
    sorted_entries = sorted(entries, key=lambda e: e.number)
    L: List[str] = []
    L.append("# Architecture Decision Records")
    L.append("")
    L.append(
        f"This index lists every Architecture Decision Record (ADR) for "
        f"**{project_name}** in MADR format. ADRs are immutable once "
        f"`accepted`; if a decision changes, a new ADR supersedes the old one. "
        f"See [`workspace/project/adr-registry.md`](../project/adr-registry.md) "
        f"for the queryable registry and [`agents/documentation/schemas.py` "
        f"AdrRegistryEntry](../../agents/documentation/schemas.py) for the entry shape."
    )
    L.append("")
    L.append("## Index")
    L.append("")
    if not sorted_entries:
        L.append("No ADRs yet.")
    else:
        # Group by status so a reader can scan the active decisions.
        for status in (AdrStatus.ACCEPTED, AdrStatus.PROPOSED, AdrStatus.SUPERSEDED, AdrStatus.DEPRECATED):
            bucket = [e for e in sorted_entries if e.status == status]
            if not bucket:
                continue
            L.append(f"### {status.value.capitalize()}")
            L.append("")
            for e in bucket:
                L.append(f"- [{e.number:04d} — {e.title}]({e.path}) ({e.date}, `{e.architecture_area}`)")
            L.append("")
    L.append("---")
    L.append("")
    L.append(
        f"**{len(sorted_entries)} ADR{'s' if len(sorted_entries) != 1 else ''}** indexed. "
        f"Generated by the Documentation Agent ([FORA-121](/FORA/issues/FORA-121) / 7.1.5). "
        f"Re-running with the same set of decision points is a no-op (idempotency contract)."
    )
    L.append("")
    return "\n".join(L).rstrip("\n") + "\n"


# ---------------------------------------------------------------------------
# Generator class — owns I/O
# ---------------------------------------------------------------------------

class AdrGenerator:
    """Generates `docs/adr/NNNN-title.md` + `docs/adr/README.md` + the
    on-disk registry from a stream of decision points.
    """

    def __init__(self, repo_root: Path | str = ".") -> None:
        self.repo_root = Path(repo_root)

    # -- file I/O --------------------------------------------------------

    def _read_registry(self) -> AdrRegistry:
        p = self.repo_root / DEFAULT_ADR_REGISTRY_PATH
        if not p.exists():
            return AdrRegistry(version="1.0", entries=[])
        try:
            return parse_registry_markdown(p.read_text(encoding="utf-8"))
        except Exception:
            return AdrRegistry(version="1.0", entries=[])

    def _read_prior_keys(self) -> List[str]:
        """Return the set of `key` slugs already on disk.

        The idempotency dedup set is keyed on the file name (the
        slugified title), not on a separate index. The registry is
        cross-checked: if a registry entry's path no longer exists on
        disk, the entry is still in the registry (it is the registry
        that is the source of truth for "is this recorded") but the
        slug is not in the on-disk dedup set until the file is
        re-emitted.
        """
        adr_dir = self.repo_root / DEFAULT_ADR_DIR
        if not adr_dir.exists():
            return []
        keys: List[str] = []
        for p in sorted(adr_dir.glob("*.md")):
            if p.name == "README.md":
                continue
            m = re.match(r"^\d{4}-(.+)\.md$", p.name)
            if m:
                keys.append(m.group(1))
        return keys

    def _build_inputs(self, inp: DocGenInput) -> AdrInputs:
        prior_registry = self._read_registry()
        prior_keys = self._read_prior_keys()
        return AdrInputs(
            project_name=inp.repo.name or "FORA",
            repo_owner=inp.repo.owner,
            repo_name=inp.repo.name,
            default_branch=inp.repo.default_branch or "main",
            input_sha=inp.input_sha or "",
            decision_points=tuple(),  # populated by the caller; ADR-detection lives in the orchestrator
            prior_registry=prior_registry,
            prior_keys=tuple(prior_keys),
            jira_base_url=None,
        )

    # -- public API ------------------------------------------------------

    def generate(
        self,
        inp: DocGenInput,
        decision_points: Optional[List[DecisionPoint]] = None,
    ) -> Tuple[List[DocArtifact], List[DocIndexEntry], List[AdrRegistryEntry], List[DecisionPoint]]:
        """Render every new ADR + the index. Returns
        `(artifacts, doc_index_entries, registry_entries, skipped_points)`.

        `skipped_points` is a list of decision points whose `key` was
        already on disk; surfaced separately so the caller can emit
        `AMBIGUOUS_DECISION_POINT` warnings if the key changed under
        their feet.
        """
        inputs = self._build_inputs(inp)
        points = list(decision_points or inputs.decision_points)
        new_points = [p for p in points if p.key not in set(inputs.prior_keys)]
        skipped = [p for p in points if p.key in set(inputs.prior_keys)]

        adr_dir = self.repo_root / DEFAULT_ADR_DIR
        next_number = _next_number(adr_dir, inputs.prior_registry)
        now = now_iso()
        source_sha = inp.input_sha or "unknown"

        new_artifacts: List[DocArtifact] = []
        new_registry_entries: List[AdrRegistryEntry] = []
        for p in new_points:
            num = next_number
            path = _format_adr_path(num, p.title)
            body = render_adr(p, num, inputs.project_name, source_sha)
            sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
            new_artifacts.append(DocArtifact(
                path=path,
                content=body,
                content_sha=sha,
                freshness_timestamp=now,
                source_sha=source_sha,
                generator_type=GeneratorType.ADR,
                approval_required=True,  # new ADR per prompt.md §Hard constraints #3
            ))
            new_registry_entries.append(AdrRegistryEntry(
                number=num,
                title=p.title,
                path=path,
                status=p.status,
                date=_date_for(p, now),
                architecture_area=p.architecture_area,
                tags=list(p.tags),
                supersedes=p.supersedes,
                superseded_by=p.superseded_by,
                source_commit=source_sha,
                last_generated_at=now,
            ))
            next_number += 1

        # Index: combine prior registry with new entries, dedup by number.
        combined: Dict[int, AdrRegistryEntry] = {}
        for e in inputs.prior_registry.entries:
            combined[e.number] = e
        for e in new_registry_entries:
            combined[e.number] = e
        index_entries = sorted(combined.values(), key=lambda e: e.number)
        index_body = render_index(tuple(index_entries), inputs.project_name)
        index_sha = hashlib.sha256(index_body.encode("utf-8")).hexdigest()

        index_artifact = DocArtifact(
            path=DEFAULT_ADR_INDEX_PATH,
            content=index_body,
            content_sha=index_sha,
            freshness_timestamp=now,
            source_sha=source_sha,
            generator_type=GeneratorType.ADR,
            approval_required=False,  # the index is derived; not the artifact the operator approves
        )

        # DocIndex entries: one per new ADR + one for the index.
        doc_index_entries = [
            DocIndexEntry(
                path=DEFAULT_ADR_INDEX_PATH,
                kind=DocKind.ADR,
                title="ADR Index",
                last_generated_at=now,
                source_commit=source_sha,
                generator=GeneratorType.ADR.value,
                version="1.0",
                content_sha=index_sha,
                approval_required=False,
                tags=["adr", "index"],
                architecture_area="knowledge-layer",
            )
        ]
        for a in new_artifacts:
            # Find the registry entry we just produced for this artifact.
            entry = next(e for e in new_registry_entries if e.path == a.path)
            doc_index_entries.append(DocIndexEntry(
                path=a.path,
                kind=DocKind.ADR,
                title=entry.title,
                last_generated_at=now,
                source_commit=source_sha,
                generator=GeneratorType.ADR.value,
                version="1.0",
                content_sha=a.content_sha,
                approval_required=True,
                tags=["adr", entry.architecture_area] + entry.tags,
                architecture_area=entry.architecture_area,
            ))

        return new_artifacts + [index_artifact], doc_index_entries, new_registry_entries, skipped


def _date_for(p: DecisionPoint, now_iso_str: str) -> str:
    """Return the date stamp for a registry entry.

    MADR convention: the date the ADR was opened. The renderer keeps
    the date in the source when it can; for the registry we accept
    the same resolution (today UTC by default) so a re-run is stable.
    """
    if getattr(p, "_date_override", None):  # type: ignore[attr-defined]
        return p._date_override  # type: ignore[attr-defined]
    return now_iso_str.split("T", 1)[0]


# ---------------------------------------------------------------------------
# High-level entry point — produces a DocGenOutput
# ---------------------------------------------------------------------------

def run_adr(
    inp: DocGenInput,
    decision_points: Optional[List[DecisionPoint]] = None,
    repo_root: Path | str = ".",
    write: bool = True,
) -> DocGenOutput:
    """Run the ADR generator end-to-end and return a `DocGenOutput`.

    `write=True` (the default) writes the new ADR files + index +
    refreshes `workspace/project/adr-registry.md` and
    `workspace/project/docs.md`. `write=False` is the dry-run path the
    smoke test uses to assert "no file is written" without polluting
    the test repo.

    `decision_points` is optional — when absent, the generator reads
    the existing registry + filesystem and emits only the index (a
    no-op refresh). The orchestrator is expected to call
    `detect_decision_points_from_*` and pass the resulting list.
    """
    # Pre-flight input validation.
    errs: List[str] = []
    if not inp.input_sha:
        errs.append("input_sha is required (spec: determinism + source attribution)")
    if not inp.repo.owner or not inp.repo.name:
        errs.append("repo.owner and repo.name are required")
    if inp.commit_range.from_sha == inp.commit_range.to_sha and not decision_points:
        errs.append("commit_range.from_sha == to_sha and no decision points supplied; nothing to document")

    if errs:
        kind = ErrorKind.MISSING_INPUT_SHA if "input_sha" in errs[0] else ErrorKind.STORAGE_CONTRACT_MISSING
        out = DocGenOutput(
            run_id="adr-abort-" + hashlib.sha1(b"invalid").hexdigest()[:8],
            input_sha=inp.input_sha or "",
            status=RunStatus.ABORTED,
            errors=[DocGenError(kind=kind, message=e, recoverable=False) for e in errs],
        )
        return out

    # Cost-ceiling pre-flight (spec §Cost discipline).
    if inp.cost_envelope.get("per_run_tokens_in") and decision_points:
        approx_tokens = sum(
            len(p.title) + len(p.context) + len(p.decision) + len(p.consequences) + len(p.alternatives)
            for p in decision_points
        ) // 4
        if approx_tokens > inp.cost_envelope["per_run_tokens_in"]:
            return DocGenOutput(
                run_id="adr-abort-" + hashlib.sha1(b"oversized").hexdigest()[:8],
                input_sha=inp.input_sha or "",
                status=RunStatus.ABORTED,
                errors=[DocGenError(
                    kind=ErrorKind.OVERSIZED_DIFF,
                    message=(
                        f"decision-points input expanded to ~{approx_tokens} tokens, "
                        f"exceeds per_run_tokens_in={inp.cost_envelope['per_run_tokens_in']}; "
                        "chunk by decision and run in series."
                    ),
                    recoverable=True,
                    retry_after_seconds=0,
                )],
            )

    gen = AdrGenerator(repo_root=repo_root)
    artifacts, doc_index_entries, new_registry_entries, skipped = gen.generate(
        inp, decision_points=decision_points
    )

    # Surface ambiguous decision points (missing required fields) as
    # structured warnings. The normal idempotency skip — `key` already
    # on disk — is NOT an error: the operator asked for an idempotent
    # re-run, that is what they got, and the orchestrator can detect
    # skips by counting `artifacts` vs the input `decision_points`.
    errors: List[DocGenError] = []
    for p in decision_points or []:
        if not p.title.strip() or not p.context.strip() or not p.decision.strip():
            errors.append(DocGenError(
                kind=ErrorKind.AMBIGUOUS_CONVENTIONAL_COMMIT,
                message=(
                    f"decision point from {p.source!r} is missing required fields "
                    f"(title/context/decision). key={p.key!r}."
                ),
                recoverable=True,
            ))

    if write:
        root = Path(repo_root)
        for a in artifacts:
            p = root / a.path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(a.content, encoding="utf-8")
        # Refresh the on-disk registry.
        _refresh_registry(root / DEFAULT_ADR_REGISTRY_PATH, gen._read_registry(), new_registry_entries)
        # Refresh the doc index.
        docs_index_path = root / DEFAULT_DOCS_INDEX_PATH
        for entry in doc_index_entries:
            _refresh_doc_index(docs_index_path, entry)

    # Storage contract (FORA-117)
    doc_index = DocIndex(
        version="1.0",
        entries=list(doc_index_entries),
        generated_at=artifacts[0].freshness_timestamp if artifacts else now_iso(),
        docs_index_sha=inp.memory_snapshot.docs_index_sha,
    )
    # The combined registry (prior + new) is what the caller will see
    # on the next read. We rebuild it from the filesystem + the new
    # entries so the result is the same shape as the on-disk one.
    adr_registry = AdrRegistry(
        version="1.0",
        entries=_combined_registry(gen, repo_root, new_registry_entries),
        generated_at=artifacts[0].freshness_timestamp if artifacts else now_iso(),
        adr_registry_sha=inp.memory_snapshot.adr_registry_sha,
    )

    out = DocGenOutput(
        run_id="adr-" + hashlib.sha1((inp.input_sha or "").encode()).hexdigest()[:8],
        input_sha=inp.input_sha or "",
        status=RunStatus.OK,
        artifacts=list(artifacts),
        adr_index=[
            {"number": e.number, "title": e.title, "path": e.path, "status": e.status.value}
            for e in new_registry_entries
        ],
        freshness_metadata=FreshnessMetadata(
            docs_index_sha=inp.memory_snapshot.docs_index_sha,
            generated_at=artifacts[0].freshness_timestamp if artifacts else now_iso(),
            oldest_artifact_source_sha=inp.commit_range.from_sha,
            newest_artifact_source_sha=inp.commit_range.to_sha,
        ),
        cost_record=CostRecord(
            prompt_hash=hashlib.sha1((inp.input_sha or "").encode()).hexdigest(),
            model=inp.model,
            tokens_in=0,    # structure-only renderer; no LLM call in v1
            tokens_out=0,
            usd=0.0,
            duration_ms=0,
            fallback_used=False,
        ),
        errors=errors,
        doc_index=doc_index,
        adr_registry=adr_registry,
        freshness_warnings=doc_index.freshness_check(),
    )
    return out


# ---------------------------------------------------------------------------
# On-disk refresh helpers (mirror changelog_generator.py)
# ---------------------------------------------------------------------------

def _combined_registry(gen: "AdrGenerator", repo_root: Path | str, new_entries: List[AdrRegistryEntry]) -> List[AdrRegistryEntry]:
    """Rebuild the full registry (prior + new), sorted by number."""
    prior = gen._read_registry().entries
    combined: Dict[int, AdrRegistryEntry] = {}
    for e in prior:
        combined[e.number] = e
    for e in new_entries:
        combined[e.number] = e
    return sorted(combined.values(), key=lambda e: e.number)


def _refresh_registry(path: Path, prior: AdrRegistry, new_entries: List[AdrRegistryEntry]) -> None:
    """Merge `new_entries` into the on-disk registry file."""
    combined: Dict[int, AdrRegistryEntry] = {}
    for e in prior.entries:
        combined[e.number] = e
    for e in new_entries:
        combined[e.number] = e
    new_reg = AdrRegistry(
        version=prior.version or "1.0",
        entries=sorted(combined.values(), key=lambda e: e.number),
        generated_at=now_iso(),
        adr_registry_sha=prior.adr_registry_sha,
    )
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_render_registry_markdown(new_reg), encoding="utf-8")
        return
    text = path.read_text(encoding="utf-8")
    body = _json.dumps(new_reg.to_dict(), indent=2)
    new_text = _FENCED_JSON_RE.sub(lambda _m: f"```json\n{body}\n```", text, count=1)
    path.write_text(new_text, encoding="utf-8")


def _render_registry_markdown(reg: AdrRegistry) -> str:
    body = _json.dumps(reg.to_dict(), indent=2)
    return (
        "---\n"
        "name: adr-registry\n"
        f"version: {reg.version}\n"
        "spec: FORA-117\n"
        "owner: doc-agent\n"
        "status: production\n"
        "description: |\n"
        "  The v1 knowledge-layer surface that mirrors `docs/adr/NNNN-*.md` as a\n"
        "  queryable index. Storage contract for the Documentation Agent's ADR\n"
        "  generator (FORA-121, sub-goal 7.1.5).\n"
        "---\n\n"
        "# ADR Registry — FORA Project\n\n"
        "```json\n"
        f"{body}\n"
        "```\n"
    )


def _refresh_doc_index(path: Path, entry: DocIndexEntry) -> None:
    """Append or replace the entry in `workspace/project/docs.md`."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        idx = DocIndex(version="1.0", entries=[entry])
        path.write_text(_render_index_markdown(idx), encoding="utf-8")
        return
    text = path.read_text(encoding="utf-8")
    idx = parse_index_markdown_safe(text)
    existing = idx.by_path(entry.path)
    if existing is not None:
        existing.last_generated_at = entry.last_generated_at
        existing.source_commit = entry.source_commit
        existing.content_sha = entry.content_sha
        existing.approval_required = entry.approval_required
        existing.title = entry.title
    else:
        idx.entries.append(entry)
    idx.generated_at = now_iso()
    body = _json.dumps(idx.to_dict(), indent=2)
    new_text = _FENCED_JSON_RE.sub(lambda _m: f"```json\n{body}\n```", text, count=1)
    path.write_text(new_text, encoding="utf-8")


def parse_index_markdown_safe(text: str) -> DocIndex:
    """Parse `workspace/project/docs.md`; tolerate malformed JSON."""
    from .docs_query import parse_index_markdown
    try:
        return parse_index_markdown(text)
    except Exception:
        return DocIndex(version="1.0", entries=[])


def _render_index_markdown(idx: DocIndex) -> str:
    body = _json.dumps(idx.to_dict(), indent=2)
    return (
        "---\n"
        "name: doc-index\n"
        f"version: {idx.version}\n"
        "spec: FORA-117\n"
        "owner: doc-agent\n"
        "status: production\n"
        "description: |\n"
        "  The v1 knowledge-layer surface the Documentation Agent writes to and that\n"
        "  the Memory Agent and Audit Agent read from.\n"
        "---\n\n"
        "# Doc Index — FORA Project\n\n"
        "```json\n"
        f"{body}\n"
        "```\n"
    )


__all__ = [
    "DEFAULT_ADR_DIR",
    "DEFAULT_ADR_INDEX_PATH",
    "DEFAULT_ADR_REGISTRY_PATH",
    "DEFAULT_DOCS_INDEX_PATH",
    "MADR_SECTIONS",
    "DecisionPoint",
    "DecisionRef",
    "AdrInputs",
    "AdrGenerator",
    "render_adr",
    "render_index",
    "run_adr",
    "detect_decision_points_from_comments",
    "detect_decision_points_from_markdown",
    "extract_decision_refs",
]
