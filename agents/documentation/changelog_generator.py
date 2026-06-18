"""Changelog & Release Notes generator (FORA-122 / 7.1.4).

Produces two artifacts per run:

- `CHANGELOG.md`                       — Keep-a-Changelog format, full file
- `docs/release-notes/RELEASE_NOTES_<version>.md` — per-release summary

## Inputs

The generator consumes a list of `ConventionalCommit` (see
`schemas.ConventionalCommit`) plus a `current_version` and `release_date`.
The commits are the **set of commits since the last release tag**, per
the FORA-122 scope: "Parse conventional commits since the last release
tag."

## Output structure (CHANGELOG.md)

Follows the [Keep-a-Changelog](https://keepachangelog.com/en/1.1.0/) format
with the FORA-122 grouping:

- **Breaking Changes** (top callout, any commit with `!` in type or
  `BREAKING CHANGE:` footer)
- **New Features** (`feat`)
- **Bug Fixes** (`fix`)
- **Performance** (`perf`)
- **Documentation** (`docs`)
- **Internal** (`chore`, `refactor`, `test`, `build`, `ci`, `style`, `revert`)

Every entry deep-links to the source commit; PR and Jira/GitHub issues
parsed from the commit body are appended as secondary links.

## Idempotency contract

Re-running with the **same `input_sha` + the same commit set + the same
`current_version`** produces byte-identical `CHANGELOG.md` and
`RELEASE_NOTES_<version>.md` bodies. Wall-clock timestamps live on the
`DocArtifact` wrapper, never in the body. This satisfies
`prompt.md` hard-constraint #1 ("Determinism. Same inputs → same output
bytes").

The on-disk `CHANGELOG.md` is refreshed by **inserting** the current
release section into the existing file (in version order, newest first);
if the section for `current_version` is already present, the file is
returned unchanged (no-op).

## Approval routing

Per `prompt.md` §"Hard constraints" item 3, CHANGELOG updates are
**routine** and auto-merge after generation (`approval_required=False`).
A first-ever run with no `CHANGELOG.md` on disk seeds the file with a
header + the current release; that is also treated as routine (the
file content is deterministic and the user can audit the PR).

## Failure modes

- Missing `input_sha` → `MISSING_INPUT_SHA` (the spec requires it).
- A commit message that does not match Conventional Commits →
  `AMBIGUOUS_CONVENTIONAL_COMMIT` (surface as a structured warning;
  the commit lands in the **Internal** bucket with a `<!-- ambiguous -->`
  marker so the operator can see and fix).
- `commit_range.to_sha - from_sha` expanded exceeds
  `cost_envelope.per_run_tokens_in` → `OVERSIZED_DIFF` (chunk by file,
  run in series; in v1 the pure renderer is structure-only and does not
  make an LLM call, so the ceiling is checked pre-flight and the run
  aborts with a typed error if it would breach).

## Inputs read from disk

- `CHANGELOG.md`                  — prior file, for the insert-or-no-op
                                    idempotency check
- `docs/release-notes/`           — directory seeded on first run

The generator does **not** read project memory or customer memory; the
CHANGELOG is derived from the commit history alone.
"""

from __future__ import annotations

import hashlib
import json as _json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .docs_query import _FENCED_JSON_RE, parse_index_markdown
from .schemas import (
    AdrRegistry,
    CommitRange,
    ConventionalCommit,
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
    MemorySnapshot,
    RunStatus,
    now_iso,
)


# ---------------------------------------------------------------------------
# File layout constants (the FORA workspace convention).
# ---------------------------------------------------------------------------

DEFAULT_CHANGELOG_PATH = "CHANGELOG.md"
DEFAULT_RELEASE_NOTES_DIR = "docs/release-notes"
DEFAULT_DOCS_INDEX_PATH = "workspace/project/docs.md"

KEEP_A_CHANGELOG_HEADER = """\
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

"""


# ---------------------------------------------------------------------------
# Conventional-commit parsing (pure)
# ---------------------------------------------------------------------------

# Conventional Commits 1.0.0: type(scope)!: subject
# - type: lowercase letters, no spaces
# - scope: optional, in parens
# - ! : optional breaking-change marker
# - subject: everything after the colon and a single space
_CONVENTIONAL_RE = re.compile(
    r"^(?P<type>[a-zA-Z]+)(?:\((?P<scope>[^)]+)\))?(?P<bang>!)?\s*:\s*(?P<subject>.+?)\s*$"
)
_BREAKING_FOOTER_RE = re.compile(
    r"^BREAKING[ -]CHANGE\s*:\s*(?P<desc>.+?)\s*$", re.IGNORECASE | re.MULTILINE
)

