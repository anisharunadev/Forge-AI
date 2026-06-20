"""Changelog & Release Notes generator smoke + failure-mode test (FORA-122 / 7.1.4).

Runs the full acceptance battery from the FORA-122 spec:

1. **Sample run on a stub repo** with conventional commits (feat, fix,
   perf, docs, chore, breaking) → produces a valid `CHANGELOG.md` in
   Keep-a-Changelog format, plus a `RELEASE_NOTES_<version>.md`.
   status=ok, 2 artifacts, all 6 categories represented, breaking
   changes surfaced in a top callout box, every entry deep-links to
   its source commit.
2. **Idempotency** — re-run with the same `input_sha` + same commit
   set + same `current_version` produces byte-identical `CHANGELOG.md`
   and `RELEASE_NOTES_*.md` bodies. The release section already in
   the prior file is reused verbatim.
3. **Keep-a-Changelog format** — header anchor + `## [version] - date`
   + category sub-headers + bullet list. Structure validated by regex.
4. **Breaking changes callout** — every `feat!` / `fix!` / `BREAKING
   CHANGE:` commit appears in a `> [!WARNING]` callout box at the top
   of its release section, and in the per-release notes' `## ⚠️
   Breaking changes` section.
5. **Cross-linking** — every entry carries a `[\\`<sha>\\`](url)` deep
   link; commits with `Closes FORA-123` / `Refs #456` / `PR #789`
   bodies carry additional ref chips.
6. **Approval routing** — first-ever and subsequent runs are
   `approval_required=False` (CHANGELOG / Release Notes are routine
   per `prompt.md` §"Hard constraints" #3).
7. **Missing input_sha** → abort with `RunStatus.ABORTED` and a
   `MISSING_INPUT_SHA` error. The agent does not synthesise a SHA.
8. **Ambiguous conventional commit** → run completes with status=ok,
   but a structured `AMBIGUOUS_CONVENTIONAL_COMMIT` warning is
   surfaced and the entry lands in the **Internal** bucket with a
   `<!-- ambiguous -->` marker.
9. **Oversized diff** → `OVERSIZED_DIFF` abort when the commit set
   expanded would exceed the per-run input token ceiling.
10. **Dry-run mode** (`write=False`) returns a valid `DocGenOutput`
    but writes no `CHANGELOG.md` and does not mutate the doc index.
11. **Storage contract** — `DocIndex` carries entries for both
    `CHANGELOG.md` and `RELEASE_NOTES_*.md`; on-disk
    `workspace/project/docs.md` is refreshed.

Run:

    python -m agents.documentation.changelog_smoke_test

Writes evidence to `agents/documentation/evidence/changelog_smoke_<timestamp>.json`.
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

from agents.documentation.changelog_generator import (  # noqa: E402
    CATEGORY_BREAKING,
    CATEGORY_BUG_FIXES,
    CATEGORY_DOCUMENTATION,
    CATEGORY_INTERNAL,
    CATEGORY_NEW_FEATURES,
    CATEGORY_ORDER,
    CATEGORY_PERFORMANCE,
    ChangelogGenerator,
    ChangelogInputs,
    ChangelogEntryCategorized,
    build_changelog_entry,
    extract_refs,
    parse_conventional,
    render_changelog,
    render_release_notes,
    run_changelog,
)
from agents.documentation.schemas import (  # noqa: E402
    CommitRange,
    ConventionalCommit,
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

SAMPLE_COMMITS: List[ConventionalCommit] = [
    ConventionalCommit(
        sha="abc1234abcd0000",
        message="feat(api): add /healthz endpoint",
        author="alice@example.com",
        timestamp="2026-06-18T10:00:00Z",
        parsed_type="feat",
        parsed_scope="api",
        breaking=False,
    ),
    ConventionalCommit(
        sha="def5678efgh0000",
        message="fix(auth): handle expired token",
        author="bob@example.com",
        timestamp="2026-06-18T11:00:00Z",
        parsed_type="fix",
        parsed_scope="auth",
        breaking=False,
    ),
    ConventionalCommit(
        sha="111aaa222bbb000",
        message=(
            "feat(iam): add OIDC broker\n\n"
            "Closes FORA-125 and FORA-126. Refs #42. PR #101."
        ),
        author="carol@example.com",
        timestamp="2026-06-18T12:00:00Z",
        parsed_type="feat",
        parsed_scope="iam",
        breaking=True,
    ),
    ConventionalCommit(
        sha="222bbb333ccc000",
        message="perf(db): index the sessions table (FORA-130)",
        author="dan@example.com",
        timestamp="2026-06-18T13:00:00Z",
        parsed_type="perf",
        parsed_scope="db",
        breaking=False,
    ),
    ConventionalCommit(
        sha="333ccc444ddd000",
        message="docs(readme): add 'Quick Start' to contributing guide",
        author="eve@example.com",
        timestamp="2026-06-18T14:00:00Z",
        parsed_type="docs",
        parsed_scope="readme",
        breaking=False,
    ),
    ConventionalCommit(
        sha="444ddd555eee000",
        message="chore(deps): bump @aws-sdk/client-secretsmanager to 3.700.0",
        author="frank@example.com",
        timestamp="2026-06-18T15:00:00Z",
        parsed_type="chore",
        parsed_scope="deps",
        breaking=False,
    ),
    ConventionalCommit(
        sha="555eee666fff000",
        message="fix(checkout)!: drop /v0 routes\n\nBREAKING CHANGE: /v0 routes return 410 Gone",
        author="grace@example.com",
        timestamp="2026-06-18T16:00:00Z",
        parsed_type="fix",
        parsed_scope="checkout",
        breaking=True,
    ),
    ConventionalCommit(
        sha="666fff777aaa000",
        message="WIP - experiments on the indexer, not done yet",
        author="heidi@example.com",
        timestamp="2026-06-18T17:00:00Z",
    ),  # AMBIGUOUS: free-form message, not Conventional Commits 1.0.0
]


def _sample_input(
    input_sha: str = "abc1234567",
    *,
    commits: List[ConventionalCommit] = None,
    to_sha: str = "abc1234",
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
            to_sha=to_sha,
            conventional_commits=list(commits) if commits is not None else list(SAMPLE_COMMITS),
        ),
        memory_snapshot=MemorySnapshot(
            project_memory_sha="pmem-aaaa",
            customer_memory_sha="cmem-bbbb",
            docs_index_sha="didx-cccc",
            adr_registry_sha="adr-dddd",
        ),
        requested_artifacts=[],
        model="claude-sonnet-4-6",
    )


def _write_stub_repo(root: Path) -> None:
    """Seed a stub repo with the workspace convention files.

    The CHANGELOG generator only needs `workspace/project/docs.md` for
    the doc-index refresh; the other files are out of scope for v1.
    """
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


# ---------------------------------------------------------------------------
# 1. Sample run on a stub repo
# ---------------------------------------------------------------------------

def test_sample_run_full_repo() -> None:
    print("\n[SAMPLE] full stub repo with conventional commits")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        out = run_changelog(_sample_input(), repo_root=root, write=True)

        assert_true(out.status == RunStatus.OK, "status=ok on full repo")
        assert_true(len(out.artifacts) == 2, "exactly two artifacts produced (CHANGELOG + Release Notes)")

        changelog = next(a for a in out.artifacts if a.path == "CHANGELOG.md")
        release_notes = next(a for a in out.artifacts if a.path.endswith(".md") and a.path != "CHANGELOG.md")
        assert_true(changelog.generator_type.value == "changelog", "changelog artifact kind = changelog")
        assert_true(release_notes.generator_type.value == "release_notes", "release_notes artifact kind = release_notes")
        assert_true(changelog.freshness_timestamp, "changelog freshness_timestamp present")
        assert_true(release_notes.freshness_timestamp, "release_notes freshness_timestamp present")
        assert_true(changelog.source_sha == "abc1234567", "changelog source_sha echoed from input")
        assert_true(release_notes.source_sha == "abc1234567", "release_notes source_sha echoed from input")

        # Keep-a-Changelog format checks
        body = changelog.content
        assert_true(
            re.search(r"^# Changelog\s*$", body, re.MULTILINE) is not None,
            "CHANGELOG.md opens with `# Changelog`",
        )
        assert_true(
            "Keep a Changelog" in body,
            "CHANGELOG.md references Keep a Changelog",
        )
        assert_true(
            re.search(r"^##\s+\[[^\]]+\]\s*-\s*\d{4}-\d{2}-\d{2}\s*$", body, re.MULTILINE) is not None,
            "CHANGELOG.md has a versioned release heading `## [X.Y.Z] - YYYY-MM-DD`",
        )

        # Category sub-headers — all six
        for cat in CATEGORY_ORDER:
            if cat == CATEGORY_BREAKING:
                # Breaking changes are surfaced via the callout box
                # only; the renderer does not emit a `### Breaking
                # Changes` header (per Keep-a-Changelog 1.1.0).
                continue
            assert_true(
                f"### {cat}" in body,
                f"category sub-header present: {cat}",
            )

        # Breaking change callout
        assert_true(
            re.search(r"^>\s+\[!WARNING\]", body, re.MULTILINE) is not None,
            "breaking changes surfaced in a `> [!WARNING]` callout box",
        )
        assert_true(
            re.search(r"^>\s+\*\*Breaking changes in this release:\*\*", body, re.MULTILINE) is not None,
            "callout box header `> **Breaking changes in this release:**` present",
        )
        # Both breaking commits in the callout
        assert_true(
            "OIDC broker" in body and "drop /v0 routes" in body,
            "both breaking commits (OIDC broker + /v0 routes) appear in the callout",
        )

        # Deep-links: every entry has a commit-sha chip
        commit_links = re.findall(r"\[`([0-9a-f]{7,})`\]\(https://github\.com/[^)]+\)", body)
        assert_true(len(commit_links) >= 7, f"≥ 7 commit deep-links in CHANGELOG (got {len(commit_links)})")

        # Ref parsing — the OIDC commit has FORA-125, FORA-126, #42, PR #101
        assert_true("[FORA-125]" in body, "Jira ref FORA-125 deep-linked from OIDC commit body")
        assert_true("[FORA-126]" in body, "Jira ref FORA-126 deep-linked from OIDC commit body")
        assert_true("[PR #101]" in body, "PR ref #101 deep-linked from OIDC commit body")
        assert_true("[#42]" in body, "GitHub issue #42 deep-linked from OIDC commit body")
        # The db commit body has FORA-130
        assert_true("[FORA-130]" in body, "Jira ref FORA-130 deep-linked from db commit body")

        # Per-release notes file
        rn_body = release_notes.content
        assert_true(
            "Release notes — v" in rn_body,
            "release notes header is `Release notes — vX.Y.Z`",
        )
        assert_true(
            "## ⚠️ Breaking changes" in rn_body,
            "release notes carry `## ⚠️ Breaking changes` section",
        )
        # Sections for non-empty categories
        for cat in (CATEGORY_NEW_FEATURES, CATEGORY_BUG_FIXES, CATEGORY_PERFORMANCE,
                    CATEGORY_DOCUMENTATION, CATEGORY_INTERNAL):
            assert_true(
                f"## {cat}" in rn_body,
                f"release notes carry `## {cat}` section",
            )

        # Approval routing
        assert_true(changelog.approval_required is False, "changelog: approval_required=False (routine)")
        assert_true(release_notes.approval_required is False, "release_notes: approval_required=False (routine)")

        # Files on disk
        assert_true((root / "CHANGELOG.md").exists(), "CHANGELOG.md written to repo root")
        assert_true(
            (root / "docs" / "release-notes").exists(),
            "docs/release-notes/ directory created",
        )
        rn_files = list((root / "docs" / "release-notes").glob("RELEASE_NOTES_*.md"))
        assert_true(len(rn_files) == 1, f"exactly one RELEASE_NOTES_<version>.md written (got {len(rn_files)})")

        # Doc index updated
        idx_path = root / "workspace" / "project" / "docs.md"
        assert_true(idx_path.exists(), "doc index file exists after run")
        idx_body = idx_path.read_text(encoding="utf-8")
        assert_true('"path": "CHANGELOG.md"' in idx_body, "doc index has CHANGELOG entry")
        assert_true('"path": "docs/release-notes/RELEASE_NOTES_' in idx_body,
                    "doc index has release notes entry")
        # Frontmatter preserved
        assert_true("name: doc-index" in idx_body, "doc index frontmatter preserved")


# ---------------------------------------------------------------------------
# 2. Idempotency
# ---------------------------------------------------------------------------

def test_idempotency_same_input_same_bytes() -> None:
    print("\n[IDEMPOTENCY] same input -> same content_sha, byte-identical body")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        out_a = run_changelog(_sample_input(input_sha="idem-sha"), repo_root=root, write=True)
        out_b = run_changelog(_sample_input(input_sha="idem-sha"), repo_root=root, write=True)
        a = next(x for x in out_a.artifacts if x.path == "CHANGELOG.md")
        b = next(x for x in out_b.artifacts if x.path == "CHANGELOG.md")
        assert_true(a.content_sha == b.content_sha, "CHANGELOG content_sha identical on re-run")
        assert_true(a.content == b.content, "CHANGELOG body byte-identical on re-run")
        ra = next(x for x in out_a.artifacts if x.path != "CHANGELOG.md")
        rb = next(x for x in out_b.artifacts if x.path != "CHANGELOG.md")
        assert_true(ra.content_sha == rb.content_sha, "Release Notes content_sha identical on re-run")
        assert_true(ra.content == rb.content, "Release Notes body byte-identical on re-run")


# ---------------------------------------------------------------------------
# 3. Keep-a-Changelog format (renderer-level)
# ---------------------------------------------------------------------------

def test_keep_a_changelog_format_structure() -> None:
    print("\n[FORMAT] renderer output is valid Keep-a-Changelog")
    inputs = ChangelogInputs(
        project_name="Acme",
        current_version="1.2.0",
        release_date="2026-06-18",
        commits=SAMPLE_COMMITS,
        repo_owner="acme",
        repo_name="checkout",
        input_sha="format-sha",
    )
    body = render_changelog(inputs)
    # Header
    assert_true(body.startswith("# Changelog\n"), "body starts with `# Changelog` heading")
    assert_true("All notable changes" in body, "Keep-a-Changelog preamble present")
    # Release heading
    assert_true("## [1.2.0] - 2026-06-18" in body, "release heading `## [1.2.0] - 2026-06-18` present")
    # Footer
    assert_true("Re-running with the same" in body, "idempotency contract footer present")


# ---------------------------------------------------------------------------
# 4. Breaking change callout (renderer-level)
# ---------------------------------------------------------------------------

def test_breaking_change_callout_top_box() -> None:
    print("\n[BREAKING] breaking changes appear in the top callout box")
    inputs = ChangelogInputs(
        project_name="FORA",
        current_version="0.7.0",
        release_date="2026-06-18",
        commits=SAMPLE_COMMITS,
        repo_owner="fora",
        repo_name="fora",
        input_sha="break-sha",
    )
    body = render_changelog(inputs)
    # The callout
    callout_match = re.search(
        r"^>\s+\[!WARNING\][\s\S]+?^>", body, re.MULTILINE
    )
    assert_true(callout_match is not None, "`> [!WARNING]` callout block present")
    # Each breaking commit appears as a `>` line inside the callout
    assert_true(
        re.search(r"^>\s+- .*OIDC broker", body, re.MULTILINE) is not None,
        "OIDC broker commit in the callout box",
    )
    assert_true(
        re.search(r"^>\s+- .*/v0 routes", body, re.MULTILINE) is not None,
        "/v0 routes commit in the callout box",
    )
    # No breaking commit lands under a regular category (which would
    # be a Keep-a-Changelog / spec violation).
    for cat in (CATEGORY_NEW_FEATURES, CATEGORY_BUG_FIXES, CATEGORY_PERFORMANCE,
                CATEGORY_DOCUMENTATION, CATEGORY_INTERNAL):
        # If a `### {cat}` header exists, the breaking commit must not
        # appear under it.
        section = re.search(rf"^###\s+{re.escape(cat)}\b[\s\S]*?(?=^###\s+|^##\s+|\Z)", body, re.MULTILINE)
        if section is None:
            continue
        assert_true(
            "OIDC broker" not in section.group(0) and "/v0 routes" not in section.group(0),
            f"breaking commits NOT listed under `{cat}`",
        )


# ---------------------------------------------------------------------------
# 5. Cross-linking (parser-level)
# ---------------------------------------------------------------------------

def test_ref_parsing_jira_pr_github_issue() -> None:
    print("\n[REFS] Jira, PR, and GitHub issue refs are parsed from commit bodies")
    refs = extract_refs(
        "feat(iam): add OIDC broker\n\n"
        "Closes FORA-125 and FORA-126. Refs #42. PR #101.",
        repo_owner="fora",
        repo_name="fora",
        jira_base_url="https://fora.atlassian.net",
    )
    kinds = [r.kind for r in refs]
    ids = [r.id for r in refs]
    assert_true("jira" in kinds, "Jira refs detected (FORA-125, FORA-126)")
    assert_true("pr" in kinds, "PR refs detected (#101)")
    assert_true("github_issue" in kinds, "GitHub issue refs detected (#42)")
    assert_true("FORA-125" in ids, "FORA-125 id parsed")
    assert_true("FORA-126" in ids, "FORA-126 id parsed")
    assert_true("101" in ids, "PR #101 id parsed")
    assert_true("42" in ids, "GitHub issue #42 id parsed")
    # URLs
    jira = next(r for r in refs if r.id == "FORA-125")
    assert_true(jira.url == "https://fora.atlassian.net/FORA-125", "Jira URL uses jira_base_url")
    pr = next(r for r in refs if r.id == "101")
    assert_true(pr.url == "https://github.com/fora/fora/pull/101", "PR URL uses owner/repo")
    issue = next(r for r in refs if r.id == "42")
    assert_true(issue.url == "https://github.com/fora/fora/issues/42", "issue URL uses owner/repo")


# ---------------------------------------------------------------------------
# 6. Approval routing (routine)
# ---------------------------------------------------------------------------

def test_approval_routing_routine() -> None:
    print("\n[APPROVAL] CHANGELOG + Release Notes are routine (auto-merge)")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        out = run_changelog(_sample_input(input_sha="apr-sha"), repo_root=root, write=True)
        for a in out.artifacts:
            assert_true(
                a.approval_required is False,
                f"{a.path}: approval_required=False (routine update)",
            )


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
        out = run_changelog(inp, repo_root=root, write=True)
        assert_true(out.status == RunStatus.ABORTED, "missing input_sha -> RunStatus.ABORTED")
        assert_true(len(out.errors) >= 1, "at least one error reported")
        assert_true(
            out.errors[0].kind == ErrorKind.MISSING_INPUT_SHA,
            "error kind = MISSING_INPUT_SHA",
        )
        # No file written
        assert_true(not (root / "CHANGELOG.md").exists(), "no CHANGELOG.md written on aborted run")


# ---------------------------------------------------------------------------
# 8. Ambiguous conventional commit
# ---------------------------------------------------------------------------

def test_ambiguous_conventional_commit_warning() -> None:
    print("\n[FAILURE-MODE] AMBIGUOUS_CONVENTIONAL_COMMIT -> structured warning, marker in body")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        # WIP commit in SAMPLE_COMMITS is ambiguous.
        out = run_changelog(_sample_input(input_sha="amb-sha"), repo_root=root, write=True)
        assert_true(out.status == RunStatus.OK, "status still ok (warning is non-fatal)")
        kinds = [e.kind for e in out.errors]
        assert_true(
            ErrorKind.AMBIGUOUS_CONVENTIONAL_COMMIT in kinds,
            "AMBIGUOUS_CONVENTIONAL_COMMIT error surfaced",
        )
        body = next(a for a in out.artifacts if a.path == "CHANGELOG.md").content
        # The ambiguous commit lands in the Internal bucket with the
        # `<!-- ambiguous -->` marker
        assert_true(
            "<!-- ambiguous -->" in body,
            "ambiguous commit rendered with `<!-- ambiguous -->` marker",
        )
        assert_true(
            re.search(r"^###\s+Internal\b[\s\S]*?<!-- ambiguous -->", body, re.MULTILINE) is not None,
            "ambiguous commit lands in the `### Internal` bucket",
        )


# ---------------------------------------------------------------------------
# 9. Oversized diff
# ---------------------------------------------------------------------------

def test_oversized_diff_aborts() -> None:
    print("\n[FAILURE-MODE] OVERSIZED_DIFF -> RunStatus.ABORTED")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        # Build a commit set that the cost-envelope check will reject
        # (the pre-flight is `len(msg+sha)//4 > per_run_tokens_in`).
        big_msg = "x" * 8000
        big_commits = [
            ConventionalCommit(
                sha=f"big{i:04d}{'0' * 12}",
                message=f"feat: {big_msg}",
                author="big@example.com",
                timestamp="2026-06-18T10:00:00Z",
            )
            for i in range(200)  # 200 * 2000 tokens ≈ 400k tokens
        ]
        inp = _sample_input(commits=big_commits)
        # Tight ceiling so the pre-flight fires.
        inp.cost_envelope = {"per_run_tokens_in": 1000, "per_run_tokens_out": 300}
        out = run_changelog(inp, repo_root=root, write=True)
        assert_true(out.status == RunStatus.ABORTED, "oversized diff -> RunStatus.ABORTED")
        assert_true(
            any(e.kind == ErrorKind.OVERSIZED_DIFF for e in out.errors),
            "error kind = OVERSIZED_DIFF",
        )
        # No file written
        assert_true(not (root / "CHANGELOG.md").exists(), "no CHANGELOG.md written on oversized abort")


# ---------------------------------------------------------------------------
# 10. Dry-run mode
# ---------------------------------------------------------------------------

def test_dry_run_does_not_write() -> None:
    print("\n[DRY-RUN] write=False leaves no file and no doc-index mutation")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        idx_path = root / "workspace" / "project" / "docs.md"
        before = idx_path.read_text(encoding="utf-8")
        out = run_changelog(_sample_input(input_sha="dry-sha"), repo_root=root, write=False)
        assert_true(len(out.artifacts) == 2, "two artifacts still produced on dry-run")
        assert_true(not (root / "CHANGELOG.md").exists(), "CHANGELOG.md NOT written on dry-run")
        assert_true(
            not (root / "docs" / "release-notes").exists(),
            "docs/release-notes/ NOT created on dry-run",
        )
        after = idx_path.read_text(encoding="utf-8")
        assert_true(before == after, "doc index NOT mutated on dry-run")


# ---------------------------------------------------------------------------
# 11. Storage contract
# ---------------------------------------------------------------------------

def test_storage_contract_doc_index_entry_shape() -> None:
    print("\n[STORAGE] DocIndex entries cover CHANGELOG.md and RELEASE_NOTES_*.md")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        out = run_changelog(_sample_input(input_sha="storage-sha"), repo_root=root, write=True)
        assert_true(out.doc_index is not None, "doc_index present (FORA-117)")
        assert_true(out.adr_registry is not None, "adr_registry present (FORA-117)")
        entries = out.doc_index.entries
        kinds = {e.path: e.kind for e in entries}
        assert_true("CHANGELOG.md" in kinds, "doc index has CHANGELOG.md entry")
        assert_true(kinds["CHANGELOG.md"] == DocKind.CHANGELOG, "CHANGELOG entry kind = DocKind.CHANGELOG")
        rn_entry = next((e for e in entries if e.path.startswith("docs/release-notes/RELEASE_NOTES_")), None)
        assert_true(rn_entry is not None, "doc index has RELEASE_NOTES_<version>.md entry")
        assert_true(rn_entry.kind == DocKind.RELEASE_NOTES, "release notes entry kind = DocKind.RELEASE_NOTES")
        for e in entries:
            assert_true(e.last_generated_at, f"{e.path}: last_generated_at present")
            assert_true(e.source_commit, f"{e.path}: source_commit present")
            assert_true(e.content_sha, f"{e.path}: content_sha cached")
            assert_true(e.version == "1.0", f"{e.path}: version = 1.0 (FORA-117 storage schema)")


# ---------------------------------------------------------------------------
# 12. Renderer pure / determinism
# ---------------------------------------------------------------------------

def test_renderer_pure_idempotent() -> None:
    print("\n[RENDERER] pure function: same inputs -> same bytes")
    inputs = ChangelogInputs(
        project_name="Acme",
        current_version="1.2.0",
        release_date="2026-06-18",
        commits=SAMPLE_COMMITS,
        repo_owner="acme",
        repo_name="checkout",
        input_sha="pure-sha",
    )
    body1 = render_changelog(inputs)
    body2 = render_changelog(inputs)
    assert_true(body1 == body2, "render_changelog is deterministic")
    assert_true(
        hashlib.sha256(body1.encode()).hexdigest()
        == hashlib.sha256(body2.encode()).hexdigest(),
        "sha256 of CHANGELOG body identical",
    )
    rn1 = render_release_notes(inputs, version="1.2.0")
    rn2 = render_release_notes(inputs, version="1.2.0")
    assert_true(rn1 == rn2, "render_release_notes is deterministic")


def test_renderer_omits_wall_clock_from_body() -> None:
    print("\n[RENDERER] no wall-clock timestamp in body")
    inputs = ChangelogInputs(
        project_name="Acme",
        current_version="1.2.0",
        release_date="2026-06-18",
        commits=SAMPLE_COMMITS,
        repo_owner="acme",
        repo_name="checkout",
        input_sha="pure-sha",
    )
    body = render_changelog(inputs)
    # The body must not contain an ISO 8601 timestamp (the freshness
    # stamp lives on DocArtifact, not in the body).
    iso_re = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
    assert_true(iso_re.search(body) is None, "no ISO 8601 timestamp in CHANGELOG body")
    # But the input_sha footer must be present (source attribution)
    assert_true("pure-sha" in body, "input_sha footer present (source attribution)")


# ---------------------------------------------------------------------------
# 13. Conventional-commit parser unit
# ---------------------------------------------------------------------------

def test_parse_conventional_basic_types() -> None:
    print("\n[PARSE] Conventional Commits 1.0.0 parser")
    ctype, scope, breaking, subject, amb = parse_conventional("feat(api): add thing")
    assert_true(ctype == "feat" and scope == "api" and breaking is False and amb is False,
                "feat(scope) parses correctly")
    ctype, scope, breaking, subject, amb = parse_conventional("fix!: drop it")
    assert_true(ctype == "fix" and scope is None and breaking is True and amb is False,
                "fix! parses as breaking=True, no scope")
    ctype, scope, breaking, subject, amb = parse_conventional(
        "feat: thing\n\nBREAKING CHANGE: drop it"
    )
    assert_true(ctype == "feat" and breaking is True and amb is False,
                "BREAKING CHANGE: footer forces breaking=True")
    ctype, scope, breaking, subject, amb = parse_conventional("wip: in progress")
    assert_true(ctype == "wip" and amb is False,
                "unknown type parses without ambiguity (renderer flags it)")
    ctype, scope, breaking, subject, amb = parse_conventional("Just a free-form message")
    assert_true(ctype is None and amb is True,
                "non-conventional message flagged as ambiguous")


def test_build_entry_categorization() -> None:
    print("\n[PARSE] build_changelog_entry categorisation")
    c = ConventionalCommit(
        sha="abc1234", message="feat(api): add thing", author="x", timestamp="2026-06-18T00:00:00Z",
        parsed_type="feat", parsed_scope="api", breaking=False,
    )
    e = build_changelog_entry(c, "acme", "checkout", None)
    assert_true(e.category == CATEGORY_NEW_FEATURES, "feat -> New Features")
    assert_true(e.is_breaking is False, "feat without ! -> is_breaking=False")
    c = ConventionalCommit(
        sha="abc1234", message="fix!: drop", author="x", timestamp="2026-06-18T00:00:00Z",
        parsed_type="fix", breaking=True,
    )
    e = build_changelog_entry(c, "acme", "checkout", None)
    assert_true(e.category == CATEGORY_BREAKING, "fix! -> Breaking Changes")
    assert_true(e.is_breaking is True, "fix! -> is_breaking=True")
    c = ConventionalCommit(
        sha="abc1234", message="random free-form", author="x", timestamp="2026-06-18T00:00:00Z",
    )
    e = build_changelog_entry(c, "acme", "checkout", None)
    assert_true(e.category == CATEGORY_INTERNAL, "ambiguous -> Internal (safety net)")
    assert_true(e.is_ambiguous is True, "ambiguous commit flagged is_ambiguous=True")


# ---------------------------------------------------------------------------
# 14. Multiple releases — idempotent re-emit
# ---------------------------------------------------------------------------

def test_multiple_releases_preserved() -> None:
    print("\n[RELEASES] prior releases preserved on re-run (idempotent insert)")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_stub_repo(root)
        # First run: produces [0.7.0]
        out1 = run_changelog(
            _sample_input(input_sha="multi-a", to_sha="0.7.0"),
            repo_root=root, write=True,
        )
        body1 = next(a for a in out1.artifacts if a.path == "CHANGELOG.md").content
        assert_true("## [0.7.0] - 2026-06-18" in body1, "first run: [0.7.0] section present")
        # Second run with DIFFERENT version -> appends [0.8.0]
        out2 = run_changelog(
            _sample_input(input_sha="multi-b", to_sha="0.8.0"),
            repo_root=root, write=True,
        )
        body2 = next(a for a in out2.artifacts if a.path == "CHANGELOG.md").content
        assert_true("## [0.7.0] - 2026-06-18" in body2, "second run: [0.7.0] still present")
        assert_true("## [0.8.0] - 2026-06-18" in body2, "second run: [0.8.0] appended")
        # Third run with same version as second -> no-op (idempotent)
        out3 = run_changelog(
            _sample_input(input_sha="multi-b", to_sha="0.8.0"),
            repo_root=root, write=True,
        )
        body3 = next(a for a in out3.artifacts if a.path == "CHANGELOG.md").content
        assert_true(body2 == body3, "third run with same input: byte-identical (no-op)")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    print("[changelog-smoke] FORA-122 / 7.1.4 acceptance battery")
    test_sample_run_full_repo()
    test_idempotency_same_input_same_bytes()
    test_keep_a_changelog_format_structure()
    test_breaking_change_callout_top_box()
    test_ref_parsing_jira_pr_github_issue()
    test_approval_routing_routine()
    test_missing_input_sha_aborts()
    test_ambiguous_conventional_commit_warning()
    test_oversized_diff_aborts()
    test_dry_run_does_not_write()
    test_storage_contract_doc_index_entry_shape()
    test_renderer_pure_idempotent()
    test_renderer_omits_wall_clock_from_body()
    test_parse_conventional_basic_types()
    test_build_entry_categorization()
    test_multiple_releases_preserved()

    # Persist evidence
    evidence_dir = Path(HERE) / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%dT%H%M%SZ")
    evidence_path = evidence_dir / f"changelog_smoke_{stamp}.json"
    summary = {
        "spec": "FORA-122",
        "sub_goal": "7.1.4 Changelog & Release Notes generator",
        "ran_at": now_iso(),
        "tests_run": 15,
        "assertions_failed": len(FAILURES),
        "failures": FAILURES,
        "acceptance": {
            "sample_run": "PASS",
            "idempotency": "PASS",
            "keep_a_changelog_format": "PASS",
            "breaking_change_callout": "PASS",
            "cross_linking_refs": "PASS",
            "approval_routing": "PASS",
            "missing_input_sha": "PASS",
            "ambiguous_conventional_commit": "PASS",
            "oversized_diff": "PASS",
            "dry_run": "PASS",
            "storage_contract": "PASS",
            "renderer_pure": "PASS",
            "no_wall_clock_in_body": "PASS",
            "parse_conventional": "PASS",
            "build_entry_categorization": "PASS",
            "multiple_releases_preserved": "PASS",
        } if not FAILURES else "see failures",
    }
    evidence_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n[changelog-smoke] wrote {evidence_path}")
    if FAILURES:
        print(f"\n[changelog-smoke] FAILED: {len(FAILURES)} assertion(s)")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("\n[changelog-smoke] all assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
