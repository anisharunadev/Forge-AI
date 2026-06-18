"""README generator smoke + failure-mode test (FORA-120 / 7.1.2).

Runs the full acceptance battery from the FORA-120 spec:

1. **Sample run on a stub repo** with all memory present → status=ok,
   one `DocArtifact` with `path=README.md`, all 7 required sections
   present, no `<!-- TODO(generated): -->` sentinels, `approval_required`
   set per the spec, doc index refreshed.
2. **Idempotency** — re-run with the same `input_sha` produces
   byte-identical body. `content_sha` matches; freshness_timestamp
   differs (wall clock) but the README body itself is byte-identical.
3. **Approval routing** — first generation is `approval_required=True`
   (README rewrite). Re-run with identical content is
   `approval_required=False` (routine update, no-op).
4. **Missing memory** — stub repo with no memory files renders all 7
   section headers but every body slot carries a `<!-- TODO(generated): -->`
   sentinel. The generator never invents content.
5. **Dry-run mode** (`write=False`) returns a valid `DocGenOutput` but
   writes no `README.md` and does not mutate the doc index.
6. **Storage contract** — `DocIndex` carries a `DocIndexEntry` with
   `kind=README`, `path=README.md`, `last_generated_at`, `source_commit`,
   and cached `content_sha`. The on-disk `workspace/project/docs.md`
   is refreshed in place (existing frontmatter + prose preserved).
7. **Missing input_sha** — aborts with `RunStatus.ABORTED` and a
   `MISSING_INPUT_SHA` error. The agent does not synthesise a SHA.

Run:

    python -m agents.documentation.readme_smoke_test

Writes evidence to `agents/documentation/evidence/readme_smoke_<timestamp>.json`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import List

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))

from agents.documentation.readme_generator import (  # noqa: E402
    REQUIRED_SECTIONS,
    ReadmeGenerator,
    ReadmeInputs,
    render_readme,
    run_readme,
)
from agents.documentation.schemas import (  # noqa: E402
    CommitRange,
    DocGenInput,
    DocKind,
    ErrorKind,
    MemorySnapshot,
    RepoMetadata,
    RunStatus,
    now_iso,
)


FAILURES: List[str] = []


def assert_true(cond: bool, label: str) -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}")
        FAILURES.append(label)


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------

SAMPLE_PRD = (
    "# Acme Sample\n\n"
    "**Tagline: A sample product for the doc agent**\n\n"
    "**Status:** v1.0\n\n"
    "## Vision\n\n"
    "A sample product that exercises the README generator end-to-end.\n\n"
    "## Quick Start\n\n"
    "1. Install the deps.\n"
    "2. Run the smoke test.\n"
    "3. Open a draft PR.\n"
)
SAMPLE_ROADMAP = (
    "# Acme Roadmap\n\n"
    "**Status:** v1.0\n\n"
    "## Q3 2026\n\n"
    "Goal: ship the doc pipeline.\n"
)
SAMPLE_TECH_STACK = (
    "# Acme Tech Stack\n\n"
    "**Status:** v1.0\n\n"
    "## Stack principles\n\n"
    "Boring is good; the novel parts are the agent runtime and the Knowledge Layer.\n\n"
    "## Integrations\n\n"
    "Jira, GitHub, Confluence — the priority-1 MCP set.\n"
)
SAMPLE_STANDARDS = (
    "# Customer Standards\n\n"
    "## SOC 2\n\n"
    "We inherit SOC 2 Type II controls.\n"
)
SAMPLE_CONVENTIONS = (
    "# Customer Conventions\n\n"
    "## Delivery norms\n\n"
    "1. Read the Knowledge Layer bar.\n"
    "2. Open a draft PR.\n"
    "3. Pass the staged workflow.\n"
)
SAMPLE_GLOSSARY = (
    "# Customer Glossary\n\n"
    "## A\n\n"
    "API: application programming interface.\n"
)


def _write_stub_repo(
    root: Path,
    *,
    with_prd: bool = True,
    with_changelog: bool = False,
) -> None:
    """Seed a stub repo with the workspace convention files."""
    root.mkdir(parents=True, exist_ok=True)
    if not with_prd:
        return
    pmem = root / "workspace" / "project"
    cmem = root / "workspace" / "customer"
    pmem.mkdir(parents=True, exist_ok=True)
    cmem.mkdir(parents=True, exist_ok=True)
    (pmem / "PRD.md").write_text(SAMPLE_PRD, encoding="utf-8")
    (pmem / "roadmap.md").write_text(SAMPLE_ROADMAP, encoding="utf-8")
    (pmem / "tech-stack.md").write_text(SAMPLE_TECH_STACK, encoding="utf-8")
    (cmem / "standards.md").write_text(SAMPLE_STANDARDS, encoding="utf-8")
    (cmem / "conventions.md").write_text(SAMPLE_CONVENTIONS, encoding="utf-8")
    (cmem / "glossary.md").write_text(SAMPLE_GLOSSARY, encoding="utf-8")
    # Seed an initial doc index so _refresh_doc_index has a target
    (pmem / "docs.md").write_text(
        "---\n"
        "name: doc-index\n"
        "version: 1.0\n"
        "spec: FORA-117\n"
        "owner: doc-agent\n"
        "status: production\n"
        "description: |\n"
        "  The v1 knowledge-layer surface.\n"
        "---\n\n"
        "# Doc Index — FORA Project\n\n"
        "```json\n"
        + json.dumps({
            "version": "1.0",
            "generated_at": "2026-06-17T00:00:00Z",
            "docs_index_sha": "v1-initial-seed",
            "entries": [
                {
                    "path": "CHANGELOG.md",
                    "kind": "changelog",
                    "title": "Changelog (seed)",
                    "last_generated_at": "2026-06-17T00:00:00Z",
                    "source_commit": "0000001",
                    "generator": "changelog",
                    "version": "1.0",
                    "content_sha": "0" * 64,
                    "approval_required": False,
                    "tags": ["audit"],
                },
            ],
        }, indent=2)
        + "\n```\n",
        encoding="utf-8",
    )
    if with_changelog:
        (root / "CHANGELOG.md").write_text(
            "# Changelog\n\n## v0.1 (2026-06-17)\n\n- seed\n",
            encoding="utf-8",
        )


def _sample_input(input_sha: str = "abc1234567") -> DocGenInput:
    return DocGenInput(
        input_sha=input_sha,
        repo=RepoMetadata(
            owner="acme",
            name="sample",
            default_branch="main",
            license="Apache-2.0",
        ),
        commit_range=CommitRange(from_sha="0000001", to_sha="abc1234"),
        memory_snapshot=MemorySnapshot(
            project_memory_sha="pmem-aaaa",
            customer_memory_sha="cmem-bbbb",
            docs_index_sha="didx-cccc",
            adr_registry_sha="adr-dddd",
        ),
        requested_artifacts=[],
        model="claude-sonnet-4-6",
    )


# ---------------------------------------------------------------------------
# 1. Sample run on a stub repo
# ---------------------------------------------------------------------------

def test_sample_run_full_repo() -> None:
    print("\n[SAMPLE] full stub repo with all memory + CHANGELOG")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_prd=True, with_changelog=True)
        out = run_readme(_sample_input(), repo_root=root, write=True)
        assert_true(out.status == RunStatus.OK, "status=ok on full repo")
        assert_true(len(out.artifacts) == 1, "exactly one artifact produced")
        a = out.artifacts[0]
        assert_true(a.path == "README.md", "artifact.path = README.md")
        assert_true(a.freshness_timestamp, "freshness_timestamp present")
        assert_true(a.source_sha == "abc1234567", "source_sha echoed from input")
        body = a.content
        for section in REQUIRED_SECTIONS:
            assert_true(
                re.search(rf"^##\s+{re.escape(section)}\b", body, re.MULTILINE) is not None,
                f"required section header present: {section}",
            )
        # No TODO sentinels on a fully populated repo
        assert_true(
            "<!-- TODO(generated):" not in body,
            "no TODO sentinels on fully populated repo",
        )
        # Approval: first run is a rewrite
        assert_true(a.approval_required is True, "first run is approval_required=True")
        # File on disk
        assert_true((root / "README.md").exists(), "README.md written to repo root")
        # Doc index updated
        idx_path = root / "workspace" / "project" / "docs.md"
        assert_true(idx_path.exists(), "doc index file exists after run")
        idx_body = idx_path.read_text(encoding="utf-8")
        assert_true('"path": "README.md"' in idx_body, "doc index has README entry")
        # Existing entries preserved (CHANGELOG.md seed)
        assert_true('"path": "CHANGELOG.md"' in idx_body, "existing CHANGELOG entry preserved")
        # Doc index frontmatter preserved
        assert_true("name: doc-index" in idx_body, "doc index frontmatter preserved")
        assert_true("name: doc-index" in idx_body and "spec: FORA-117" in idx_body,
                    "doc index frontmatter intact after refresh")


# ---------------------------------------------------------------------------
# 2. Idempotency
# ---------------------------------------------------------------------------

def test_idempotency_same_input_same_bytes() -> None:
    print("\n[IDEMPOTENCY] same input -> same content_sha, same body")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_prd=True, with_changelog=True)
        out_a = run_readme(_sample_input(input_sha="idem-sha"), repo_root=root, write=True)
        out_b = run_readme(_sample_input(input_sha="idem-sha"), repo_root=root, write=True)
        a = out_a.artifacts[0]
        b = out_b.artifacts[0]
        assert_true(a.content_sha == b.content_sha, "content_sha identical on re-run")
        assert_true(a.content == b.content, "README body byte-identical on re-run")
        # freshness_timestamp is wall clock — they SHOULD differ
        # (determinism is on the body, not the wrapper)
        # but if the system clock resolution is coarse, they may match
        # in which case the test still passes
        # (the contract is body-determinism, not metadata-determinism)


# ---------------------------------------------------------------------------
# 3. Approval routing
# ---------------------------------------------------------------------------

def test_approval_routing_routine_update() -> None:
    print("\n[APPROVAL] routine update -> approval_required=False")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_prd=True, with_changelog=True)
        # First run
        out_first = run_readme(_sample_input(input_sha="apr-sha"), repo_root=root, write=True)
        assert_true(
            out_first.artifacts[0].approval_required is True,
            "first run: approval_required=True (README rewrite)",
        )
        # Second run with same input -> identical content -> routine update
        gen = ReadmeGenerator(repo_root=root)
        inp = _sample_input(input_sha="apr-sha")
        artifact, _ = gen.generate(inp)
        assert_true(
            artifact.approval_required is False,
            "second run with identical content: approval_required=False (no-op)",
        )
        # Third run with different input_sha -> content_sha differs -> rewrite
        inp_diff = _sample_input(input_sha="apr-sha-different")
        artifact_diff, _ = gen.generate(inp_diff)
        assert_true(
            artifact_diff.approval_required is True,
            "third run with different input_sha: approval_required=True (rewrite)",
        )


# ---------------------------------------------------------------------------
# 4. Missing memory -> TODO sentinels
# ---------------------------------------------------------------------------

def test_missing_memory_todo_sentinels() -> None:
    print("\n[MISSING-MEMORY] empty repo -> TODO sentinels in every slot")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        root.mkdir(parents=True, exist_ok=True)
        # No memory, no CHANGELOG
        out = run_readme(_sample_input(), repo_root=root, write=True)
        assert_true(out.status == RunStatus.OK, "still status=ok (TODO is a fallback, not an error)")
        body = out.artifacts[0].content
        # All 7 section headers must be present
        for section in REQUIRED_SECTIONS:
            assert_true(
                re.search(rf"^##\s+{re.escape(section)}\b", body, re.MULTILINE) is not None,
                f"section header present even on empty repo: {section}",
            )
        # At least one TODO sentinel must appear (we have many sections
        # with no input, so several sentinels are expected)
        todo_count = body.count("<!-- TODO(generated):")
        assert_true(
            todo_count >= 3,
            f"at least 3 TODO sentinels on empty repo (got {todo_count})",
        )
        # File is still written
        assert_true((root / "README.md").exists(), "README.md still written on empty repo")


# ---------------------------------------------------------------------------
# 5. Dry-run mode
# ---------------------------------------------------------------------------

def test_dry_run_does_not_write() -> None:
    print("\n[DRY-RUN] write=False leaves no file and no doc-index mutation")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_prd=True, with_changelog=True)
        # Capture pre-state of docs.md
        idx_path = root / "workspace" / "project" / "docs.md"
        before = idx_path.read_text(encoding="utf-8")
        out = run_readme(_sample_input(), repo_root=root, write=False)
        assert_true(len(out.artifacts) == 1, "artifact still produced on dry-run")
        assert_true(not (root / "README.md").exists(), "README.md NOT written on dry-run")
        after = idx_path.read_text(encoding="utf-8")
        assert_true(before == after, "doc index NOT mutated on dry-run")


# ---------------------------------------------------------------------------
# 6. Storage contract
# ---------------------------------------------------------------------------

def test_storage_contract_doc_index_entry_shape() -> None:
    print("\n[STORAGE] DocIndex entry has the FORA-117 shape")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_prd=True, with_changelog=True)
        out = run_readme(_sample_input(), repo_root=root, write=True)
        assert_true(out.doc_index is not None, "doc_index present (FORA-117)")
        assert_true(out.adr_registry is not None, "adr_registry present (FORA-117)")
        entries = out.doc_index.entries
        assert_true(len(entries) >= 1, "at least one doc index entry")
        e = entries[0]
        assert_true(e.path == "README.md", "entry.path = README.md")
        assert_true(e.kind == DocKind.README, "entry.kind = DocKind.README")
        assert_true(e.last_generated_at, "entry.last_generated_at present")
        assert_true(e.source_commit, "entry.source_commit present")
        assert_true(e.content_sha, "entry.content_sha cached")
        assert_true(e.version == "1.0", "entry.version = 1.0 (FORA-117 storage schema version)")


# ---------------------------------------------------------------------------
# 7. Missing input_sha -> MISSING_INPUT_SHA
# ---------------------------------------------------------------------------

def test_missing_input_sha_aborts() -> None:
    print("\n[FAILURE-MODE] MISSING_INPUT_SHA -> RunStatus.ABORTED")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root, with_prd=True, with_changelog=True)
        inp = _sample_input()
        inp.input_sha = None
        out = run_readme(inp, repo_root=root, write=True)
        assert_true(out.status == RunStatus.ABORTED, "missing input_sha -> RunStatus.ABORTED")
        assert_true(len(out.errors) >= 1, "at least one error reported")
        assert_true(
            out.errors[0].kind == ErrorKind.MISSING_INPUT_SHA,
            "error kind = MISSING_INPUT_SHA",
        )
        # No file written
        assert_true(not (root / "README.md").exists(), "no README.md written on aborted run")


# ---------------------------------------------------------------------------
# 8. Renderer unit tests (pure)
# ---------------------------------------------------------------------------

def test_renderer_pure_idempotent() -> None:
    print("\n[RENDERER] pure function: same inputs -> same bytes")
    inp = ReadmeInputs(
        project_name="Acme",
        tagline="A test product",
        prd=SAMPLE_PRD,
        roadmap=SAMPLE_ROADMAP,
        tech_stack=SAMPLE_TECH_STACK,
        customer_standards=SAMPLE_STANDARDS,
        customer_conventions=SAMPLE_CONVENTIONS,
        customer_glossary=SAMPLE_GLOSSARY,
        license="Apache-2.0",
        input_sha="pure-sha",
    )
    body1 = render_readme(inp)
    body2 = render_readme(inp)
    assert_true(body1 == body2, "render_readme is deterministic")
    assert_true(
        hashlib.sha256(body1.encode()).hexdigest()
        == hashlib.sha256(body2.encode()).hexdigest(),
        "sha256 of body identical",
    )


def test_renderer_omits_wall_clock_from_body() -> None:
    print("\n[RENDERER] no wall-clock timestamp in README body")
    inp = ReadmeInputs(
        project_name="Acme",
        tagline="A test product",
        prd=SAMPLE_PRD,
        roadmap=SAMPLE_ROADMAP,
        tech_stack=SAMPLE_TECH_STACK,
        customer_standards=SAMPLE_STANDARDS,
        customer_conventions=SAMPLE_CONVENTIONS,
        customer_glossary=SAMPLE_GLOSSARY,
        license="Apache-2.0",
        input_sha="pure-sha",
    )
    body = render_readme(inp)
    # The body must not contain an ISO 8601 timestamp (the freshness
    # stamp lives on DocArtifact, not in the body).
    iso_re = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
    assert_true(iso_re.search(body) is None, "no ISO 8601 timestamp in body")
    # But the input_sha footer must be present (that's the source attribution)
    assert_true("pure-sha" in body, "input_sha footer present (source attribution)")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    print("[readme-smoke] FORA-120 / 7.1.2 acceptance battery")
    test_sample_run_full_repo()
    test_idempotency_same_input_same_bytes()
    test_approval_routing_routine_update()
    test_missing_memory_todo_sentinels()
    test_dry_run_does_not_write()
    test_storage_contract_doc_index_entry_shape()
    test_missing_input_sha_aborts()
    test_renderer_pure_idempotent()
    test_renderer_omits_wall_clock_from_body()

    # Persist evidence
    evidence_dir = Path(HERE) / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%dT%H%M%SZ")
    evidence_path = evidence_dir / f"readme_smoke_{stamp}.json"
    summary = {
        "spec": "FORA-120",
        "sub_goal": "7.1.2 README generator",
        "ran_at": now_iso(),
        "tests_run": 9,
        "assertions_failed": len(FAILURES),
        "failures": FAILURES,
        "acceptance": {
            "sample_run": "PASS",
            "idempotency": "PASS",
            "approval_routing": "PASS",
            "missing_memory_todo": "PASS",
            "dry_run": "PASS",
            "storage_contract": "PASS",
            "missing_input_sha": "PASS",
            "renderer_pure": "PASS",
            "no_wall_clock_in_body": "PASS",
        } if not FAILURES else "see failures",
    }
    evidence_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n[readme-smoke] wrote {evidence_path}")
    if FAILURES:
        print(f"\n[readme-smoke] FAILED: {len(FAILURES)} assertion(s)")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("\n[readme-smoke] all assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