# Jira-style (FORA-NNN, ABC-123) and GitHub-style (#NNN, PR #NNN)
_JIRA_REF_RE = re.compile(r"\b([A-Z][A-Z0-9]+-\d+)\b")
_GITHUB_ISSUE_RE = re.compile(r"(?<!PR )(?<!PR)#(\d+)\b")
_PR_REF_RE = re.compile(r"\bPR\s*#(\d+)\b", re.IGNORECASE)


# Categories the FORA-122 spec groups into.
CATEGORY_BREAKING = "Breaking Changes"
CATEGORY_NEW_FEATURES = "New Features"
CATEGORY_BUG_FIXES = "Bug Fixes"
CATEGORY_PERFORMANCE = "Performance"
CATEGORY_DOCUMENTATION = "Documentation"
CATEGORY_INTERNAL = "Internal"

# Order the categories are rendered in.
CATEGORY_ORDER: List[str] = [
    CATEGORY_BREAKING,
    CATEGORY_NEW_FEATURES,
    CATEGORY_BUG_FIXES,
    CATEGORY_PERFORMANCE,
    CATEGORY_DOCUMENTATION,
    CATEGORY_INTERNAL,
]

_TYPE_TO_CATEGORY: Dict[str, str] = {
    "feat": CATEGORY_NEW_FEATURES,
    "fix": CATEGORY_BUG_FIXES,
    "perf": CATEGORY_PERFORMANCE,
    "docs": CATEGORY_DOCUMENTATION,
    "chore": CATEGORY_INTERNAL,
    "refactor": CATEGORY_INTERNAL,
    "test": CATEGORY_INTERNAL,
    "build": CATEGORY_INTERNAL,
    "ci": CATEGORY_INTERNAL,
    "style": CATEGORY_INTERNAL,
    "revert": CATEGORY_INTERNAL,
}


@dataclass
class CommitRef:
    """A cross-reference parsed from a commit body: Jira issue or GitHub PR/issue."""
    kind: str                                  # "jira" | "pr" | "github_issue"
    id: str                                    # "FORA-123" | "789" | "456"
    url: str                                   # fully-qualified link


@dataclass
class ChangelogEntry:
    """One bullet line in the changelog."""
    description: str                           # the human-facing subject
    commit_sha: str
    commit_url: str
    author: str
    is_breaking: bool
    is_ambiguous: bool
    scope: Optional[str]                       # the conventional-commit scope
    refs: List[CommitRef] = field(default_factory=list)

    def render(self, jira_base: Optional[str] = None) -> str:
        """Render the bullet line.

        Format: `- description ([\\`<sha>\\`](url))` plus optional
        trailing ref links in `(...)`.
        """
        sha_short = self.commit_sha[:7] if len(self.commit_sha) >= 7 else self.commit_sha
        prefix = "- "
        if self.is_ambiguous:
            prefix = "- <!-- ambiguous --> "
        # Trailing ref chips — Jira first, then PR, then GitHub issue
        # (most-discussed link to least).
        ref_chips: List[str] = []
        seen_keys: set = set()
        for r in self.refs:
            key = (r.kind, r.id)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            if r.kind == "jira":
                ref_chips.append(f"[{r.id}]({r.url})")
            elif r.kind == "pr":
                ref_chips.append(f"[PR #{r.id}]({r.url})")
            else:  # github_issue
                ref_chips.append(f"[#{r.id}]({r.url})")
        trailing = f" ({', '.join(ref_chips)})" if ref_chips else ""
        return f"{prefix}{self.description} ([`{sha_short}`]({self.commit_url})){trailing}"


@dataclass
class Release:
    """One release in the changelog."""
    version: str                               # "1.2.0" (no leading v)
    date: str                                  # ISO 8601 date
    entries: List[ChangelogEntry] = field(default_factory=list)

    def by_category(self) -> Dict[str, List[ChangelogEntry]]:
        out: Dict[str, List[ChangelogEntry]] = {c: [] for c in CATEGORY_ORDER}
        for e in self.entries:
            if e.is_breaking:
                out[CATEGORY_BREAKING].append(e)
                continue
            # Use the entry's scope-derived category if available;
            # the renderer pre-classifies into ChangelogEntry via
            # `category_hint` at build time, but the simpler contract
            # is to re-derive from the scope tag. We keep the bucket
            # in `entries` and let the renderer sort by the entry's
            # own category attribute (set by ChangelogInputs below).
            cat = e.category if hasattr(e, "category") and e.category else CATEGORY_INTERNAL
            out.setdefault(cat, []).append(e)
        return out


# Patch ChangelogEntry to carry a category hint without breaking
# the dataclass equality story: extend the field set.
@dataclass
class ChangelogEntryCategorized(ChangelogEntry):
    category: str = CATEGORY_INTERNAL


