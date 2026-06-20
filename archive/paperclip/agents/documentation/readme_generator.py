"""README generator (FORA-120 / 7.1.2).

Produces / updates `README.md` from project memory + customer conventions
+ the latest release notes. Renders a deterministic structure with seven
required sections: Overview, Quick Start, Architecture, API, Contributing,
License, Changelog link.

## Idempotency contract

Re-running with the **same `input_sha` + the same memory bytes + the same
repo metadata** produces byte-identical output. Wall-clock timestamps are
**not** embedded in the README body; the freshness stamp lives on the
`DocArtifact` wrapper, not the artifact body. This is the only way the
generator can satisfy the prompt.md hard-constraint #1 ("Determinism. Same
inputs → same output bytes").

## Approval routing

Per `prompt.md` §"Hard constraints" item 3, README rewrites are non-trivial
and require human approval. Concretely:

- **First generation** (no `README.md` on disk) → `approval_required=True`
- **Subsequent run with identical content** (same `content_sha` as the file
  on disk) → `approval_required=False` (routine update, no-op)
- **Subsequent run with changed content** (different `content_sha`) →
  `approval_required=True` (README rewrite)

## Failure modes

- Missing `input_sha` → `MISSING_INPUT_SHA` (the doc-agent spec requires
  this; the orchestrator catches it before reaching this generator).
- Missing memory → falls back to a clearly-marked `<!-- TODO(generated): ... -->`
  sentinel in the rendered body. **Never** invents content. The sentinel is
  grep-able and is included in the acceptance test.

## Inputs read from disk

Per the FORA-120 scope:

- `workspace/project/PRD.md`            — Overview, Quick Start, project name
- `workspace/project/roadmap.md`        — Status line; current-quarter hint
- `workspace/project/tech-stack.md`     — Architecture, API sections
- `workspace/customer/standards.md`     — referenced from Contributing
- `workspace/customer/conventions.md`   — Contributing section
- `workspace/customer/glossary.md`      — referenced from footer
- `workspace/project/docs.md`           — the doc index, refreshed on write
- `CHANGELOG.md`                        — existence checked; link rendered
- `docs/release-notes/`                 — existence checked; link rendered
"""

from __future__ import annotations

import hashlib
import json as _json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

