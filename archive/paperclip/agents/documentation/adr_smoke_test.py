"""ADR generator smoke + failure-mode test (FORA-121 / 7.1.5).

Runs the full acceptance battery from the FORA-121 spec:

1. **Sample run on a stub repo** with `// ADR:` comments + a HLD-style
   `## ADR NNNN: ...` block → produces MADR-format ADR files
   (`docs/adr/NNNN-title.md`), a refreshed `docs/adr/README.md`
   index, and a refreshed `workspace/project/adr-registry.md`.
   status=ok, monotonic numbering, approval_required=True for new
   ADRs, index approval_required=False.
2. **Idempotency** — re-run with the same `input_sha` + same
   decision-point set produces byte-identical ADR file bodies and
   the same `docs/adr/README.md`. The re-run emits only the index
   refresh (no new ADR file) because the keys are already on disk.
3. **MADR format** — every ADR carries the five MADR sections
   (Context, Decision, Status, Consequences, Alternatives
   Considered) in order, with `## Status` rendered as a header
   field and the rest as `## <section>` blocks.
4. **Monotonic numbering** — the next number is `max(on-disk
   filesystem, registry) + 1`. Pre-existing ADRs on disk are
   preserved and new ADRs continue from there.
5. **Cross-linking** — every ADR header carries `[Jira-id](url)` /
   `[PR #N](url)` / `[#N](url)` / `` [`path`](url) `` chips parsed
   from the source via `extract_decision_refs`.
6. **Approval routing** — new ADR = `approval_required=True` per
   `prompt.md` §"Hard constraints" #3. Index refresh
   (no new ADRs) = `approval_required=False`.
7. **Missing input_sha** → abort with `RunStatus.ABORTED` and a
   `MISSING_INPUT_SHA` error. The agent does not synthesise a SHA.
8. **OVERSIZED_DIFF** → abort when the combined decision-point
   input would breach the per-run input token ceiling.
9. **Dry-run mode** (`write=False`) returns a valid `DocGenOutput`
   but writes no ADR file and does not mutate the on-disk registry
   or doc index.
10. **Storage contract** — `DocIndex` carries entries for each
    new ADR + the index; on-disk `workspace/project/docs.md` and
    `workspace/project/adr-registry.md` are refreshed.
11. **Detection: `// ADR:` comments** — the orchestrator-facing
    detector pulls decision points out of source-code comments.
12. **Detection: HLD/LLD/PR markdown** — the orchestrator-facing
    detector pulls decision points out of markdown documents
    (canonical MADR with `## Context` / `## Decision` headings,
    plus the inline `Context: ...` / `Decision: ...` fallback).
13. **Renderer is pure / deterministic** — same `DecisionPoint` +
    same number + same `source_sha` produce a byte-identical
    body across runs.

Run:

    python -m agents.documentation.adr_smoke_test

Writes evidence to `agents/documentation/evidence/adr_smoke_<timestamp>.json`.
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

from agents.documentation.adr_generator import (  # noqa: E402
    AdrGenerator,
    AdrInputs,
    DecisionPoint,
    DecisionRef,
    DEFAULT_ADR_DIR,
    DEFAULT_ADR_INDEX_PATH,
    DEFAULT_ADR_REGISTRY_PATH,
    DEFAULT_DOCS_INDEX_PATH,
    MADR_SECTIONS,
    detect_decision_points_from_comments,
    detect_decision_points_from_markdown,
    extract_decision_refs,
    render_adr,
    render_index,
    run_adr,
)
from agents.documentation.schemas import (  # noqa: E402
    AdrStatus,
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

SAMPLE_HLD = """\
# HLD — FORA Agent-of-Agents Platform

## Decision

This is a body section, NOT a decision point (must not be picked up
by the markdown detector as a separate decision).

## ADR 0001: Use Postgres for the run DB

We need transactional state for run rows. Postgres is the obvious
choice; SQLite is the alternative we rejected.

Decision: Postgres 16 with pgvector.

Consequences: one more dep to operate.

Alternatives Considered: SQLite (rejected — no concurrent writers).

## ADR 0002: Adopt pgvector for embedding search

Semantic search across run rows is in scope for v1.1.

Decision: pgvector extension on the run DB.

Consequences: shared ops footprint; one fewer external service.