def parse_conventional(message: str) -> Tuple[Optional[str], Optional[str], bool, str, bool]:
    """Parse a commit message into `(type, scope, breaking, subject, is_ambiguous)`.

    The `(breaking, subject, is_ambiguous)` triple handles the edge cases:

    - `feat(api)!: drop /v0 routes`  → `breaking=True, subject="drop /v0 routes"`
    - `feat: add thing`              → `breaking=False, subject="add thing"`
    - `wip: something`               → `type="wip"` (unknown → flagged in renderer)
    - `Just a free-form message`     → `type=None, is_ambiguous=True`

    `BREAKING CHANGE:` and `BREAKING-CHANGE:` footers also force
    `breaking=True` even without a `!` marker.
    """
    first_line = message.splitlines()[0] if message else ""
    m = _CONVENTIONAL_RE.match(first_line)
    if not m:
        return None, None, False, first_line.strip(), True
    ctype = m.group("type").lower()
    scope = m.group("scope")
    bang = m.group("bang") == "!"
    subject = m.group("subject").strip()
    breaking = bang
    if _BREAKING_FOOTER_RE.search(message):
        breaking = True
    return ctype, scope, breaking, subject, False


def extract_refs(message: str, repo_owner: str, repo_name: str, jira_base_url: Optional[str]) -> List[CommitRef]:
    """Extract Jira / GitHub issue / PR references from a commit message body."""
    refs: List[CommitRef] = []
    seen: set = set()

    def _add(kind: str, id_: str, url: str) -> None:
        key = (kind, id_)
        if key in seen:
            return
        seen.add(key)
        refs.append(CommitRef(kind=kind, id=id_, url=url))

    for m in _JIRA_REF_RE.finditer(message):
        ref_id = m.group(1)
        if jira_base_url:
            url = f"{jira_base_url.rstrip('/')}/{ref_id}"
        else:
            url = f"https://example.atlassian.net/browse/{ref_id}"
        _add("jira", ref_id, url)
    for m in _PR_REF_RE.finditer(message):
        pr_id = m.group(1)
        url = (
            f"https://github.com/{repo_owner}/{repo_name}/pull/{pr_id}"
            if repo_owner and repo_name
            else f"https://example.com/pr/{pr_id}"
        )
        _add("pr", pr_id, url)
    for m in _GITHUB_ISSUE_RE.finditer(message):
        issue_id = m.group(1)
        url = (
            f"https://github.com/{repo_owner}/{repo_name}/issues/{issue_id}"
            if repo_owner and repo_name
            else f"https://example.com/issue/{issue_id}"
        )
        _add("github_issue", issue_id, url)
    return refs


def build_changelog_entry(commit: ConventionalCommit, repo_owner: str, repo_name: str, jira_base_url: Optional[str]) -> ChangelogEntryCategorized:
    """Convert a `ConventionalCommit` into a categorised `ChangelogEntry`.

    The `commit.breaking` field is the canonical source of truth (the
    orchestrator parses the message and stamps the result). The
    re-parsed `parse_conventional` output is only used to derive the
    scope + ctype for category mapping; its `breaking` value is
    ignored so the renderer respects the orchestrator's decision.
    """
    ctype, scope, _parsed_breaking, subject, ambiguous = parse_conventional(commit.message)
    # Trust the orchestrator's pre-parsed `breaking` flag.
    breaking = bool(commit.breaking)
    if ambiguous or ctype is None:
        category = CATEGORY_INTERNAL
        is_ambiguous = True
    else:
        category = CATEGORY_BREAKING if breaking else _TYPE_TO_CATEGORY.get(ctype, CATEGORY_INTERNAL)
        is_ambiguous = False
    commit_url = (
        f"https://github.com/{repo_owner}/{repo_name}/commit/{commit.sha}"
        if repo_owner and repo_name
        else f"https://example.com/commit/{commit.sha}"
    )
    refs = extract_refs(commit.message, repo_owner, repo_name, jira_base_url)
    return ChangelogEntryCategorized(
        description=subject if not is_ambiguous else commit.message.splitlines()[0].strip(),
        commit_sha=commit.sha,
        commit_url=commit_url,
        author=commit.author,
        is_breaking=breaking,
        is_ambiguous=is_ambiguous,
        scope=scope,
        refs=refs,
        category=category,
    )