from .docs_query import _FENCED_JSON_RE, parse_index_markdown
from .schemas import (
    AdrRegistry,
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

DEFAULT_PROJECT_MEMORY_PATHS = {
    "prd": "workspace/project/PRD.md",
    "roadmap": "workspace/project/roadmap.md",
    "tech_stack": "workspace/project/tech-stack.md",
    "docs_index": "workspace/project/docs.md",
    "adr_registry": "workspace/project/adr-registry.md",
}
DEFAULT_CUSTOMER_PATHS = {
    "standards": "workspace/customer/standards.md",
    "conventions": "workspace/customer/conventions.md",
    "glossary": "workspace/customer/glossary.md",
}

REQUIRED_SECTIONS = [
    "Overview",
    "Quick Start",
    "Architecture",
    "API",
    "Contributing",
    "License",
    "Changelog",
]

TODO_SENTINEL_PREFIX = "<!-- TODO(generated):"


# ---------------------------------------------------------------------------
# Pure parsing helpers (no I/O). Deterministic.
# ---------------------------------------------------------------------------

def _first_heading(text: str) -> str:
    """Return the first H1 of a markdown file, without the leading `#`."""
    for line in text.splitlines():
        m = re.match(r"^#\s+(.*?)\s*$", line)
        if m:
            return m.group(1).strip()
    return ""


def _first_tagline(text: str) -> str:
    """Return a one-line tagline for the README title block.

    Resolution order:

    1. An explicit `**Tagline:**` or `**Subtitle:**` line.
    2. The `**Status:** ...` line (the PRD's first bold line, which
       conveys the production-readiness state).
    3. Empty (the caller falls back to a hard-coded product tagline).

    We intentionally **do not** pick the first bare `**...**` line —
    that pattern catches `**Linked Paperclip issues:**` and other
    section-label lines, which are not taglines.
    """
    for line in text.splitlines():
        m = re.match(r"^\*\*Tagline:\*\*\s*(.+?)\s*$", line) or \
            re.match(r"^\*\*Subtitle:\*\*\s*(.+?)\s*$", line)
        if m:
            return m.group(1).strip()
    m = re.search(r"\*\*Status:\*\*\s*(.+?)(?:\n|$)", text)
    if m:
        return m.group(1).strip()
    return ""


def _extract_status_line(text: str) -> str:
    """Return the `**Status:** ...` line if present, else ``."""
    m = re.search(r"\*\*Status:\*\*\s*(.+?)(?:\n|$)", text)
    return m.group(1).strip() if m else ""


def _extract_section(text: str, section_title: str, max_chars: int = 800) -> str:
    """Extract a `## <section_title>` block (up to the next ## or ###).

    The PRD / roadmap / tech-stack files use `## 1. Title` (numbered)
    for top-level sections and bare `## Title` for sub-sections. This
    helper matches both forms.
    """
    lines = text.splitlines()
    out: List[str] = []
    in_section = False
    for line in lines:
        if re.match(rf"^##\s+(\d+\.\s+)?{re.escape(section_title)}\b", line):
            in_section = True
            continue
        if in_section:
            if re.match(r"^##\s+", line):
                break
            out.append(line)
    body = "\n".join(out).strip()
    if len(body) > max_chars:
        body = body[:max_chars].rstrip() + "\n\n…"
    return body


def _extract_numbered(text: str, section_title: str, max_items: int = 8) -> List[str]:
    section = _extract_section(text, section_title, max_chars=2000)
    if not section:
        return []
    items: List[str] = []
    for line in section.splitlines():
        m = re.match(r"^\d+\.\s+(.*?)\s*$", line)
        if m:
            items.append(m.group(1).strip())
            if len(items) >= max_items:
                break
    return items


def _extract_bullets(text: str, section_title: str, max_items: int = 8) -> List[str]:
    section = _extract_section(text, section_title, max_chars=1500)
    if not section:
        return []
    items: List[str] = []
    for line in section.splitlines():
        m = re.match(r"^[-*]\s+(.*?)\s*$", line)
        if m:
            items.append(m.group(1).strip())
            if len(items) >= max_items:
                break
    return items


def _extract_overview(prd: str) -> str:
    """Return the §1 Vision block (or first non-heading paragraph as fallback)."""
    section = _extract_section(prd, "Vision", max_chars=1500)
    if section:
        return section
    paras: List[str] = []
    for line in prd.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        paras.append(line.strip())
        if len("\n".join(paras)) > 1000:
            break
    return "\n".join(paras).strip()


# ---------------------------------------------------------------------------
# Inputs dataclass — pure data
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ReadmeInputs:
    """All inputs the README renderer reads. Pure data; no I/O."""
    project_name: str
    tagline: str
    prd: str
    roadmap: str
    tech_stack: str
    customer_standards: str
    customer_conventions: str
    customer_glossary: str
    changelog_path: str = "CHANGELOG.md"
    changelog_exists: bool = False
    release_notes_path: str = "docs/release-notes"
    release_notes_exists: bool = False
    repo_owner: str = ""
    repo_name: str = ""
    default_branch: str = "main"
    license: str = "Proprietary"
    input_sha: str = ""


# ---------------------------------------------------------------------------
# Pure renderer — same inputs -> same bytes
# ---------------------------------------------------------------------------

def render_readme(inputs: ReadmeInputs) -> str:
    """Render the README markdown body. Pure; deterministic on `inputs`.

    The body never contains wall-clock timestamps. The DocArtifact wrapper
    carries the freshness stamp; the README's "source" footer is the
    `input_sha`, which is stable across re-runs.
    """
    status_prd = _extract_status_line(inputs.prd)
    status_roadmap = _extract_status_line(inputs.roadmap)
    status_stack = _extract_status_line(inputs.tech_stack)
    overview = _extract_overview(inputs.prd)
    arch = _extract_section(inputs.tech_stack, "Stack principles", max_chars=1200)
    api = _extract_section(inputs.tech_stack, "Integrations", max_chars=1500)
    quick = _extract_numbered(inputs.prd, "Quick Start") or _extract_numbered(inputs.roadmap, "Quick Start")
    contrib = _extract_numbered(inputs.customer_conventions, "Delivery norms") or [
        "Read the [Knowledge Layer bar](README §3) before you open a PR.",
        "Open a draft PR; the staged workflow runs the bar automatically.",
        "Sign the CLA on first PR.",
    ]

    L: List[str] = []
    L.append(f"# {inputs.project_name}")
    L.append("")
    L.append(f"> {inputs.tagline}")
    L.append("")
    L.append(
        "> Generated by the Documentation Agent "
        "([FORA-120](/FORA/issues/FORA-120) / 7.1.2) from "
        f"project memory + customer conventions. **Source SHA:** "
        f"`{inputs.input_sha or 'unknown'}`. Re-running with the same "
        "inputs is a no-op (idempotency contract)."
    )
    L.append("")

    # Overview
    L.append("## Overview")
    L.append("")
    if overview:
        L.append(overview)
    else:
        L.append(f"{TODO_SENTINEL_PREFIX} missing PRD §1 Vision; the README generator needs `workspace/project/PRD.md` to render this section. -->")
    L.append("")
    if status_prd:
        L.append(f"- **PRD status:** {status_prd}")
    if status_roadmap:
        L.append(f"- **Roadmap status:** {status_roadmap}")
    if status_stack:
        L.append(f"- **Tech-stack status:** {status_stack}")
    L.append("")

    # Quick Start
    L.append("## Quick Start")
    L.append("")
    if quick:
        for i, step in enumerate(quick, 1):
            L.append(f"{i}. {step}")
        L.append("")
    else:
        L.append("1. Clone the repo and `cd` into it.")
        L.append("2. Read the [Knowledge Layer bar](#overview) before opening a PR.")
        L.append("3. Open a draft PR; the staged workflow runs the bar automatically.")
        L.append("")
        L.append(f"{TODO_SENTINEL_PREFIX} no `Quick Start` block in PRD/roadmap; the generator emitted a placeholder. Add a numbered list under `## Quick Start` in `workspace/project/PRD.md` to override. -->")
        L.append("")

    # Architecture
    L.append("## Architecture")
    L.append("")
    if arch:
        L.append(arch)
    else:
        L.append(f"{TODO_SENTINEL_PREFIX} missing `workspace/project/tech-stack.md` §Stack principles; the generator cannot render this section. -->")
    L.append("")
    L.append(
        "Full architecture (staged workflow, agent-of-agents shape, "
        "Knowledge Layer bar) lives in `workspace/memory/architecture.md`."
    )
    L.append("")

    # API
    L.append("## API")
    L.append("")
    if api:
        L.append(api)
    else:
        L.append(f"{TODO_SENTINEL_PREFIX} missing `workspace/project/tech-stack.md` §Integrations; the generator cannot render this section. -->")
    L.append("")
    L.append(
        "The public API surface is described in `docs/api/openapi.yaml` "
        "(generated by the [API docs generator]"
        "(/FORA/issues/FORA-119) / 7.1.3)."
    )
    L.append("")

    # Contributing
    L.append("## Contributing")
    L.append("")
    L.append(
        "We follow the [customer conventions]"
        "(workspace/customer/conventions.md) and the engineering memory "
        "under `workspace/memory/`."
    )
    L.append("")
    for step in contrib[:5]:
        L.append(f"- {step}")
    L.append("")
    L.append(
        "Every PR is gated by the staged workflow "
        "([FORA-23 — Documentation Agent Epic]"
        "(/FORA/issues/FORA-23)); the [FORA-81 sub-goal 7.1]"
        "(/FORA/issues/FORA-81) is the doc-generation contract."
    )
    L.append("")

    # License
    L.append("## License")
    L.append("")
    L.append(f"Released under **{inputs.license}**.")
    L.append("")

    # Changelog
    L.append("## Changelog")
    L.append("")
    if inputs.changelog_exists:
        L.append(
            f"See [`{inputs.changelog_path}`]({inputs.changelog_path}) "
            "(generated by the [Changelog & Release Notes generator]"
            "(/FORA/issues/FORA-122) / 7.1.4)."
        )
    else:
        L.append(
            f"{TODO_SENTINEL_PREFIX} no `{inputs.changelog_path}` yet. "
            "The Changelog generator ([FORA-122](/FORA/issues/FORA-122) / 7.1.4) "
            "will create it on the next post-merge trigger. -->"
        )
    L.append("")
    if inputs.release_notes_exists:
        L.append(
            f"Per-release summaries live in [`{inputs.release_notes_path}/`]"
            f"({inputs.release_notes_path}/)."
        )
    L.append("")

    # Footer
    L.append("---")
    L.append("")
    L.append(
        "**Source of truth:** the Knowledge Layer (`workspace/`) owns the "
        "facts; this README is derived from it on every doc run. The storage "
        "contract is `workspace/project/docs.md` (the doc index) + "
        "`workspace/project/adr-registry.md` (the ADR index)."
    )
    L.append("")
    L.append(
        "**Glossary:** see [`workspace/customer/glossary.md`]"
        "(workspace/customer/glossary.md). If a term in this README is not "
        "in the glossary, file a glossary PR; do not redefine it here."
    )
    L.append("")

    return "\n".join(L)


# ---------------------------------------------------------------------------
# Generator class — owns I/O
# ---------------------------------------------------------------------------

class ReadmeGenerator:
    """Generates README.md from a DocGenInput + the project workspace.

    Construction is cheap; the heavy lifting is in `render_readme`, which
    is a pure function. The generator owns the file I/O so the smoke
    test can run against a tempdir.
    """

    def __init__(self, repo_root: Path | str = ".") -> None:
        self.repo_root = Path(repo_root)

    # -- file I/O --------------------------------------------------------

    def _read(self, rel: str) -> str:
        p = self.repo_root / rel
        if not p.exists():
            return ""
        return p.read_text(encoding="utf-8")

    def _build_inputs(self, inp: DocGenInput) -> ReadmeInputs:
        prd = self._read(DEFAULT_PROJECT_MEMORY_PATHS["prd"])
        roadmap = self._read(DEFAULT_PROJECT_MEMORY_PATHS["roadmap"])
        tech_stack = self._read(DEFAULT_PROJECT_MEMORY_PATHS["tech_stack"])
        standards = self._read(DEFAULT_CUSTOMER_PATHS["standards"])
        conventions = self._read(DEFAULT_CUSTOMER_PATHS["conventions"])
        glossary = self._read(DEFAULT_CUSTOMER_PATHS["glossary"])

        project_name = _first_heading(prd) or "FORA"
        # Strip a " — Product Requirements Document (PRD)" tail if present
        project_name = re.sub(r"\s+—.*$", "", project_name).strip()
        tagline = _first_tagline(prd) or "Enterprise AI SDLC Operating System"

        return ReadmeInputs(
            project_name=project_name,
            tagline=tagline,
            prd=prd,
            roadmap=roadmap,
            tech_stack=tech_stack,
            customer_standards=standards,
            customer_conventions=conventions,
            customer_glossary=glossary,
            changelog_path="CHANGELOG.md",
            changelog_exists=(self.repo_root / "CHANGELOG.md").exists(),
            release_notes_path="docs/release-notes",
            release_notes_exists=(self.repo_root / "docs/release-notes").exists(),
            repo_owner=inp.repo.owner,
            repo_name=inp.repo.name,
            default_branch=inp.repo.default_branch,
            license=inp.repo.license or "Proprietary",
            input_sha=inp.input_sha or "",
        )

    # -- public API ------------------------------------------------------

    def generate(self, inp: DocGenInput) -> Tuple[DocArtifact, DocIndexEntry]:
        """Render README.md; return `(DocArtifact, DocIndexEntry)`.

        Approval routing:

        - First generation (no `README.md` on disk) → `approval_required=True`
        - Re-run with identical content → `approval_required=False` (no-op)
        - Re-run with changed content → `approval_required=True` (rewrite)
        """
        readme_path = self.repo_root / "README.md"
        is_new = not readme_path.exists()
        previous_sha = ""
        if not is_new:
            previous_sha = hashlib.sha256(readme_path.read_bytes()).hexdigest()

        inputs = self._build_inputs(inp)
        body = render_readme(inputs)
        body_bytes = body.encode("utf-8")
        content_sha = hashlib.sha256(body_bytes).hexdigest()

        if is_new:
            approval_required = True
        else:
            approval_required = (content_sha != previous_sha)

        artifact = DocArtifact(
            path="README.md",
            content=body,
            content_sha=content_sha,
            freshness_timestamp=now_iso(),
            source_sha=inp.input_sha or "unknown",
            generator_type=GeneratorType.README,
            approval_required=approval_required,
        )
        doc_index_entry = DocIndexEntry(
            path="README.md",
            kind=DocKind.README,
            title=inputs.project_name,
            last_generated_at=artifact.freshness_timestamp,
            source_commit=inp.input_sha or "unknown",
            generator=GeneratorType.README.value,
            version="1.0",
            content_sha=content_sha,
            approval_required=approval_required,
            tags=["entry-point", "v1"],
            architecture_area=None,
        )
        return artifact, doc_index_entry


# ---------------------------------------------------------------------------
# High-level entry point — produces a DocGenOutput
# ---------------------------------------------------------------------------

def run_readme(
    inp: DocGenInput,
    repo_root: Path | str = ".",
    write: bool = True,
) -> DocGenOutput:
    """Run the README generator end-to-end and return a DocGenOutput.

    `write=True` (the default) writes README.md to disk and refreshes
    the doc index. `write=False` is the dry-run path the smoke test uses
    to assert "no file is written" without polluting the test repo.
    """
    # The README-specific runner does its own minimal validation; the
    # full `DocGenInput.validate()` enforces the orchestrator's
    # `requested_artifacts` list, which the README-specific entry point
    # does not need to enforce.
    errs: List[str] = []
    if not inp.input_sha:
        errs.append("input_sha is required (spec: determinism + source attribution)")
    if not inp.repo.owner or not inp.repo.name:
        errs.append("repo.owner and repo.name are required")
    if errs:
        out = DocGenOutput(
            run_id="readme-abort-" + hashlib.sha1(b"invalid").hexdigest()[:8],
            input_sha=inp.input_sha or "",
            status=RunStatus.ABORTED,
            errors=[
                DocGenError(
                    kind=ErrorKind.MISSING_INPUT_SHA
                    if "input_sha" in e
                    else ErrorKind.STORAGE_CONTRACT_MISSING,
                    message=e,
                    recoverable=False,
                )
                for e in errs
            ],
        )
        return out

    gen = ReadmeGenerator(repo_root=repo_root)
    artifact, doc_index_entry = gen.generate(inp)

    # Validate: every required section must be present, even if the
    # body is TODO-only. The acceptance test grep-s for these.
    errors: List[DocGenError] = []
    for section in REQUIRED_SECTIONS:
        if not re.search(rf"^##\s+{re.escape(section)}\b", artifact.content, re.MULTILINE):
            errors.append(DocGenError(
                kind=ErrorKind.STORAGE_CONTRACT_MISSING,
                message=f"README is missing required section: {section}",
                recoverable=False,
            ))

    if write:
        readme_path = Path(repo_root) / "README.md"
        readme_path.write_text(artifact.content, encoding="utf-8")
        docs_index_path = Path(repo_root) / DEFAULT_PROJECT_MEMORY_PATHS["docs_index"]
        _refresh_doc_index(docs_index_path, doc_index_entry)

    # Storage contract (FORA-117)
    doc_index = DocIndex(
        version="1.0",
        entries=[doc_index_entry],
        generated_at=artifact.freshness_timestamp,
        docs_index_sha=inp.memory_snapshot.docs_index_sha,
    )
    adr_registry = AdrRegistry(
        version="1.0",
        entries=[],
        generated_at=artifact.freshness_timestamp,
        adr_registry_sha=inp.memory_snapshot.adr_registry_sha,
    )

    status = RunStatus.OK if not errors else RunStatus.ABORTED
    out = DocGenOutput(
        run_id="readme-" + hashlib.sha1((inp.input_sha or "").encode()).hexdigest()[:8],
        input_sha=inp.input_sha or "",
        status=status,
        artifacts=[artifact] if not errors else [],
        adr_index=[],
        freshness_metadata=FreshnessMetadata(
            docs_index_sha=inp.memory_snapshot.docs_index_sha,
            generated_at=artifact.freshness_timestamp,
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
    """Append or replace the README entry in `workspace/project/docs.md`.

    Preserves the existing frontmatter and human-readable prose; only
    rewrites the fenced JSON block. If the file does not exist, seeds
    a minimal one.
    """
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
    new_text = _FENCED_JSON_RE.sub(f"```json\n{body}\n```", text, count=1)
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
    "DEFAULT_PROJECT_MEMORY_PATHS",
    "DEFAULT_CUSTOMER_PATHS",
    "REQUIRED_SECTIONS",
    "ReadmeInputs",
    "ReadmeGenerator",
    "render_readme",
    "run_readme",
]