Alternatives Considered: separate vector store (rejected — extra dep).
"""

SAMPLE_CODE = """\
// ADR: Use Redis for the cache layer
//   Context: we need sub-millisecond cache reads
//   Decision: Redis 7 with cluster mode
//   Consequences: another datstore to operate
//   Alternatives: in-process LRU (rejected — no cross-process sharing)

func otherCode() {}

// ADR-0001: pinned (not a new ADR; just a trace marker)
"""

SAMPLE_INPUT_SHA = "abc1234567"


def _sample_input(
    input_sha: str = SAMPLE_INPUT_SHA,
    *,
    decision_points: List[DecisionPoint] = None,
) -> DocGenInput:
    return DocGenInput(
        input_sha=input_sha,
        repo=RepoMetadata(
            owner="fora",
            name="fora",
            default_branch="main",
            license="Apache-2.0",
        ),
        commit_range=CommitRange(
            from_sha="0000001",
            to_sha="abc1234",
            conventional_commits=[],
        ),
        memory_snapshot=MemorySnapshot(
            project_memory_sha="pmem-aaaa",
            customer_memory_sha="cmem-bbbb",
            docs_index_sha="didx-cccc",
            adr_registry_sha="adr-dddd",
        ),
        requested_artifacts=[],
    )


def _detect_decision_points() -> List[DecisionPoint]:
    """The orchestrator's job: pull decision points out of HLD + code."""
    pts: List[DecisionPoint] = []
    pts.extend(detect_decision_points_from_markdown(SAMPLE_HLD, source_label="forge/2.3/hld.md"))
    pts.extend(detect_decision_points_from_comments(SAMPLE_CODE, source_label="src/cache.go:10"))
    # Add cross-link refs from the natural sources
    for p in pts:
        if "Postgres" in p.title:
            p.refs = extract_decision_refs(
                "See FORA-35 and PR #101. Closes #13. Touches src/db.py.",
                "fora", "fora", "https://fora.atlassian.net",
            )
            p.issue = "FORA-35"
        elif "pgvector" in p.title:
            p.refs = extract_decision_refs(
                "See FORA-35.",
                "fora", "fora", "https://fora.atlassian.net",
            )
            p.issue = "FORA-35"
        elif "Redis" in p.title:
            p.refs = extract_decision_refs(
                "See FORA-126 and #7. Touches src/cache.py.",
                "fora", "fora", "https://fora.atlassian.net",
            )
            p.issue = "FORA-126"
    return pts


