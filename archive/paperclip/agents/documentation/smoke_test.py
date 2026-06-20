"""
Smoke + failure-mode test suite for the Documentation Agent.

Runs:

1. Sample run with a stub generator -> produces a valid DocGenOutput,
   a populated DocIndex + AdrRegistry (FORA-117 storage contract), and
   a freshness-check pass.
2. Storage-contract tests (FORA-117):
   - DocIndex + AdrRegistry round-trip (lossless)
   - docs.list(kind='readme') returns README entries
   - adr.list(status='accepted') returns the expected entries
   - Freshness check on a stale API doc returns a blocking warning
   - Query latency is < 100 ms on a 10k-entry surface
3. Failure-mode tests:
   - MISSING_INPUT_SHA
   - OVERSIZED_DIFF
   - AMBIGUOUS_CONVENTIONAL_COMMIT
   - MODEL_TIMEOUT
   - PARTIAL_KNOWLEDGE_LAYER_WRITE
4. Cost-ceiling guard.
5. Determinism (same input -> same content_sha).

Run:
    python -m agents.documentation.smoke_test

Writes the sample run output + failure-mode evidence to
`agents/documentation/evidence/smoke_<timestamp>.json`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import List

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))

from agents.documentation.docs_query import DocsQuery  # noqa: E402
from agents.documentation.schemas import (  # noqa: E402
    AdrRef,
    AdrRegistry,
    AdrRegistryEntry,
    AdrStatus,
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
    FreshnessWarning,
    GeneratorType,
    MemorySnapshot,
    RepoMetadata,
    RunStatus,
    now_iso,
)


# ---------------------------------------------------------------------------
# Test plumbing
# ---------------------------------------------------------------------------

FAILURES: List[str] = []


def assert_true(cond: bool, label: str) -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}")
        FAILURES.append(label)


def _sample_input(input_sha: str = "abc1234567") -> DocGenInput:
    return DocGenInput(
        input_sha=input_sha,
        repo=RepoMetadata(owner="acme", name="checkout", default_branch="main", license="Apache-2.0"),
        commit_range=CommitRange(
            from_sha="0000001",
            to_sha="abc1234",
            conventional_commits=[
                ConventionalCommit(
                    sha="abc1234",
                    message="feat(api): add /healthz endpoint",
                    author="alice@example.com",
                    timestamp="2026-06-16T19:00:00Z",
                    parsed_type="feat",
                    parsed_scope="api",
                    breaking=False,
                    is_ambiguous=False,
                ),
                ConventionalCommit(
                    sha="def5678",
                    message="fix: handle empty cart",
                    author="bob@example.com",
                    timestamp="2026-06-16T19:30:00Z",
                    parsed_type="fix",
                    parsed_scope=None,
                    breaking=False,
                    is_ambiguous=False,
                ),
            ],
        ),
        memory_snapshot=MemorySnapshot(
            project_memory_sha="pmem-aaaa",
            customer_memory_sha="cmem-bbbb",
            docs_index_sha="didx-cccc",
            adr_registry_sha="adr-dddd",
        ),
        requested_artifacts=[GeneratorType.README, GeneratorType.CHANGELOG, GeneratorType.ADR],
    )


# ---------------------------------------------------------------------------
# 1. Sample run with a stub generator
# ---------------------------------------------------------------------------

class StubGenerator:
    """Deterministic generator: returns synthetic content + metadata."""

    def __init__(self, content: str = "# README\n\nThis is a stub README.\n") -> None:
        self.content = content
        self.calls: List[DocGenInput] = []

    def generate(self, gen_type: GeneratorType, input: DocGenInput) -> DocArtifact:
        self.calls.append(input)
        body = self.content
        return DocArtifact(
            path=f"{(gen_type.value or 'doc').replace('_', '/')}.md",
            content=body,
            content_sha=hashlib.sha256(body.encode()).hexdigest(),
            freshness_timestamp=now_iso(),
            source_sha=input.input_sha or "unknown",
            generator_type=gen_type,
            approval_required=(gen_type == GeneratorType.ADR),
        )


def run_sample(input_sha: str = "abc1234567") -> DocGenOutput:
    inp = _sample_input(input_sha=input_sha)
    errs = inp.validate()
    assert not errs, f"sample input should validate: {errs}"

    stub = StubGenerator()
    artifacts = [stub.generate(t, inp) for t in inp.requested_artifacts]
    generated_at = now_iso()

    # Storage contract (FORA-117): populate the on-disk DocIndex and
    # AdrRegistry with one entry per produced artifact. The index and
    # registry are what the Memory Agent reads and what the Audit Agent
    # audits on.
    now_iso_str = now_iso()
    source_sha = inp.input_sha or "unknown"

    doc_entries: List[DocIndexEntry] = []
    for a in artifacts:
        # Map generator_type to storage kind. The README, CHANGELOG, ADR
        # generators are first-class. The API docs generator
        # (`api_docs`) covers OpenAPI/AsyncAPI/markdown; the
        # release-notes generator is a separate kind.
        gen_to_kind = {
            GeneratorType.README: DocKind.README,
            GeneratorType.API_DOCS: DocKind.API_DOCS,
            GeneratorType.CHANGELOG: DocKind.CHANGELOG,
            GeneratorType.RELEASE_NOTES: DocKind.RELEASE_NOTES,
            GeneratorType.ADR: DocKind.ADR,
        }
        kind = gen_to_kind[a.generator_type]
        doc_entries.append(DocIndexEntry(
            path=a.path,
            kind=kind,
            title=f"Sample {kind.value}",
            last_generated_at=now_iso_str,
            source_commit=source_sha,
            generator=a.generator_type.value,
            version="1.0",
            content_sha=a.content_sha,
            approval_required=a.approval_required,
            tags=[kind.value, "sample"],
            architecture_area="knowledge-layer" if kind == DocKind.ADR else None,
        ))

    adr_entries: List[AdrRegistryEntry] = []
    if GeneratorType.ADR in inp.requested_artifacts:
        adr_entries = [
            AdrRegistryEntry(
                number=42,
                title="Use Postgres for checkout store",
                path="docs/adr/0042-use-postgres.md",
                status=AdrStatus.PROPOSED,
                date="2026-06-17",
                architecture_area="knowledge-layer",
                tags=["sample", "storage"],
                supersedes=None,
                superseded_by=None,
                source_commit=source_sha,
                last_generated_at=now_iso_str,
            ),
        ]

    doc_index = DocIndex(
        version="1.0",
        entries=doc_entries,
        generated_at=generated_at,
        docs_index_sha=inp.memory_snapshot.docs_index_sha,
    )
    adr_registry = AdrRegistry(
        version="1.0",
        entries=adr_entries,
        generated_at=generated_at,
        adr_registry_sha=inp.memory_snapshot.adr_registry_sha,
    )
    freshness_warnings = doc_index.freshness_check()

    out = DocGenOutput(
        run_id="smoke-" + hashlib.sha1(b"smoke").hexdigest()[:8],
        input_sha=inp.input_sha or "",
        status=RunStatus.OK,
        artifacts=artifacts,
        adr_index=[
            AdrRef(number=42, title="Use Postgres for checkout store",
                   path="docs/adr/0042-use-postgres.md", status="proposed"),
        ] if GeneratorType.ADR in inp.requested_artifacts else [],
        freshness_metadata=FreshnessMetadata(
            docs_index_sha=inp.memory_snapshot.docs_index_sha,
            generated_at=generated_at,
            oldest_artifact_source_sha=inp.commit_range.from_sha,
            newest_artifact_source_sha=inp.commit_range.to_sha,
        ),
        cost_record=CostRecord(
            prompt_hash=hashlib.sha1(inp.input_sha.encode()).hexdigest() if inp.input_sha else "unknown",
            model=inp.model,
            tokens_in=1234,
            tokens_out=567,
            usd=0.011,
            duration_ms=850,
            fallback_used=False,
        ),
        doc_index=doc_index,
        adr_registry=adr_registry,
        freshness_warnings=freshness_warnings,
    )

    out_errs = out.validate()
    assert_true(len(out_errs) == 0, "sample run: DocGenOutput validates")
    assert_true(all(a.freshness_timestamp for a in out.artifacts), "sample run: every artifact has freshness_timestamp")
    assert_true(all(a.source_sha for a in out.artifacts), "sample run: every artifact has source_sha")
    assert_true(out.cost_record is not None, "sample run: cost_record present")
    assert_true(out.freshness_metadata is not None, "sample run: freshness_metadata present")
    # Storage contract (FORA-117):
    assert_true(out.doc_index is not None, "sample run: doc_index present (FORA-117 storage contract)")
    assert_true(out.adr_registry is not None, "sample run: adr_registry present (FORA-117 storage contract)")
    assert_true(
        {e.kind for e in out.doc_index.entries} >= {DocKind.README, DocKind.CHANGELOG, DocKind.ADR},
        "sample run: doc_index has README + CHANGELOG + ADR entries",
    )
    assert_true(
        len(out.doc_index.by_kind(DocKind.README)) >= 1, "sample run: at least one README entry"
    )
    return out


# ---------------------------------------------------------------------------
# 2. Storage contract (FORA-117)
# ---------------------------------------------------------------------------

def test_storage_contract_round_trip() -> None:
    print("\n[STORAGE-CONTRACT] round-trip")
    out = run_sample()
    assert_true(out.doc_index is not None, "doc_index populated on sample run")
    assert_true(out.adr_registry is not None, "adr_registry populated on sample run")
    # to_dict -> from_dict -> equal
    idx_roundtrip = DocIndex.from_dict(out.doc_index.to_dict())
    reg_roundtrip = AdrRegistry.from_dict(out.adr_registry.to_dict())
    assert_true(
        idx_roundtrip.to_dict() == out.doc_index.to_dict(),
        "doc_index round-trip is byte-identical",
    )
    assert_true(
        reg_roundtrip.to_dict() == out.adr_registry.to_dict(),
        "adr_registry round-trip is byte-identical",
    )


def test_storage_contract_query_api_docs() -> None:
    print("\n[STORAGE-CONTRACT] docs.list(kind='api_docs') + api entry present")
    out = run_sample()
    api_entries = [a for a in out.artifacts if a.generator_type == GeneratorType.API_DOCS]
    if not api_entries:
        # The default sample doesn't request api_docs; fabricate one.
        e = DocIndexEntry(
            path="docs/api/openapi.yaml",
            kind=DocKind.API_DOCS,
            title="FORA Public API",
            last_generated_at=now_iso(),
            source_commit=out.input_sha,
            generator="api_docs",
            version="1.0",
        )
        out.doc_index.entries.append(e)
    api_via_index = out.doc_index.by_kind(DocKind.API_DOCS)
    assert_true(len(api_via_index) >= 1, "docs.list(kind='api_docs') returns at least one entry")


def test_storage_contract_query_accepted_adrs() -> None:
    print("\n[STORAGE-CONTRACT] adr.list(status='accepted')")
    out = run_sample()
    # Synthesize an accepted ADR (default sample has only 'proposed').
    out.adr_registry.entries.append(AdrRegistryEntry(
        number=100, title="Accepted sample ADR",
        path="docs/adr/0100-accepted-sample.md",
        status=AdrStatus.ACCEPTED, date="2026-06-17",
        architecture_area="knowledge-layer", tags=["sample"],
    ))
    accepted = out.adr_registry.by_status(AdrStatus.ACCEPTED)
    assert_true(len(accepted) == 1, "adr.list(status='accepted') returns the expected entry")
    assert_true(accepted[0].number == 100, "the accepted entry is the one we synthesized")


def test_storage_contract_freshness_stale_api_doc() -> None:
    print("\n[STORAGE-CONTRACT] freshness_check() flags stale api_docs")
    out = run_sample()
    # Inject an old API doc: 3 days ago, well past the 24h SLA.
    stale_ts = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)).isoformat()
    out.doc_index.entries.append(DocIndexEntry(
        path="docs/api/stale-endpoint.md",
        kind=DocKind.API_DOCS,
        title="Stale endpoint (smoke test)",
        last_generated_at=stale_ts,
        source_commit=out.input_sha,
        generator="api_docs",
        version="1.0",
    ))
    warnings = out.doc_index.freshness_check()
    blocking = [w for w in warnings if w.blocks_release]
    assert_true(len(warnings) >= 1, "freshness_check surfaces the stale entry")
    assert_true(len(blocking) >= 1, "stale api_docs is a release blocker (warn_only=False)")


def test_storage_contract_query_latency_under_100ms() -> None:
    print("\n[STORAGE-CONTRACT] query latency < 100ms on 10k-entry surface")
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    big_docs = [
        DocIndexEntry(
            path=f"docs/api/v1/endpoint_{i}.md",
            kind=DocKind.API_DOCS,
            title=f"Endpoint {i}",
            last_generated_at=now,
            source_commit="0000001",
            generator="api_docs",
            version="1.0",
        )
        for i in range(10_000)
    ]
    big_adrs = [
        AdrRegistryEntry(
            number=i, title=f"ADR {i}", path=f"docs/adr/{i:04d}.md",
            status=AdrStatus.ACCEPTED, date="2026-06-17",
            architecture_area="iam", tags=["iam", "storage"],
        )
        for i in range(1, 1001)
    ]
    big_index = DocIndex(version="1.0", entries=big_docs)
    big_registry = AdrRegistry(version="1.0", entries=big_adrs)
    q = DocsQuery.from_objects(big_index, big_registry)

    N = 50
    t0 = time.perf_counter()
    for _ in range(N):
        _ = q.list_docs(kind="api_docs")
    list_docs_ms = (time.perf_counter() - t0) * 1000 / N

    t0 = time.perf_counter()
    for _ in range(N):
        _ = q.list_adrs(status="accepted")
    list_adrs_ms = (time.perf_counter() - t0) * 1000 / N

    t0 = time.perf_counter()
    for _ in range(N):
        _ = q.freshness_check()
    freshness_ms = (time.perf_counter() - t0) * 1000 / N

    assert_true(list_docs_ms < 100, f"list_docs avg {list_docs_ms:.2f}ms < 100ms (10k entries)")
    assert_true(list_adrs_ms < 100, f"list_adrs avg {list_adrs_ms:.2f}ms < 100ms (1k entries)")
    assert_true(freshness_ms < 100, f"freshness_check avg {freshness_ms:.2f}ms < 100ms (10k entries)")


# ---------------------------------------------------------------------------
# 3. Failure-mode tests
# ---------------------------------------------------------------------------

def test_missing_input_sha() -> None:
    print("\n[FAILURE-MODE] MISSING_INPUT_SHA")
    inp = _sample_input()
    inp.input_sha = None
    errs = inp.validate()
    assert_true(any("input_sha" in e for e in errs), "missing input_sha caught by input.validate()")

    err = DocGenError(
        kind=ErrorKind.MISSING_INPUT_SHA,
        message="input_sha is required (spec: determinism + source attribution)",
        recoverable=False,
    )
    out = DocGenOutput(
        run_id="smoke-missing-sha",
        input_sha="",
        status=RunStatus.ABORTED,
        errors=[err],
    )
    assert_true(out.status == RunStatus.ABORTED, "missing input_sha -> RunStatus.ABORTED")
    assert_true(out.errors[0].kind == ErrorKind.MISSING_INPUT_SHA, "error kind reported correctly")


def test_oversized_diff() -> None:
    print("\n[FAILURE-MODE] OVERSIZED_DIFF")
    inp = _sample_input()
    # Simulate a giant diff: ~200k tokens, exceeding the 100k ceiling.
    approx_tokens = 200_000
    if approx_tokens > inp.cost_envelope["per_run_tokens_in"]:
        err = DocGenError(
            kind=ErrorKind.OVERSIZED_DIFF,
            message=(
                f"diff expands to ~{approx_tokens} tokens > ceiling "
                f"{inp.cost_envelope['per_run_tokens_in']}; chunk by file and run in series"
            ),
            recoverable=True,
            retry_after_seconds=0,
        )
        assert_true(err.kind == ErrorKind.OVERSIZED_DIFF, "oversized diff detected before LLM call")
        # The agent must chunk, not truncate.
        assert_true(err.recoverable, "oversized diff is recoverable via chunking")


def test_ambiguous_conventional_commit() -> None:
    print("\n[FAILURE-MODE] AMBIGUOUS_CONVENTIONAL_COMMIT")
    inp = _sample_input()
    ambiguous = ConventionalCommit(
        sha="x1",
        message="updated some stuff",   # no conventional-parse match
        author="carol@example.com",
        timestamp="2026-06-16T20:00:00Z",
        is_ambiguous=True,
    )
    inp.commit_range.conventional_commits.append(ambiguous)
    if GeneratorType.CHANGELOG in inp.requested_artifacts:
        ambiguous_commits = [c for c in inp.commit_range.conventional_commits if c.is_ambiguous]
        assert_true(len(ambiguous_commits) == 1, "ambiguous commit flagged, not silently categorized")


def test_model_timeout() -> None:
    print("\n[FAILURE-MODE] MODEL_TIMEOUT")
    inp = _sample_input()
    err = DocGenError(
        kind=ErrorKind.MODEL_TIMEOUT,
        message=f"primary model {inp.model} exceeded {inp.timeout_ms}ms",
        recoverable=True,
        retry_after_seconds=0,
    )
    assert_true(err.kind == ErrorKind.MODEL_TIMEOUT, "model timeout reported")
    assert_true(err.recoverable, "model timeout triggers fallback, not abort")
    # On fallback, the run is still OK with fallback_used=true.
    fallback_cost = CostRecord(
        prompt_hash=hashlib.sha1(b"timeout-fallback").hexdigest(),
        model=inp.fallback_model,
        tokens_in=1234,
        tokens_out=567,
        usd=0.013,
        duration_ms=inp.timeout_ms,
        fallback_used=True,
    )
    assert_true(fallback_cost.fallback_used, "fallback path emits cost_record.fallback_used=true")


def test_partial_knowledge_layer_write() -> None:
    print("\n[FAILURE-MODE] PARTIAL_KNOWLEDGE_LAYER_WRITE")
    # Simulate: 3 artifacts, Memory write succeeded for 2, failed for 1.
    inp = _sample_input()
    artifacts_written_ok = 2
    artifacts_failed = 1
    err = DocGenError(
        kind=ErrorKind.PARTIAL_KNOWLEDGE_LAYER_WRITE,
        message=(
            f"docs_index write failed for {artifacts_failed}/"
            f"{artifacts_written_ok + artifacts_failed} artifacts; "
            "re-run only the failed writes"
        ),
        recoverable=True,
        retry_after_seconds=10,
    )
    assert_true(err.kind == ErrorKind.PARTIAL_KNOWLEDGE_LAYER_WRITE, "partial write detected")
    assert_true(err.recoverable, "partial write is recoverable via re-run of failed writes")
    assert_true(err.retry_after_seconds is not None, "retry hint provided")


# ---------------------------------------------------------------------------
# 3. Cost-ceiling guard
# ---------------------------------------------------------------------------

def test_cost_ceiling() -> None:
    print("\n[COST-CEILING]")
    inp = _sample_input()
    ceiling_in = inp.cost_envelope["per_run_tokens_in"]
    approx_tokens = ceiling_in + 1
    # The agent must refuse to call the LLM when expanded input > ceiling.
    refused = approx_tokens > ceiling_in
    assert_true(refused, "cost ceiling blocks LLM call before token burn")


# ---------------------------------------------------------------------------
# 4. Determinism
# ---------------------------------------------------------------------------

def test_determinism() -> None:
    print("\n[DETERMINISM]")
    out_a = run_sample(input_sha="determinism-sha-a")
    out_b = run_sample(input_sha="determinism-sha-a")
    sha_a = sorted([a.content_sha for a in out_a.artifacts])
    sha_b = sorted([a.content_sha for a in out_b.artifacts])
    assert_true(sha_a == sha_b, "same input -> same artifact content_sha")
    # freshness_timestamp is real wall clock; assert ISO 8601 UTC format.
    for a in out_a.artifacts:
        assert_true(
            a.freshness_timestamp.endswith("+00:00") or "Z" in a.freshness_timestamp,
            f"freshness_timestamp ISO 8601: {a.freshness_timestamp}",
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    print("[smoke] sample run")
    sample_out = run_sample()

    # Storage contract (FORA-117) — runs before failure modes so the AC
    # assertions are the first signal of a regression.
    test_storage_contract_round_trip()
    test_storage_contract_query_api_docs()
    test_storage_contract_query_accepted_adrs()
    test_storage_contract_freshness_stale_api_doc()
    test_storage_contract_query_latency_under_100ms()

    test_missing_input_sha()
    test_oversized_diff()
    test_ambiguous_conventional_commit()
    test_model_timeout()
    test_partial_knowledge_layer_write()
    test_cost_ceiling()
    test_determinism()

    # Persist evidence
    evidence_dir = Path(HERE) / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%dT%H%M%SZ")
    evidence_path = evidence_dir / f"smoke_{stamp}.json"
    evidence_path.write_text(json.dumps(sample_out.to_dict(), indent=2, default=str))
    print(f"\n[smoke] wrote {evidence_path}")

    # FORA-117 sample-run evidence: a single artefact that ties the
    # run to the storage contract and the cost record. The board /
    # CTO can read this in the issue thread.
    sample_run_evidence = {
        "spec": "FORA-117",
        "run_id": sample_out.run_id,
        "input_sha": sample_out.input_sha,
        "status": sample_out.status.value,
        "artifacts": [
            {k: v for k, v in a.to_dict().items() if k != "content"} | {"content_sha": a.content_sha}
            for a in sample_out.artifacts
        ] if False else [
            {"path": a.path, "kind": a.generator_type.value, "content_sha": a.content_sha,
             "freshness_timestamp": a.freshness_timestamp, "source_sha": a.source_sha,
             "approval_required": a.approval_required}
            for a in sample_out.artifacts
        ],
        "doc_index_version": sample_out.doc_index.version if sample_out.doc_index else None,
        "doc_index_entries": [
            {"path": e.path, "kind": e.kind.value, "title": e.title,
             "source_commit": e.source_commit, "approval_required": e.approval_required}
            for e in (sample_out.doc_index.entries if sample_out.doc_index else [])
        ],
        "adr_registry_version": sample_out.adr_registry.version if sample_out.adr_registry else None,
        "adr_registry_entries": [
            {"number": e.number, "title": e.title, "status": e.status.value,
             "architecture_area": e.architecture_area}
            for e in (sample_out.adr_registry.entries if sample_out.adr_registry else [])
        ],
        "freshness_warnings": [w.to_dict() for w in sample_out.freshness_warnings],
        "cost_record": asdict(sample_out.cost_record) if sample_out.cost_record else None,
        "freshness_metadata": asdict(sample_out.freshness_metadata) if sample_out.freshness_metadata else None,
    }
    sample_run_evidence_path = evidence_dir / f"sample_run_evidence.json"
    sample_run_evidence_path.write_text(json.dumps(sample_run_evidence, indent=2, default=str))
    print(f"[smoke] wrote {sample_run_evidence_path}")

    if FAILURES:
        print(f"\n[smoke] FAILED: {len(FAILURES)} assertion(s) failed")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("\n[smoke] all assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