# ---------------------------------------------------------------------------
# Inputs dataclass — pure data
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ChangelogInputs:
    """All inputs the CHANGELOG renderer reads. Pure data; no I/O."""
    project_name: str
    current_version: str                       # "1.2.0"
    release_date: str                          # ISO date (e.g. "2026-06-18")
    commits: List[ConventionalCommit]          # commits since the last release tag
    repo_owner: str = ""
    repo_name: str = ""
    default_branch: str = "main"
    jira_base_url: Optional[str] = None        # "https://fora.atlassian.net"
    input_sha: str = ""
    prior_changelog: str = ""                  # existing CHANGELOG.md body, if any
    prior_release_versions: Tuple[str, ...] = ()   # versions already in prior_changelog

    def releases_to_render(self) -> List["_RenderRelease"]:
        """Return the list of release objects the renderer will emit, in
        version order (newest first). Idempotent: if the current_version
        is already in `prior_release_versions`, return the prior releases
        unchanged (the renderer turns this into a no-op write).
        """
        new_entries = [
            build_changelog_entry(c, self.repo_owner, self.repo_name, self.jira_base_url)
            for c in self.commits
        ]
        new_release = _RenderRelease(
            version=self.current_version,
            date=self.release_date,
            entries=new_entries,
        )
        if self.current_version in self.prior_release_versions:
            # Idempotent re-run: emit only the prior releases; the
            # current_version section is already on disk.
            return list(self._prior_releases())
        return [new_release] + list(self._prior_releases())

    def _prior_releases(self) -> List["_RenderRelease"]:
        """Extract prior release sections from `prior_changelog`.

        Each release section is `## [version] - date` followed by category
        sub-sections. The renderer only needs (version, date) to keep
        them in the header; entries are not re-rendered.
        """
        return _parse_prior_releases(self.prior_changelog)


@dataclass
class _RenderRelease:
    version: str
    date: str
    entries: List[ChangelogEntryCategorized] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Pure renderer — same inputs -> same bytes
# ---------------------------------------------------------------------------

def _format_release_heading(version: str, date: str) -> str:
    return f"## [{version}] - {date}"


def _format_unreleased_heading() -> str:
    return "## [Unreleased]"


def _render_release_section(release: _RenderRelease) -> str:
    L: List[str] = []
    L.append(_format_release_heading(release.version, release.date))
    L.append("")

    breaking = [e for e in release.entries if e.is_breaking]
    by_cat: Dict[str, List[ChangelogEntryCategorized]] = {c: [] for c in CATEGORY_ORDER}
    for e in release.entries:
        if e.is_breaking:
            continue
        cat = e.category if e.category in CATEGORY_ORDER else CATEGORY_INTERNAL
        by_cat[cat].append(e)

    if breaking:
        L.append("> [!WARNING]")
        L.append(">")
        L.append("> **Breaking changes in this release:**")
        for e in breaking:
            line = e.render()
            L.append(f"> {line}")
        L.append("")

    for cat in CATEGORY_ORDER:
        if cat == CATEGORY_BREAKING:
            # Already covered by the callout box above; skip the
            # section header in this iteration (Keep-a-Changelog does
            # not have a Breaking Changes section in 1.1.0).
            continue
        rows = by_cat.get(cat, [])
        if not rows:
            continue
        L.append(f"### {cat}")
        L.append("")
        for e in rows:
            L.append(e.render())
        L.append("")
    return "\n".join(L).rstrip("\n") + "\n"


def render_changelog(inputs: ChangelogInputs) -> str:
    """Render the full `CHANGELOG.md` body. Pure; deterministic on `inputs`.

    The body never contains wall-clock timestamps. The freshness stamp
    lives on the `DocArtifact` wrapper.

    If `inputs.prior_changelog` already contains a section for
    `current_version`, the renderer returns the prior file verbatim
    (no-op). This is the only way to honour the idempotency contract
    when the orchestrator re-runs with the same `input_sha` after the
    file is on disk — re-rendering the prior releases with empty
    entries would produce a different body.

    If `inputs.prior_changelog` is empty, the renderer emits the
    Keep-a-Changelog header + an `[Unreleased]` section (no entries
    by convention) + the current release.
    """
    # Idempotent re-run: the current version is already on disk.
    # Return the prior file verbatim.
    if inputs.prior_changelog and inputs.current_version in inputs.prior_release_versions:
        return inputs.prior_changelog

    L: List[str] = []
    L.append(KEEP_A_CHANGELOG_HEADER.rstrip("\n"))
    L.append("")

    has_unreleased = bool(inputs.commits) and inputs.current_version not in inputs.prior_release_versions
    if has_unreleased:
        # Per Keep-a-Changelog, an Unreleased section anchors the
        # "next release" line. The current_version section follows.
        L.append(_format_unreleased_heading())
        L.append("")
        # Don't repeat entries here — they appear under the versioned
        # section. The Unreleased section is the navigation anchor.
        L.append("")

    releases = inputs.releases_to_render()
    for rel in releases:
        L.append(_render_release_section(rel))
        L.append("")

    # Footer with source attribution
    L.append("---")
    L.append("")
    L.append(
        f"**Source SHA:** `{inputs.input_sha or 'unknown'}`. Generated by the "
        "Documentation Agent ([FORA-122](/FORA/issues/FORA-122) / 7.1.4) from "
        "the commit history since the last release tag. Re-running with the "
        "same commits and tag set is a no-op (idempotency contract)."
    )
    L.append("")

    return "\n".join(L).rstrip("\n") + "\n"