def _write_stub_repo(root: Path) -> None:
    """Seed a stub repo with the workspace convention files."""
    root.mkdir(parents=True, exist_ok=True)
    pmem = root / "workspace" / "project"
    pmem.mkdir(parents=True, exist_ok=True)
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
            "entries": [],
        }, indent=2)
        + "\n```\n",
        encoding="utf-8",
    )
    (pmem / "adr-registry.md").write_text(
        "---\n"
        "name: adr-registry\n"
        "version: 1.0\n"
        "spec: FORA-117\n"
        "owner: doc-agent\n"
        "status: production\n"
        "description: |\n"
        "  Storage contract for the ADR generator (FORA-121, sub-goal 7.1.5).\n"
        "---\n\n"
        "# ADR Registry — FORA Project\n\n"
        "```json\n"
        + json.dumps({
            "version": "1.0",
            "generated_at": "2026-06-17T00:00:00Z",
            "adr_registry_sha": "v1-initial-seed",
            "entries": [],
        }, indent=2)
        + "\n```\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# 1. Sample run on a stub repo
# ---------------------------------------------------------------------------

def test_sample_run_full_repo() -> None:
    print("\n[SAMPLE] full stub repo with HLD + code decision points")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        pts = _detect_decision_points()
        out = run_adr(_sample_input(), decision_points=pts, repo_root=root, write=True)

        assert_true(out.status == RunStatus.OK, "status=ok on full repo")
        # 3 ADRs (Postgres, pgvector, Redis) + 1 index = 4 artifacts
        assert_true(len(out.artifacts) == 4, f"4 artifacts produced (3 ADRs + 1 index), got {len(out.artifacts)}")

        # Find each ADR + the index
        adrs = [a for a in out.artifacts if a.path.startswith("docs/adr/") and not a.path.endswith("README.md")]
        idx = next(a for a in out.artifacts if a.path == "docs/adr/README.md")
        assert_true(len(adrs) == 3, f"3 new ADRs produced, got {len(adrs)}")
        assert_true(idx.generator_type.value == "adr", "index generator_type = adr")

        # Freshness + source attribution on every artifact
        for a in out.artifacts:
            assert_true(a.freshness_timestamp, f"{a.path}: freshness_timestamp present")
            assert_true(a.source_sha == SAMPLE_INPUT_SHA, f"{a.path}: source_sha echoed from input")

        # Approval routing
        for a in adrs:
            assert_true(a.approval_required is True, f"{a.path}: approval_required=True (new ADR)")
        assert_true(idx.approval_required is False, "index: approval_required=False (derived)")

        # MADR format checks on each ADR
        for a in adrs:
            body = a.content
            assert_true(
                re.match(r"^#\s+\d{4}\s+—\s+", body) is not None,
                f"{a.path}: opens with `# NNNN — <title>`",
            )
            assert_true("- **Status:**" in body, f"{a.path}: header has **Status**")
            assert_true("- **Date:**" in body, f"{a.path}: header has **Date**")
            assert_true("- **Architecture area:**" in body, f"{a.path}: header has **Architecture area**")
            for sec in MADR_SECTIONS:
                if sec == "Status":
                    continue
                assert_true(
                    f"## {sec}" in body,
                    f"{a.path}: MADR section `## {sec}` present",
                )

        # Cross-linking on the Postgres ADR
        pg = next(a for a in adrs if "postgres" in a.path.lower())
        body = pg.content
        assert_true("[FORA-35]" in body, "Postgres ADR: Jira ref FORA-35 deep-linked")
        assert_true("[PR #101]" in body, "Postgres ADR: PR #101 deep-linked")
        assert_true("[#13]" in body, "Postgres ADR: GitHub issue #13 deep-linked")
        assert_true("[`src/db.py`]" in body, "Postgres ADR: code path `src/db.py` deep-linked")

        # Monotonic numbering: 0001, 0002, 0003 (no pre-existing on disk)
        numbers = sorted(int(re.match(r"^docs/adr/(\d{4})-", a.path).group(1)) for a in adrs)
        assert_true(numbers == [1, 2, 3], f"monotonic numbering 0001-0003, got {numbers}")

        # Files on disk
        adr_dir = root / "docs" / "adr"
        assert_true(adr_dir.exists(), "docs/adr/ created")
        assert_true(len(list(adr_dir.glob("*.md"))) == 4, "4 .md files on disk (3 ADRs + README.md)")
        assert_true((adr_dir / "README.md").exists(), "docs/adr/README.md written")

        # Storage contract
        reg_text = (root / "workspace" / "project" / "adr-registry.md").read_text()
        m = re.search(r"```json\n(.*?)\n```", reg_text, re.DOTALL)
        assert_true(m is not None, "registry has fenced JSON body")
        reg_body = json.loads(m.group(1))
        reg_numbers = sorted(e["number"] for e in reg_body["entries"])
        assert_true(reg_numbers == [1, 2, 3], f"registry has 3 entries numbered 1-3, got {reg_numbers}")

        idx_text = (root / "workspace" / "project" / "docs.md").read_text()
        m = re.search(r"```json\n(.*?)\n```", idx_text, re.DOTALL)
        assert_true(m is not None, "doc index has fenced JSON body")
        idx_body = json.loads(m.group(1))
        idx_paths = {e["path"]: e for e in idx_body["entries"]}
        assert_true("docs/adr/README.md" in idx_paths, "doc index has ADR index entry")
        for adr in adrs:
            assert_true(adr.path in idx_paths, f"doc index has {adr.path} entry")
            assert_true(idx_paths[adr.path]["kind"] == "adr", f"{adr.path}: kind=adr")
            assert_true(idx_paths[adr.path]["approval_required"] is True, f"{adr.path}: approval_required=True")


# ---------------------------------------------------------------------------
# 2. Idempotency
# ---------------------------------------------------------------------------

def test_idempotency_same_input_same_bytes() -> None:
    print("\n[IDEMPOTENCY] same input -> same ADR bytes, index refresh only")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        pts = _detect_decision_points()
        out_a = run_adr(_sample_input(input_sha="idem-sha"), decision_points=pts, repo_root=root, write=True)
        out_b = run_adr(_sample_input(input_sha="idem-sha"), decision_points=pts, repo_root=root, write=True)

        # Re-run produced ONLY the index refresh (no new ADR file).
        new_adr_paths_b = [a.path for a in out_b.artifacts if not a.path.endswith("README.md")]
        assert_true(len(new_adr_paths_b) == 0, f"re-run produces no new ADR files (got {new_adr_paths_b})")

        # Snapshot the on-disk ADR bodies BEFORE the re-run check; the
        # re-run must not rewrite any of them. Byte-identity after the
        # re-run is the idempotency contract for ADR files.
        for p in (root / "docs" / "adr").glob("*.md"):
            if p.name == "README.md":
                continue
            body_a = out_a.artifacts
            a_body = next((x.content for x in body_a if x.path == f"docs/adr/{p.name}"), None)
            assert_true(a_body is not None, f"run-1 produced {p.name}")
            body_disk = p.read_text(encoding="utf-8")
            assert_true(
                hashlib.sha256(a_body.encode()).hexdigest() == hashlib.sha256(body_disk.encode()).hexdigest(),
                f"{p.name}: body byte-identical after re-run (idempotency contract)",
            )

        # Index body byte-identical between runs
        idx_a = next(a for a in out_a.artifacts if a.path == "docs/adr/README.md")
        idx_b = next(a for a in out_b.artifacts if a.path == "docs/adr/README.md")
        assert_true(idx_a.content == idx_b.content, "index body byte-identical on re-run")
        assert_true(idx_a.content_sha == idx_b.content_sha, "index content_sha identical on re-run")


# ---------------------------------------------------------------------------
# 3. MADR format (renderer-level)
# ---------------------------------------------------------------------------

def test_madr_format_structure() -> None:
    print("\n[FORMAT] renderer output is valid MADR")
    p = DecisionPoint(
        title="Use Postgres",
        context="Need transactional state.",
        decision="Postgres 16.",
        status=AdrStatus.ACCEPTED,
        consequences="One more dep.",
        alternatives="SQLite (rejected).",
        architecture_area="runtime",
        tags=["database"],
        source="HLD §3",
        issue="FORA-35",
        deciders="CTO",
    )
    body = render_adr(p, 7, "FORA", "abc1234")
    # Header
    assert_true(body.startswith("# 0007 — Use Postgres\n"), "title is `# 0007 — Use Postgres`")
    assert_true("- **Status:** accepted" in body, "header carries **Status: accepted**")
    assert_true("- **Deciders:** CTO" in body, "header carries **Deciders**")
    assert_true("- **Issue:** [FORA-35](/FORA/issues/FORA-35)" in body, "header deep-links to Jira issue")
    # Sections in order
    positions = [body.find(f"## {s}") for s in MADR_SECTIONS if s != "Status"]
    assert_true(all(p > 0 for p in positions), "all four body sections rendered")
    assert_true(positions == sorted(positions), "MADR sections rendered in canonical order")
    # Footer
    assert_true("Re-running with the same decision set" in body, "idempotency contract footer present")
    assert_true("FORA-121" in body, "footer references the spec (FORA-121)")


def test_madr_omits_wall_clock_from_body() -> None:
    print("\n[FORMAT] no wall-clock timestamp in body")
    p = DecisionPoint(
        title="Use Postgres",
        context="Need transactional state.",
        decision="Postgres 16.",
    )
    body = render_adr(p, 1, "FORA", "pure-sha")
    # The body must not contain an ISO 8601 timestamp (the freshness
    # stamp lives on DocArtifact, not in the body).
    iso_re = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
    assert_true(iso_re.search(body) is None, "no ISO 8601 timestamp in ADR body")
    # But the input_sha footer must be present (source attribution)
    assert_true("pure-sha" in body, "input_sha footer present (source attribution)")


# ---------------------------------------------------------------------------
# 4. Monotonic numbering (filesystem + registry)
# ---------------------------------------------------------------------------

def test_monotonic_numbering_with_pre_existing() -> None:
    print("\n[NUMBERING] next number is max(filesystem, registry) + 1")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        # Seed two pre-existing ADRs (one on disk, one only in registry)
        (root / "docs" / "adr").mkdir(parents=True, exist_ok=True)
        (root / "docs" / "adr" / "0001-pre-existing.md").write_text("# 0001 — Pre-existing\n", encoding="utf-8")
        # Update the registry to include 0005 (a future number, not on disk)
        reg_text = (root / "workspace" / "project" / "adr-registry.md").read_text()
        body = json.dumps({
            "version": "1.0", "generated_at": "2026-06-17T00:00:00Z", "adr_registry_sha": "v1",
            "entries": [
                {"number": 1, "title": "Pre-existing on disk", "path": "docs/adr/0001-pre-existing.md",
                 "status": "accepted", "date": "2026-06-17", "architecture_area": "general",
                 "tags": [], "supersedes": None, "superseded_by": None,
                 "source_commit": "0000001", "last_generated_at": "2026-06-17T00:00:00Z"},
                {"number": 5, "title": "Pre-existing in registry only", "path": "docs/adr/0005-not-on-disk.md",
                 "status": "accepted", "date": "2026-06-17", "architecture_area": "general",
                 "tags": [], "supersedes": None, "superseded_by": None,
                 "source_commit": "0000001", "last_generated_at": "2026-06-17T00:00:00Z"},
            ]
        }, indent=2)
        new_text = re.sub(r"```json\n.*?\n```", f"```json\n{body}\n```", reg_text, count=1, flags=re.DOTALL)
        (root / "workspace" / "project" / "adr-registry.md").write_text(new_text, encoding="utf-8")

        # Run with one new decision point
        p = DecisionPoint(title="New thing", context="C.", decision="D.")
        out = run_adr(_sample_input(), decision_points=[p], repo_root=root, write=True)
        # Next number is max(1, 5) + 1 = 6
        adr = next(a for a in out.artifacts if "new-thing" in a.path)
        m = re.match(r"^docs/adr/(\d{4})-", adr.path)
        assert_true(m and int(m.group(1)) == 6, f"new ADR numbered 0006 (max(filesystem=1, registry=5) + 1), got {m.group(1) if m else 'none'}")


# ---------------------------------------------------------------------------
# 5. Cross-linking (parser-level)
# ---------------------------------------------------------------------------

def test_ref_parsing_jira_pr_github_code_path() -> None:
    print("\n[REFS] Jira, PR, GitHub issue, code-path refs parsed")
    refs = extract_decision_refs(
        "See FORA-35 and PR #101. Closes #13. Touches src/db.py.",
        "fora", "fora", "https://fora.atlassian.net",
    )
    kinds = [r.kind for r in refs]
    ids = [r.id for r in refs]
    assert_true("jira" in kinds, "Jira ref FORA-35 detected")
    assert_true("pr" in kinds, "PR ref #101 detected")
    assert_true("github_issue" in kinds, "GitHub issue #13 detected")
    assert_true("code_path" in kinds, "code path src/db.py detected")
    # URLs
    jira = next(r for r in refs if r.id == "FORA-35")
    assert_true(jira.url == "https://fora.atlassian.net/FORA-35", "Jira URL uses jira_base_url")
    pr = next(r for r in refs if r.id == "101")
    assert_true(pr.url == "https://github.com/fora/fora/pull/101", "PR URL uses owner/repo")
    issue = next(r for r in refs if r.id == "13")
    assert_true(issue.url == "https://github.com/fora/fora/issues/13", "issue URL uses owner/repo")
    cp = next(r for r in refs if r.id == "src/db.py")
    assert_true(cp.url == "https://github.com/fora/fora/blob/main/src/db.py", "code-path URL uses owner/repo")


# ---------------------------------------------------------------------------
# 6. Approval routing
# ---------------------------------------------------------------------------

def test_approval_routing_new_adr_requires_approval() -> None:
    print("\n[APPROVAL] new ADR -> approval_required=True; index -> False")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        pts = _detect_decision_points()
        out = run_adr(_sample_input(input_sha="apr-sha"), decision_points=pts, repo_root=root, write=True)
        for a in out.artifacts:
            if a.path.endswith("README.md"):
                assert_true(a.approval_required is False, "index: approval_required=False")
            else:
                assert_true(a.approval_required is True, f"{a.path}: approval_required=True (new ADR)")


# ---------------------------------------------------------------------------
# 7. Missing input_sha -> MISSING_INPUT_SHA
# ---------------------------------------------------------------------------

def test_missing_input_sha_aborts() -> None:
    print("\n[FAILURE-MODE] MISSING_INPUT_SHA -> RunStatus.ABORTED")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        inp = _sample_input()
        inp.input_sha = None
        out = run_adr(inp, decision_points=_detect_decision_points(), repo_root=root, write=True)
        assert_true(out.status == RunStatus.ABORTED, "missing input_sha -> RunStatus.ABORTED")
        assert_true(len(out.errors) >= 1, "at least one error reported")
        assert_true(
            out.errors[0].kind == ErrorKind.MISSING_INPUT_SHA,
            "error kind = MISSING_INPUT_SHA",
        )
        # No file written
        assert_true(
            not (root / "docs" / "adr").exists() or len(list((root / "docs" / "adr").glob("*.md"))) == 0,
            "no ADR files written on aborted run",
        )


# ---------------------------------------------------------------------------
# 8. Oversized diff
# ---------------------------------------------------------------------------

def test_oversized_diff_aborts() -> None:
    print("\n[FAILURE-MODE] OVERSIZED_DIFF -> RunStatus.ABORTED")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        big_pts = [
            DecisionPoint(
                title="Big decision",
                context="x " * 5000,
                decision="y " * 5000,
                consequences="z " * 5000,
                alternatives="w " * 5000,
            )
            for _ in range(20)
        ]
        inp = _sample_input()
        inp.cost_envelope = {"per_run_tokens_in": 1000, "per_run_tokens_out": 300}
        out = run_adr(inp, decision_points=big_pts, repo_root=root, write=True)
        assert_true(out.status == RunStatus.ABORTED, "oversized diff -> RunStatus.ABORTED")
        assert_true(
            any(e.kind == ErrorKind.OVERSIZED_DIFF for e in out.errors),
            "error kind = OVERSIZED_DIFF",
        )


# ---------------------------------------------------------------------------
# 9. Dry-run mode
# ---------------------------------------------------------------------------

def test_dry_run_does_not_write() -> None:
    print("\n[DRY-RUN] write=False leaves no file and no doc-index mutation")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        idx_path = root / "workspace" / "project" / "docs.md"
        reg_path = root / "workspace" / "project" / "adr-registry.md"
        idx_before = idx_path.read_text()
        reg_before = reg_path.read_text()
        out = run_adr(_sample_input(input_sha="dry-sha"), decision_points=_detect_decision_points(), repo_root=root, write=False)
        assert_true(out.status == RunStatus.OK, "dry-run still returns ok")
        assert_true(len(out.artifacts) == 4, "4 artifacts in dry-run output")
        assert_true(not (root / "docs" / "adr").exists() or not list((root / "docs" / "adr").glob("*.md")),
                    "no ADR files written on dry-run")
        assert_true(idx_path.read_text() == idx_before, "doc index NOT mutated on dry-run")
        assert_true(reg_path.read_text() == reg_before, "ADR registry NOT mutated on dry-run")


# ---------------------------------------------------------------------------
# 10. Storage contract
# ---------------------------------------------------------------------------

def test_storage_contract_doc_index_and_registry() -> None:
    print("\n[STORAGE] DocIndex + AdrRegistry both populated")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        pts = _detect_decision_points()
        out = run_adr(_sample_input(input_sha="storage-sha"), decision_points=pts, repo_root=root, write=True)
        assert_true(out.doc_index is not None, "doc_index present (FORA-117)")
        assert_true(out.adr_registry is not None, "adr_registry present (FORA-117)")
        assert_true(len(out.doc_index.entries) >= 4, "doc index has ≥ 4 entries (3 ADRs + index)")
        assert_true(len(out.adr_registry.entries) == 3, "adr_registry has 3 entries")
        for e in out.doc_index.entries:
            assert_true(e.last_generated_at, f"{e.path}: last_generated_at present")
            assert_true(e.source_commit, f"{e.path}: source_commit present")
            assert_true(e.version == "1.0", f"{e.path}: version = 1.0 (FORA-117 storage schema)")
            if e.kind == DocKind.ADR and not e.path.endswith("README.md"):
                assert_true(e.approval_required is True, f"{e.path}: approval_required=True (new ADR)")


# ---------------------------------------------------------------------------
# 11. Detection: `// ADR:` comments
# ---------------------------------------------------------------------------

def test_detect_decision_points_from_comments() -> None:
    print("\n[DETECT] `// ADR:` comments pulled out of source code")
    pts = detect_decision_points_from_comments(SAMPLE_CODE, "src/cache.go:10")
    # One new ADR (Redis). The pinned `// ADR-0001:` is a trace marker, not a new ADR.
    assert_true(len(pts) == 1, f"1 new decision point (pinned trace marker excluded), got {len(pts)}")
    p = pts[0]
    assert_true(p.key == "use-redis-for-the-cache-layer", f"key slugified: {p.key!r}")
    assert_true(p.title == "Use Redis for the cache layer", "title parsed")
    assert_true("sub-millisecond" in p.context, "Context section parsed")
    assert_true("Redis 7" in p.decision, "Decision section parsed")
    assert_true("datstore" in p.consequences, "Consequences section parsed")
    assert_true("in-process LRU" in p.alternatives, "Alternatives section parsed")


# ---------------------------------------------------------------------------
# 12. Detection: HLD/LLD/PR markdown (canonical + inline)
# ---------------------------------------------------------------------------

def test_detect_decision_points_from_markdown_canonical() -> None:
    print("\n[DETECT] HLD-style canonical MADR (with `## Section` headings)")
    pts = detect_decision_points_from_markdown(SAMPLE_HLD, "forge/2.3/hld.md")
    # Two decision points (Postgres + pgvector). The bare `## Decision`
    # is a body section, not a new decision-point title.
    assert_true(len(pts) == 2, f"2 decision points from HLD, got {len(pts)}")
    titles = [p.title for p in pts]
    assert_true("Use Postgres for the run DB" in titles, "Postgres ADR title parsed")
    assert_true("Adopt pgvector for embedding search" in titles, "pgvector ADR title parsed")
    # Sections
    pg = next(p for p in pts if "Postgres" in p.title)
    assert_true("transactional" in pg.context, "Postgres context parsed (canonical MADR)")
    assert_true("Postgres 16" in pg.decision, "Postgres decision parsed (canonical MADR)")


def test_detect_decision_points_from_markdown_inline() -> None:
    print("\n[DETECT] inline form (no `## Section` headings, just `Field: value`)")
    md = """
## ADR 0001: Use Redis

Context: we need sub-ms cache reads.

Decision: Redis 7.

Consequences: another datastore.

Alternatives Considered: in-process LRU (rejected).
"""
    pts = detect_decision_points_from_markdown(md, "hld.md")
    assert_true(len(pts) == 1, "1 decision point from inline form")
    p = pts[0]
    assert_true(p.title == "Use Redis", "title parsed (ADR-NNNN prefix stripped)")
    assert_true("sub-ms" in p.context, "inline Context parsed")
    assert_true("Redis 7" in p.decision, "inline Decision parsed")
    assert_true("datastore" in p.consequences, "inline Consequences parsed")
    assert_true("in-process" in p.alternatives, "inline Alternatives parsed")


def test_detect_decision_points_markdown_ignores_bare_decision_section() -> None:
    print("\n[DETECT] bare `## Decision` is a body section, not a decision point")
    md = """
## Decision

This is a body section in a PR description. It is not a new ADR.

## ADR 0001: Use Redis

Decision: Redis 7.
"""
    pts = detect_decision_points_from_markdown(md, "pr.md")
    titles = [p.title for p in pts]
    assert_true("This is a body section" not in titles, "bare `## Decision` body NOT picked up as a decision-point title")
    assert_true("Use Redis" in titles, "real ADR still picked up")


# ---------------------------------------------------------------------------
# 13. Renderer pure / determinism
# ---------------------------------------------------------------------------

def test_renderer_pure_idempotent() -> None:
    print("\n[RENDERER] pure function: same inputs -> same bytes")
    p = DecisionPoint(
        title="Use Postgres",
        context="Need transactional state.",
        decision="Postgres 16.",
        consequences="One more dep.",
        alternatives="SQLite (rejected).",
    )
    body1 = render_adr(p, 1, "FORA", "pure-sha")
    body2 = render_adr(p, 1, "FORA", "pure-sha")
    assert_true(body1 == body2, "render_adr is deterministic")
    assert_true(
        hashlib.sha256(body1.encode()).hexdigest()
        == hashlib.sha256(body2.encode()).hexdigest(),
        "sha256 of ADR body identical",
    )

    # render_index is also deterministic
    from agents.documentation.schemas import AdrRegistryEntry
    entries = (
        AdrRegistryEntry(number=1, title="A", path="docs/adr/0001-a.md", status=AdrStatus.ACCEPTED,
                          date="2026-06-17", architecture_area="general", source_commit="abc", last_generated_at="2026-06-17T00:00:00Z"),
        AdrRegistryEntry(number=2, title="B", path="docs/adr/0002-b.md", status=AdrStatus.PROPOSED,
                          date="2026-06-17", architecture_area="general", source_commit="abc", last_generated_at="2026-06-17T00:00:00Z"),
    )
    idx1 = render_index(entries, "FORA")
    idx2 = render_index(entries, "FORA")
    assert_true(idx1 == idx2, "render_index is deterministic")
    # Sorted by number
    assert_true(idx1.find("0001") < idx1.find("0002"), "index entries sorted by number")


def test_render_index_empty_registry() -> None:
    print("\n[RENDERER] render_index with no entries says so honestly")
    body = render_index((), "FORA")
    assert_true("No ADRs yet." in body, "empty registry renders an honest 'No ADRs yet.' line")


# ---------------------------------------------------------------------------
# 14. Index groups by status
# ---------------------------------------------------------------------------

def test_render_index_groups_by_status() -> None:
    print("\n[RENDERER] index groups entries by status")
    from agents.documentation.schemas import AdrRegistryEntry
    entries = (
        AdrRegistryEntry(number=1, title="A", path="docs/adr/0001-a.md", status=AdrStatus.ACCEPTED,
                          date="2026-06-17", architecture_area="general", source_commit="abc", last_generated_at="2026-06-17T00:00:00Z"),
        AdrRegistryEntry(number=2, title="B", path="docs/adr/0002-b.md", status=AdrStatus.PROPOSED,
                          date="2026-06-17", architecture_area="general", source_commit="abc", last_generated_at="2026-06-17T00:00:00Z"),
        AdrRegistryEntry(number=3, title="C", path="docs/adr/0003-c.md", status=AdrStatus.SUPERSEDED,
                          date="2026-06-17", architecture_area="general", source_commit="abc", last_generated_at="2026-06-17T00:00:00Z"),
    )
    body = render_index(entries, "FORA")
    pos_accepted = body.find("### Accepted")
    pos_proposed = body.find("### Proposed")
    pos_superseded = body.find("### Superseded")
    assert_true(pos_accepted > 0, "Accepted group present")
    assert_true(pos_proposed > 0, "Proposed group present")
    assert_true(pos_superseded > 0, "Superseded group present")
    # Sorted: Accepted first
    assert_true(pos_accepted < pos_proposed < pos_superseded, "groups in canonical status order")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    print("[adr-smoke] FORA-121 / 7.1.5 acceptance battery")
    test_sample_run_full_repo()
    test_idempotency_same_input_same_bytes()
    test_madr_format_structure()
    test_madr_omits_wall_clock_from_body()
    test_monotonic_numbering_with_pre_existing()
    test_ref_parsing_jira_pr_github_code_path()
    test_approval_routing_new_adr_requires_approval()
    test_missing_input_sha_aborts()
    test_oversized_diff_aborts()
    test_dry_run_does_not_write()
    test_storage_contract_doc_index_and_registry()
    test_detect_decision_points_from_comments()
    test_detect_decision_points_from_markdown_canonical()
    test_detect_decision_points_from_markdown_inline()
    test_detect_decision_points_markdown_ignores_bare_decision_section()
    test_renderer_pure_idempotent()
    test_render_index_empty_registry()
    test_render_index_groups_by_status()

    # Persist evidence
    evidence_dir = Path(HERE) / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%dT%H%M%SZ")
    evidence_path = evidence_dir / f"adr_smoke_{stamp}.json"
    summary = {
        "spec": "FORA-121",
        "sub_goal": "7.1.5 ADR generator",
        "ran_at": now_iso(),
        "tests_run": 17,
        "assertions_failed": len(FAILURES),
        "failures": FAILURES,
        "acceptance": {
            "sample_run": "PASS",
            "idempotency": "PASS",
            "madr_format": "PASS",
            "no_wall_clock_in_body": "PASS",
            "monotonic_numbering": "PASS",
            "cross_linking_refs": "PASS",
            "approval_routing": "PASS",
            "missing_input_sha": "PASS",
            "oversized_diff": "PASS",
            "dry_run": "PASS",
            "storage_contract": "PASS",
            "detect_from_comments": "PASS",
            "detect_from_markdown_canonical": "PASS",
            "detect_from_markdown_inline": "PASS",
            "detect_markdown_ignores_bare_decision": "PASS",
            "renderer_pure": "PASS",
            "render_index_empty": "PASS",
            "render_index_groups_by_status": "PASS",
        } if not FAILURES else "see failures",
    }
    evidence_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n[adr-smoke] wrote {evidence_path}")
    if FAILURES:
        print(f"\n[adr-smoke] FAILED: {len(FAILURES)} assertion(s)")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("\n[adr-smoke] all assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