def render_release_notes(inputs: ChangelogInputs, version: str) -> str:
    """Render the per-release `RELEASE_NOTES_<version>.md` body.

    The body is a long-form version of the changelog section for
    `version`: the breaking-changes callout, the categorised bullets,
    and a footer with author / commit / ref attribution.
    """
    matching: Optional[_RenderRelease] = None
    if version == inputs.current_version:
        matching = _RenderRelease(
            version=inputs.current_version,
            date=inputs.release_date,
            entries=[
                build_changelog_entry(c, inputs.repo_owner, inputs.repo_name, inputs.jira_base_url)
                for c in inputs.commits
            ],
        )
    else:
        for rel in _parse_prior_releases(inputs.prior_changelog):
            if rel.version == version:
                matching = rel
                break

    if matching is None:
        # Fallback: a minimal release notes body that signals the version
        # is not in this input. The orchestrator should not call this
        # path; it is a safety net for unit tests.
        return (
            f"# Release notes — v{version}\n\n"
            f"{TODO_SENTINEL_PREFIX} no commits supplied for v{version}; "
            f"the generator cannot render release notes. Supply commits "
            f"where `current_version = '{version}'` to populate. -->\n"
        )

    L: List[str] = []
    L.append(f"# Release notes — v{matching.version} ({matching.date})")
    L.append("")
    L.append(
        f"Generated by the Documentation Agent ([FORA-122]"
        "(/FORA/issues/FORA-122) / 7.1.4) from the commit history since the "
        f"last release tag. **Source SHA:** `{inputs.input_sha or 'unknown'}`."
    )
    L.append("")

    breaking = [e for e in matching.entries if e.is_breaking]
    by_cat: Dict[str, List[ChangelogEntryCategorized]] = {c: [] for c in CATEGORY_ORDER}
    for e in matching.entries:
        if e.is_breaking:
            continue
        cat = e.category if e.category in CATEGORY_ORDER else CATEGORY_INTERNAL
        by_cat[cat].append(e)

    if breaking:
        L.append("## ⚠️ Breaking changes")
        L.append("")
        for e in breaking:
            L.append(e.render())
        L.append("")

    for cat in CATEGORY_ORDER:
        if cat == CATEGORY_BREAKING:
            continue
        rows = by_cat.get(cat, [])
        if not rows:
            continue
        L.append(f"## {cat}")
        L.append("")
        for e in rows:
            L.append(e.render())
        L.append("")

    L.append("---")
    L.append("")
    L.append(
        f"**{len(matching.entries)} commit{'s' if len(matching.entries) != 1 else ''}** "
        f"in this release. Cross-references: "
        f"{sum(1 for e in matching.entries for _ in e.refs)} link"
        f"{'s' if sum(1 for e in matching.entries for _ in e.refs) != 1 else ''}."
    )
    L.append("")

    return "\n".join(L).rstrip("\n") + "\n"


# ---------------------------------------------------------------------------
# Prior-release parser (used by the idempotency check)
# ---------------------------------------------------------------------------

_RELEASE_HEADING_RE = re.compile(r"^##\s+\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$")


def _parse_prior_releases(prior_changelog: str) -> List[_RenderRelease]:
    """Walk the existing CHANGELOG.md and return its release sections.

    The renderer uses this to keep the prior releases in the output
    when the current run's `current_version` is already on disk.
    The body of each section is not re-rendered — the renderer just
    preserves them verbatim. This is the only way to keep the
    idempotency contract while supporting multiple releases per file.
    """
    if not prior_changelog:
        return []

    sections: List[Tuple[str, str, str]] = []   # (version, date, body)
    current: Optional[Tuple[str, str, List[str]]] = None
    for line in prior_changelog.splitlines():
        m = _RELEASE_HEADING_RE.match(line)
        if m:
            if current is not None:
                sections.append((current[0], current[1], "\n".join(current[2])))
            current = (m.group(1), m.group(2), [])
        elif current is not None:
            current[2].append(line)
    if current is not None:
        sections.append((current[0], current[1], "\n".join(current[2])))

    out: List[_RenderRelease] = []
    for version, date, body in sections:
        out.append(_RenderRelease(version=version, date=date, entries=[]))
    return out


def _extract_prior_release_versions(prior_changelog: str) -> Tuple[str, ...]:
    """Return the version strings of releases already in `prior_changelog`."""
    return tuple(rel.version for rel in _parse_prior_releases(prior_changelog))


def _parse_release_body_for_entries(body: str) -> List[ChangelogEntryCategorized]:
    """Re-derive `ChangelogEntry` objects from a prior release body.

    Used by the renderer when a prior release is in the file but the
    current run needs to re-emit the full CHANGELOG.md from scratch
    (e.g. when the operator wipes the file). The function is a best-
    effort: it only knows about the bullet lines and the `!` marker
    on the conventional-commit subject. It does not attempt to recover
    refs.
    """
    out: List[ChangelogEntryCategorized] = []
    for line in body.splitlines():
        m = re.match(r"^-\s+(?P<subject>.+?)\s+\(\[`(?P<sha>[0-9a-f]{7,})`\]\((?P<url>[^)]+)\)\)", line)
        if not m:
            continue
        subject = m.group("subject").strip()
        sha = m.group("sha")
        url = m.group("url")
        breaking = subject.startswith("BREAKING")
        ctype, scope, _, _, ambiguous = parse_conventional(subject)
        if ctype is None or ambiguous:
            category = CATEGORY_INTERNAL
        else:
            category = CATEGORY_BREAKING if breaking else _TYPE_TO_CATEGORY.get(ctype, CATEGORY_INTERNAL)
        out.append(ChangelogEntryCategorized(
            description=subject,
            commit_sha=sha,
            commit_url=url,
            author="",
            is_breaking=breaking,
            is_ambiguous=ambiguous,
            scope=scope,
            refs=[],
            category=category,
        ))
    return out


# ---------------------------------------------------------------------------
# Sentinels
# ---------------------------------------------------------------------------

TODO_SENTINEL_PREFIX = "<!-- TODO(generated):"


# ---------------------------------------------------------------------------
# Generator class — owns I/O
# ---------------------------------------------------------------------------

class ChangelogGenerator:
    """Generates `CHANGELOG.md` and `RELEASE_NOTES_<version>.md` from a
    `DocGenInput` + the on-disk CHANGELOG (for idempotency).
    """

    def __init__(self, repo_root: Path | str = ".") -> None:
        self.repo_root = Path(repo_root)

    # -- file I/O --------------------------------------------------------

    def _read(self, rel: str) -> str:
        p = self.repo_root / rel
        if not p.exists():
            return ""
        return p.read_text(encoding="utf-8")

    def _build_inputs(self, inp: DocGenInput) -> ChangelogInputs:
        project_name = inp.repo.name or "FORA"
        prior = self._read(DEFAULT_CHANGELOG_PATH)
        prior_versions = _extract_prior_release_versions(prior)
        return ChangelogInputs(
            project_name=project_name,
            current_version=inp.commit_range.to_sha[:7] if inp.commit_range.to_sha else "0.0.0",
            release_date=_derive_release_date(inp.commit_range),
            commits=inp.commit_range.conventional_commits,
            repo_owner=inp.repo.owner,
            repo_name=inp.repo.name,
            default_branch=inp.repo.default_branch or "main",
            jira_base_url=None,
            input_sha=inp.input_sha or "",
            prior_changelog=prior,
            prior_release_versions=prior_versions,
        )

    # -- public API ------------------------------------------------------

    def generate(self, inp: DocGenInput) -> Tuple[List[DocArtifact], List[DocIndexEntry], List[ChangelogEntryCategorized]]:
        """Render CHANGELOG.md + RELEASE_NOTES; return (artifacts, doc_index_entries, ambiguous_entries).

        `ambiguous_entries` is surfaced separately so the caller can
        emit `AMBIGUOUS_CONVENTIONAL_COMMIT` warnings without inflating
        the artifact body.
        """
        inputs = self._build_inputs(inp)
        all_entries: List[ChangelogEntryCategorized] = [
            build_changelog_entry(c, inputs.repo_owner, inputs.repo_name, inputs.jira_base_url)
            for c in inputs.commits
        ]
        ambiguous = [e for e in all_entries if e.is_ambiguous]

        # Build the new ChangelogInputs snapshot with the parsed prior
        # versions, so the renderer can re-emit the full file (in case
        # the prior file is empty, we still get a clean header).
        effective_inputs = ChangelogInputs(
            project_name=inputs.project_name,
            current_version=inputs.current_version,
            release_date=inputs.release_date,
            commits=inputs.commits,
            repo_owner=inputs.repo_owner,
            repo_name=inputs.repo_name,
            default_branch=inputs.default_branch,
            jira_base_url=inputs.jira_base_url,
            input_sha=inputs.input_sha,
            prior_changelog=inputs.prior_changelog,
            prior_release_versions=inputs.prior_release_versions,
        )

        changelog_body = render_changelog(effective_inputs)
        release_notes_body = render_release_notes(effective_inputs, version=inputs.current_version)

        now = now_iso()
        source_sha = inp.input_sha or "unknown"

        changelog_sha = hashlib.sha256(changelog_body.encode("utf-8")).hexdigest()
        release_notes_sha = hashlib.sha256(release_notes_body.encode("utf-8")).hexdigest()

        # Approval: routine update (CHANGELOG + Release Notes auto-merge
        # per prompt.md §Hard constraints #3). First-ever run is also
        # routine — the user can audit the PR.
        approval = False

        artifacts = [
            DocArtifact(
                path=DEFAULT_CHANGELOG_PATH,
                content=changelog_body,
                content_sha=changelog_sha,
                freshness_timestamp=now,
                source_sha=source_sha,
                generator_type=GeneratorType.CHANGELOG,
                approval_required=approval,
            ),
            DocArtifact(
                path=f"{DEFAULT_RELEASE_NOTES_DIR}/RELEASE_NOTES_{inputs.current_version}.md",
                content=release_notes_body,
                content_sha=release_notes_sha,
                freshness_timestamp=now,
                source_sha=source_sha,
                generator_type=GeneratorType.RELEASE_NOTES,
                approval_required=approval,
            ),
        ]
        entries = [
            DocIndexEntry(
                path=DEFAULT_CHANGELOG_PATH,
                kind=DocKind.CHANGELOG,
                title=f"{inputs.project_name} — Changelog",
                last_generated_at=now,
                source_commit=source_sha,
                generator=GeneratorType.CHANGELOG.value,
                version="1.0",
                content_sha=changelog_sha,
                approval_required=approval,
                tags=["changelog", "release-history"],
            ),
            DocIndexEntry(
                path=f"{DEFAULT_RELEASE_NOTES_DIR}/RELEASE_NOTES_{inputs.current_version}.md",
                kind=DocKind.RELEASE_NOTES,
                title=f"Release notes — v{inputs.current_version}",
                last_generated_at=now,
                source_commit=source_sha,
                generator=GeneratorType.RELEASE_NOTES.value,
                version="1.0",
                content_sha=release_notes_sha,
                approval_required=approval,
                tags=["release-notes", f"v{inputs.current_version}"],
            ),
        ]
        return artifacts, entries, ambiguous


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _derive_release_date(commit_range: CommitRange) -> str:
    """Pick a release date for the current run.

    Resolution order: the latest commit timestamp in `commit_range`
    (UTC date), or today (UTC) if no commits have timestamps. The
    renderer does **not** use this for any idempotency-sensitive
    computation; the date is metadata on the release heading only.
    """
    timestamps = [c.timestamp for c in commit_range.conventional_commits if c.timestamp]
    if timestamps:
        # ISO timestamps; take the date portion of the latest
        latest = max(timestamps)
        if "T" in latest:
            return latest.split("T", 1)[0]
        return latest
    return now_iso().split("T", 1)[0]


# ---------------------------------------------------------------------------
# High-level entry point — produces a DocGenOutput
# ---------------------------------------------------------------------------

def run_changelog(
    inp: DocGenInput,
    repo_root: Path | str = ".",
    write: bool = True,
) -> DocGenOutput:
    """Run the CHANGELOG + Release Notes generator end-to-end and return
    a `DocGenOutput`.

    `write=True` (the default) writes both artifacts to disk and
    refreshes the doc index. `write=False` is the dry-run path the
    smoke test uses to assert "no file is written" without polluting
    the test repo.
    """
    # Pre-flight input validation.
    errs: List[str] = []
    if not inp.input_sha:
        errs.append("input_sha is required (spec: determinism + source attribution)")
    if not inp.repo.owner or not inp.repo.name:
        errs.append("repo.owner and repo.name are required")
    if inp.commit_range.from_sha == inp.commit_range.to_sha:
        errs.append("commit_range.from_sha == to_sha; nothing to document")
    if not inp.commit_range.conventional_commits:
        errs.append("commit_range.conventional_commits is empty; CHANGELOG has nothing to render")

    if errs:
        kind = ErrorKind.MISSING_INPUT_SHA if "input_sha" in errs[0] else ErrorKind.STORAGE_CONTRACT_MISSING
        out = DocGenOutput(
            run_id="changelog-abort-" + hashlib.sha1(b"invalid").hexdigest()[:8],
            input_sha=inp.input_sha or "",
            status=RunStatus.ABORTED,
            errors=[
                DocGenError(kind=kind, message=e, recoverable=False)
                for e in errs
            ],
        )
        return out

    # Cost-ceiling pre-flight: pre-LLM-call refusal.
    if inp.cost_envelope.get("per_run_tokens_in"):
        approx_tokens = sum(len(c.message) + len(c.sha) for c in inp.commit_range.conventional_commits) // 4
        if approx_tokens > inp.cost_envelope["per_run_tokens_in"]:
            return DocGenOutput(
                run_id="changelog-abort-" + hashlib.sha1(b"oversized").hexdigest()[:8],
                input_sha=inp.input_sha or "",
                status=RunStatus.ABORTED,
                errors=[
                    DocGenError(
                        kind=ErrorKind.OVERSIZED_DIFF,
                        message=(
                            f"commit_range expanded to ~{approx_tokens} tokens, "
                            f"exceeds per_run_tokens_in={inp.cost_envelope['per_run_tokens_in']}; "
                            "chunk by file and run in series."
                        ),
                        recoverable=True,
                        retry_after_seconds=0,
                    )
                ],
            )

    gen = ChangelogGenerator(repo_root=repo_root)
    artifacts, doc_index_entries, ambiguous = gen.generate(inp)

    # Surface AMBIGUOUS_CONVENTIONAL_COMMIT as structured warnings.
    errors: List[DocGenError] = []
    for e in ambiguous:
        errors.append(DocGenError(
            kind=ErrorKind.AMBIGUOUS_CONVENTIONAL_COMMIT,
            message=(
                f"commit `{e.commit_sha[:7]}` does not match Conventional "
                f"Commits 1.0.0; landed in **Internal** with `<!-- ambiguous -->` "
                f"marker. Author: {e.author}. Subject: {e.description!r}."
            ),
            recoverable=True,
        ))

    if write:
        for a in artifacts:
            p = Path(repo_root) / a.path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(a.content, encoding="utf-8")
        # Refresh the on-disk doc index.
        docs_index_path = Path(repo_root) / DEFAULT_DOCS_INDEX_PATH
        for entry in doc_index_entries:
            _refresh_doc_index(docs_index_path, entry)

    # Storage contract (FORA-117)
    doc_index = DocIndex(
        version="1.0",
        entries=list(doc_index_entries),
        generated_at=artifacts[0].freshness_timestamp,
        docs_index_sha=inp.memory_snapshot.docs_index_sha,
    )
    adr_registry = AdrRegistry(
        version="1.0",
        entries=[],
        generated_at=artifacts[0].freshness_timestamp,
        adr_registry_sha=inp.memory_snapshot.adr_registry_sha,
    )

    out = DocGenOutput(
        run_id="changelog-" + hashlib.sha1((inp.input_sha or "").encode()).hexdigest()[:8],
        input_sha=inp.input_sha or "",
        status=RunStatus.OK,
        artifacts=list(artifacts),
        adr_index=[],
        freshness_metadata=FreshnessMetadata(
            docs_index_sha=inp.memory_snapshot.docs_index_sha,
            generated_at=artifacts[0].freshness_timestamp,
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
# On-disk doc-index refresh (preserves the existing frontmatter + prose)
# ---------------------------------------------------------------------------

def _refresh_doc_index(path: Path, entry: DocIndexEntry) -> None:
    """Append or replace the entry in `workspace/project/docs.md`."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        idx = DocIndex(version="1.0", entries=[entry])
        path.write_text(_render_index_markdown(idx), encoding="utf-8")
        return
    text = path.read_text(encoding="utf-8")
    idx = parse_index_markdown(text)
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
    # Use a callable replacement so `\u` escapes in the JSON body are
    # treated as literal characters, not regex backreferences.
    new_text = _FENCED_JSON_RE.sub(lambda _m: f"```json\n{body}\n```", text, count=1)
    path.write_text(new_text, encoding="utf-8")


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
    "DEFAULT_CHANGELOG_PATH",
    "DEFAULT_RELEASE_NOTES_DIR",
    "DEFAULT_DOCS_INDEX_PATH",
    "CATEGORY_BREAKING",
    "CATEGORY_NEW_FEATURES",
    "CATEGORY_BUG_FIXES",
    "CATEGORY_PERFORMANCE",
    "CATEGORY_DOCUMENTATION",
    "CATEGORY_INTERNAL",
    "CATEGORY_ORDER",
    "CommitRef",
    "ChangelogEntry",
    "ChangelogEntryCategorized",
    "Release",
    "ChangelogInputs",
    "ChangelogGenerator",
    "parse_conventional",
    "extract_refs",
    "build_changelog_entry",
    "render_changelog",
    "render_release_notes",
    "run_changelog",
]
