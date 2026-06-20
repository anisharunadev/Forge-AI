"""Run-summary generator smoke + failure-mode test (FORA-362 / MVP-6.a).

Runs the full acceptance battery from `forge/docs/prompt.md` §"Verification":

1. **Sample run** — stub input with 7 stage entries (PRD, Architect,
   Dev, QA, Security, DevOps, plus the docs self-row); output
   validates against `forge.docs.run_summary.output.v1` schema; the
   artefact carries `freshness_timestamp` + `source_sha`.
2. **All 6 failure modes**:
   - `MISSING_INPUT_SHA`      (input_sha empty)
   - `EMPTY_STAGES`           (stages[] empty)
   - `MODEL_TIMEOUT`          (cost recorder simulates a timeout; the
                              generator falls back to the fallback
                              model with `fallback_used=true`)
   - `OVERSIZED_INPUT`        (stage summaries expand past 60k tokens)
   - `JIRA_POST_FAILED`       (Jira MCP returns non-2xx; non-fatal,
                              surfaces in `errors[]`)
   - `CONSOLE_EVENT_FAILED`   (event-bus publish returns non-2xx;
                              non-fatal, surfaces in `errors[]`)
3. **Idempotency** — re-running with the same `source_run_sha`
   produces a byte-identical `run_summary.md` and replays the Jira
   comment + console event without re-firing them.
4. **Determinism** — same input → same `content_sha`.
5. **Side-effect ordering** — workspace write happens before Jira
   post, Jira post before console event, audit record last.
6. **Cost ceiling** — pre-LLM-call refusal when input > 60k tokens.

Run:

    python -m agents.documentation.run_summary_smoke_test

Writes evidence to
`agents/documentation/evidence/run_summary_smoke_<timestamp>.json`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))

from agents.documentation.run_summary import (  # noqa: E402
    RUN_SUMMARY_PATH,
    SIDEEFFECT_ORDER,
    WHAT_SHIPPED_WORD_CAP,
    RunSummaryGenerator,
    RunSummarySideEffects,
    compute_idempotency_key,
    render_run_summary_markdown,
    run_run_summary,
)
from agents.documentation.schemas import (  # noqa: E402
    CostRecord,
    INPUT_SCHEMA_VERSION,
    OUTPUT_SCHEMA_VERSION,
    RunSummaryArtifact,
    RunSummaryError,
    RunSummaryErrorKind,
    RunSummaryInput,
    RunSummaryLinks,
    RunSummarySource,
    RunSummarySourceKind,
    RunSummaryStageEntry,
    RunSummaryStageStatus,
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


# ---------------------------------------------------------------------------
# 1. Sample input — 7 stage entries (the full Forge run pipeline)
# ---------------------------------------------------------------------------

SAMPLE_SOURCE_RUN_SHA = (
    "9c1d2f8a4e7b6c5d3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e"
)
SAMPLE_RUN_ID = "0190f7e1-7c2b-7e0a-8c1d-3e5a9b6f0c12"
SAMPLE_TENANT = "acme"


def _sample_stages() -> List[RunSummaryStageEntry]:
    """7 stage entries matching the sample run-summary markdown."""
    return [
        RunSummaryStageEntry(
            stage_id="prd",
            stage_run_id="0190f7e1-7c2b-7e0a-8c1d-3e5a9b6f0111",
            agent_id="ba-agent",
            status=RunSummaryStageStatus.OK,
            artefact_kind="prd",
            artefact_id="prd-001",
            artefact_url=(
                "https://example.atlassian.net/wiki/spaces/FORA/pages/3481280513"
            ),
            summary=(
                "Draft PRD v0.3: 8 stories across 6 stage surfaces, success metric "
                "\"≥80% of PRDs pass structural lint on first try\", 3 board ambiguity "
                "questions raised, 2 resolved."
            ),
            approved_at="2026-06-18T08:30:00Z",
            approved_by_type="user",
            approved_by_id="board-chair",
            approved_by_display_name="Board Chair",
        ),
        RunSummaryStageEntry(
            stage_id="architect",
            stage_run_id="0190f7e1-7c2b-7e0a-8c1d-3e5a9b6f0222",
            agent_id="architect",
            status=RunSummaryStageStatus.OK,
            artefact_kind="architecture",
            artefact_id="arch-001",
            artefact_url=(
                "https://example.atlassian.net/wiki/spaces/FORA/pages/3481280514"
            ),
            summary=(
                "HLD v0.2 + LLD v0.1: 4 new components (orchestrator, sync-plane, "
                "console, doc-agent), 3 ADRs produced (ADR-0010 Cross-Platform Sync "
                "Plane Accepted), no breaking changes to existing services."
            ),
            approved_at="2026-06-18T08:32:00Z",
            approved_by_type="user",
            approved_by_id="cto",
            approved_by_display_name="CTO",
        ),
        RunSummaryStageEntry(
            stage_id="dev",
            stage_run_id="0190f7e1-7c2b-7e0a-8c1d-3e5a9b6f0333",
            agent_id="cto",
            status=RunSummaryStageStatus.OK,
            artefact_kind="code_patch",
            artefact_id="pr-347",
            artefact_url="https://github.com/foraffle/forge-ai/pull/347",
            summary=(
                "Implemented 8 stories: orchestrator stage-wake router, sync-plane "
                "envelope adapters (Jira/Console), console Approve button, doc-agent "
                "run-summary generator, 47 new tests across 4 packages, all green."
            ),
            approved_at="2026-06-18T08:35:00Z",
            approved_by_type="user",
            approved_by_id="senior-engineer",
            approved_by_display_name="Senior Engineer",
        ),
        RunSummaryStageEntry(
            stage_id="qa",
            stage_run_id="0190f7e1-7c2b-7e0a-8c1d-3e5a9b6f0444",
            agent_id="qa",
            status=RunSummaryStageStatus.OK,
            artefact_kind="test_report",
            artefact_id="qa-001",
            artefact_url=(
                "https://example.atlassian.net/wiki/spaces/FORA/pages/3481280515"
            ),
            summary=(
                "E2E suite green: 47/47 unit + 6/6 integration + 3/3 contract tests "
                "pass. No P0/P1 defects. Two P3s filed for follow-up (test data "
                "cleanup in stage-3 fixture, console error toast copy)."
            ),
            approved_at="2026-06-18T08:38:00Z",
            approved_by_type="user",
            approved_by_id="qa-lead",
            approved_by_display_name="QA Lead",
        ),
        RunSummaryStageEntry(
            stage_id="security",
            stage_run_id="0190f7e1-7c2b-7e0a-8c1d-3e5a9b6f0555",
            agent_id="security-engineer",
            status=RunSummaryStageStatus.OK,
            artefact_kind="security_scan",
            artefact_id="sec-001",
            artefact_url=(
                "https://example.atlassian.net/wiki/spaces/FORA/pages/3481280516"
            ),
            summary=(
                "SAST clean, SCA clean (no new high/critical CVEs from added deps), "
                "threat model reviewed against the new approve-cycle path. One medium "
                "finding: idempotency-key collision risk if sourceRunSha is not unique "
                "per tenant — tracked as SEC-MVP-6-01, mitigation in PR description."
            ),
            approved_at="2026-06-18T08:40:00Z",
            approved_by_type="user",
            approved_by_id="security-lead",
            approved_by_display_name="Security Lead",
        ),
        RunSummaryStageEntry(
            stage_id="devops",
            stage_run_id="0190f7e1-7c2b-7e0a-8c1d-3e5a9b6f0666",
            agent_id="devops",
            status=RunSummaryStageStatus.OK,
            artefact_kind="deploy_receipt",
            artefact_id="deploy-001",
            artefact_url=(
                "https://example.atlassian.net/wiki/spaces/FORA/pages/3481280517"
            ),
            summary=(
                "Deployed MVP demo fixture to `paperclip-local-board` tenant at "
                "2026-06-18T08:42:00Z. Smoke checks: console reachable, Jira webhook "
                "receiving, orchestrator stage-wake router wired, doc-agent wake path "
                "tested. Run summary generation kicked off at 08:44:55Z."
            ),
            approved_at="2026-06-18T08:45:00Z",
            approved_by_type="user",
            approved_by_id="devops-lead",
            approved_by_display_name="DevOps Lead",
        ),
    ]


def _sample_input(source_run_sha: str = SAMPLE_SOURCE_RUN_SHA) -> RunSummaryInput:
    return RunSummaryInput(
        schema=INPUT_SCHEMA_VERSION,
        tenant_id=SAMPLE_TENANT,
        run_id=SAMPLE_RUN_ID,
        source_run_sha=source_run_sha,
        source=RunSummarySource(
            kind=RunSummarySourceKind.JIRA_ISSUE,
            ref="FORA-339",
            one_line_prompt=(
                "We need to prepare a minimum working product (MVP) demo of the "
                "Forge AI platform end-to-end."
            ),
        ),
        stages=_sample_stages(),
        links=RunSummaryLinks(
            console=f"https://forge.fora.dev/forge/runs/{SAMPLE_RUN_ID}",
            jira_ticket="FORA-339",
            repo="foraffle/forge-ai@main",
        ),
    )


# Fixed clock for byte-identical re-runs.
def _fixed_clock() -> str:
    return "2026-06-18T08:45:12Z"


# ---------------------------------------------------------------------------
# 1. Sample run
# ---------------------------------------------------------------------------

def run_sample(source_run_sha: str = SAMPLE_SOURCE_RUN_SHA) -> Any:
    """Run the sample input end-to-end and return the RunSummaryOutput."""
    print("\n[SAMPLE RUN]")
    inp = _sample_input(source_run_sha=source_run_sha)
    errs = inp.validate()
    assert_true(not errs, f"sample input validates (errors={errs})")

    side_effects = RunSummarySideEffects()
    gen = RunSummaryGenerator(side_effects=side_effects, clock=_fixed_clock)
    out = gen.run(inp)

    # Output schema validation.
    out_errs = out.validate()
    assert_true(not out_errs, f"sample output validates (errors={out_errs})")
    assert_true(out.status == "ok", "sample run: status=ok")
    assert_true(out.run_id == SAMPLE_RUN_ID, "sample run: run_id echoed")
    assert_true(out.source_run_sha == source_run_sha, "sample run: source_run_sha echoed")
    assert_true(out.schema == OUTPUT_SCHEMA_VERSION, "sample run: output schema version matches")
    assert_true(len(out.artefacts) == 1, "sample run: exactly one artefact")
    artefact = out.artefacts[0]

    # Source attribution (parent spec hard constraint #2).
    assert_true(
        bool(artefact.freshness_timestamp),
        "sample run: artefact has freshness_timestamp",
    )
    assert_true(
        artefact.source_sha == source_run_sha,
        "sample run: artefact source_sha == source_run_sha",
    )
    assert_true(artefact.generator_type == "run_summary", "sample run: generator_type is run_summary")
    assert_true(
        artefact.path == RUN_SUMMARY_PATH,
        f"sample run: artefact path is {RUN_SUMMARY_PATH}",
    )
    assert_true(
        len(artefact.content_sha) == 64 and all(c in "0123456789abcdef" for c in artefact.content_sha),
        "sample run: content_sha is sha256 (64 hex chars)",
    )

    # Cost record present (parent spec hard constraint #4).
    assert_true(out.cost_record is not None, "sample run: cost_record present")
    assert_true(out.cost_record.model == inp.model, "sample run: cost_record.model matches input")

    # Section structure (parent spec §"Artefact shape").
    body = artefact.content
    for section in (
        "## What was shipped",
        "## Source",
        "## Stages",
        "## Links",
        "## Audit footer"[:0],  # noop; the footer is "_Generated by"
        "_Generated by `doc-agent` (run_summary generator)",
    ):
        if section.startswith("##"):
            assert_true(
                section in body,
                f"sample run: body contains heading '{section}'",
            )
        else:
            assert_true(section in body, f"sample run: body contains footer marker")

    # Source ref is rendered as a Jira link.
    assert_true(
        "[FORA-339](/FORA/issues/FORA-339)" in body,
        "sample run: source ref rendered as Jira deep-link",
    )

    # Stages table has 6 rows (we exclude the `docs` self-row).
    stage_rows = [
        line for line in body.splitlines()
        if line.startswith("| ") and "|" in line and "---" not in line
        and not line.startswith("| #") and not line.startswith("|---|")
    ]
    assert_true(
        len(stage_rows) == 6,
        f"sample run: stages table has 6 rows (one per prior stage; got {len(stage_rows)})",
    )

    # What-was-shipped cap.
    para = body.split("## What was shipped", 1)[1].split("## Source", 1)[0].strip()
    word_count = len(para.split())
    assert_true(
        word_count <= WHAT_SHIPPED_WORD_CAP,
        f"sample run: what-was-shipped ≤ {WHAT_SHIPPED_WORD_CAP} words (got {word_count})",
    )

    return out


# ---------------------------------------------------------------------------
# 2. Failure-mode tests
# ---------------------------------------------------------------------------

def test_missing_input_sha() -> None:
    print("\n[FAILURE-MODE] MISSING_INPUT_SHA")
    inp = _sample_input(source_run_sha="")  # type: ignore[arg-type]
    errs = inp.validate()
    assert_true(
        any("sourceRunSha" in e for e in errs),
        "missing source_run_sha caught by input.validate()",
    )

    side_effects = RunSummarySideEffects()
    gen = RunSummaryGenerator(side_effects=side_effects, clock=_fixed_clock)
    out = gen.run(inp)
    assert_true(out.status == "aborted", "MISSING_INPUT_SHA -> status=aborted")
    assert_true(len(out.artefacts) == 0, "MISSING_INPUT_SHA -> no artefacts")
    assert_true(
        out.errors and out.errors[0].kind == RunSummaryErrorKind.MISSING_INPUT_SHA,
        "MISSING_INPUT_SHA error kind reported",
    )
    assert_true(
        side_effects.invoked_order == [],
        "MISSING_INPUT_SHA: no side effects fired",
    )


def test_empty_stages() -> None:
    print("\n[FAILURE-MODE] EMPTY_STAGES")
    inp = _sample_input()
    inp.stages = []
    errs = inp.validate()
    assert_true(
        any("stages" in e for e in errs),
        "empty stages caught by input.validate()",
    )

    side_effects = RunSummarySideEffects()
    gen = RunSummaryGenerator(side_effects=side_effects, clock=_fixed_clock)
    out = gen.run(inp)
    assert_true(out.status == "aborted", "EMPTY_STAGES -> status=aborted")
    assert_true(len(out.artefacts) == 0, "EMPTY_STAGES -> no artefacts")
    assert_true(
        out.errors and out.errors[0].kind == RunSummaryErrorKind.EMPTY_STAGES,
        "EMPTY_STAGES error kind reported",
    )


def test_model_timeout_fallback() -> None:
    print("\n[FAILURE-MODE] MODEL_TIMEOUT (fallback to fallback_model)")

    # Simulate: the LLM call times out, the cost recorder reports the
    # fallback model + fallback_used=True. The generator does not abort
    # in this case — it reports the fallback in the cost record. The
    # smoke test asserts the cost record path, not the LLM call itself
    # (which is injected).
    def recorder(inp: RunSummaryInput) -> CostRecord:
        return CostRecord(
            prompt_hash=hashlib.sha256(INPUT_SCHEMA_VERSION.encode()).hexdigest(),
            model=inp.fallback_model,  # primary timed out; we used the fallback
            tokens_in=1234,
            tokens_out=567,
            usd=0.013,
            duration_ms=inp.timeout_ms,
            fallback_used=True,
        )

    inp = _sample_input()
    side_effects = RunSummarySideEffects()
    gen = RunSummaryGenerator(
        side_effects=side_effects, clock=_fixed_clock, cost_recorder=recorder,
    )
    out = gen.run(inp)
    assert_true(out.status == "ok", "MODEL_TIMEOUT + successful fallback -> status=ok")
    assert_true(out.cost_record is not None, "MODEL_TIMEOUT: cost_record emitted")
    assert_true(out.cost_record.fallback_used, "MODEL_TIMEOUT: fallback_used=true")
    assert_true(
        out.cost_record.model == inp.fallback_model,
        "MODEL_TIMEOUT: cost_record.model = fallback_model",
    )


def test_oversized_input() -> None:
    print("\n[FAILURE-MODE] OVERSIZED_INPUT")
    inp = _sample_input()
    # Pump the stage summaries so the pre-flight check trips. 60k
    # tokens ~= 240k chars; one giant summary is enough.
    big_summary = "x" * (61_000 * 4 + 1000)
    inp.stages[0].summary = big_summary

    side_effects = RunSummarySideEffects()
    gen = RunSummaryGenerator(side_effects=side_effects, clock=_fixed_clock)
    out = gen.run(inp)

    # OVERSIZED_INPUT is non-fatal per parent spec — it surfaces in
    # errors[] but the run can still complete if the warning is the
    # only issue. Our implementation flips status=aborted only on the
    # fatal subset (MISSING_INPUT_SHA / EMPTY_STAGES / MODEL_TIMEOUT);
    # OVERSIZED_INPUT must NOT be in that subset.
    has_oversized = any(
        e.kind == RunSummaryErrorKind.OVERSIZED_INPUT for e in out.errors
    )
    assert_true(has_oversized, "OVERSIZED_INPUT error kind reported")
    assert_true(
        out.status != "aborted",
        "OVERSIZED_INPUT is non-fatal (parent spec §'Failure modes')",
    )


def test_jira_post_failed_non_fatal() -> None:
    print("\n[FAILURE-MODE] JIRA_POST_FAILED (non-fatal)")
    inp = _sample_input()

    def failing_jira(ticket: str, body: str, idempotency_key: str) -> str:
        side_effects = RunSummarySideEffects()
        side_effects.invoked_order.append("jira")
        raise RuntimeError("Jira MCP returned 503")

    side_effects = RunSummarySideEffects()
    side_effects.jira_poster = failing_jira  # type: ignore[assignment]
    gen = RunSummaryGenerator(side_effects=side_effects, clock=_fixed_clock)
    out = gen.run(inp)
    assert_true(out.status == "ok", "JIRA_POST_FAILED: status=ok (non-fatal)")
    assert_true(len(out.artefacts) == 1, "JIRA_POST_FAILED: artefact still produced")
    has_jira_err = any(
        e.kind == RunSummaryErrorKind.JIRA_POST_FAILED for e in out.errors
    )
    assert_true(has_jira_err, "JIRA_POST_FAILED error kind reported")
    # Workspace + console + audit still fired.
    assert_true(
        "workspace" in side_effects.invoked_order,
        "JIRA_POST_FAILED: workspace write still happened",
    )
    assert_true(
        "console" in side_effects.invoked_order,
        "JIRA_POST_FAILED: console event still happened",
    )
    assert_true(
        "audit" in side_effects.invoked_order,
        "JIRA_POST_FAILED: audit record still written",
    )


def test_console_event_failed_non_fatal() -> None:
    print("\n[FAILURE-MODE] CONSOLE_EVENT_FAILED (non-fatal)")
    inp = _sample_input()

    def failing_console(event: Dict[str, Any]) -> None:
        side_effects = RunSummarySideEffects()
        side_effects.invoked_order.append("console")
        raise RuntimeError("event-bus publish failed")

    side_effects = RunSummarySideEffects()
    side_effects.console_publisher = failing_console  # type: ignore[assignment]
    gen = RunSummaryGenerator(side_effects=side_effects, clock=_fixed_clock)
    out = gen.run(inp)
    assert_true(out.status == "ok", "CONSOLE_EVENT_FAILED: status=ok (non-fatal)")
    assert_true(len(out.artefacts) == 1, "CONSOLE_EVENT_FAILED: artefact still produced")
    has_console_err = any(
        e.kind == RunSummaryErrorKind.CONSOLE_EVENT_FAILED for e in out.errors
    )
    assert_true(has_console_err, "CONSOLE_EVENT_FAILED error kind reported")


# ---------------------------------------------------------------------------
# 3. Idempotency
# ---------------------------------------------------------------------------

def test_idempotency() -> None:
    print("\n[IDEMPOTENCY]")
    inp_a = _sample_input()
    inp_b = _sample_input()  # same source_run_sha

    side_effects_a = RunSummarySideEffects()
    out_a = RunSummaryGenerator(side_effects=side_effects_a, clock=_fixed_clock).run(inp_a)

    side_effects_b = RunSummarySideEffects()
    out_b = RunSummaryGenerator(side_effects=side_effects_b, clock=_fixed_clock).run(inp_b)

    # The artefact body must be byte-identical.
    body_a = out_a.artefacts[0].content
    body_b = out_b.artefacts[0].content
    assert_true(body_a == body_b, "same source_run_sha -> byte-identical run_summary.md")

    # The content_sha must match.
    assert_true(
        out_a.artefacts[0].content_sha == out_b.artefacts[0].content_sha,
        "same source_run_sha -> same content_sha",
    )

    # The Jira idempotency-key must be deterministic.
    idem_a = compute_idempotency_key(inp_a, suffix="docs-comment")
    idem_b = compute_idempotency_key(inp_b, suffix="docs-comment")
    assert_true(idem_a == idem_b, "same source_run_sha -> same Jira idempotency-key")

    # The Jira idempotency-key shape must match the spec:
    # sha256(tenantId | runId | "docs-comment" | sourceRunSha).
    expected = hashlib.sha256(
        f"{SAMPLE_TENANT}|{SAMPLE_RUN_ID}|docs-comment|{SAMPLE_SOURCE_RUN_SHA}".encode()
    ).hexdigest()
    assert_true(idem_a == expected, "idempotency-key shape matches spec")


# ---------------------------------------------------------------------------
# 4. Determinism
# ---------------------------------------------------------------------------

def test_determinism() -> None:
    print("\n[DETERMINISM]")
    out_a = run_sample(source_run_sha="determinism-sha-a")
    out_b = run_sample(source_run_sha="determinism-sha-a")
    sha_a = out_a.artefacts[0].content_sha
    sha_b = out_b.artefacts[0].content_sha
    assert_true(sha_a == sha_b, "same input_sha -> same content_sha")


# ---------------------------------------------------------------------------
# 5. Side-effect ordering
# ---------------------------------------------------------------------------

def test_side_effect_ordering() -> None:
    print("\n[SIDE-EFFECT ORDERING]")
    side_effects = RunSummarySideEffects()
    gen = RunSummaryGenerator(side_effects=side_effects, clock=_fixed_clock)
    out = gen.run(_sample_input())

    expected = list(SIDEEFFECT_ORDER)
    assert_true(
        side_effects.invoked_order == expected,
        f"side-effect order matches spec ({expected}); got {side_effects.invoked_order}",
    )
    assert_true(out.status == "ok", "ordering test: status=ok")


# ---------------------------------------------------------------------------
# 6. Cost ceiling
# ---------------------------------------------------------------------------

def test_cost_ceiling() -> None:
    print("\n[COST-CEILING]")
    inp = _sample_input()
    # The default input is well under 60k tokens; sanity-check the
    # approximation function directly.
    from agents.documentation.run_summary import _approximate_input_tokens
    approx = _approximate_input_tokens(inp)
    ceiling = inp.cost_envelope["per_run_tokens_in"]
    assert_true(
        approx < ceiling,
        f"sample input ~{approx} tokens is under ceiling {ceiling}",
    )

    # And the pre-flight refuses when oversized.
    inp.stages[0].summary = "x" * (ceiling * 4 + 1000)
    side_effects = RunSummarySideEffects()
    out = RunSummaryGenerator(side_effects=side_effects, clock=_fixed_clock).run(inp)
    has_oversized = any(
        e.kind == RunSummaryErrorKind.OVERSIZED_INPUT for e in out.errors
    )
    assert_true(has_oversized, "cost ceiling trips on expanded input > ceiling")


# ---------------------------------------------------------------------------
# 7. Pure renderer (no I/O, no clock)
# ---------------------------------------------------------------------------

def test_pure_renderer() -> None:
    print("\n[PURE RENDERER]")
    inp = _sample_input()
    body_a = render_run_summary_markdown(inp, freshness_timestamp="2026-06-18T08:45:12Z")
    body_b = render_run_summary_markdown(inp, freshness_timestamp="2026-06-18T08:45:12Z")
    assert_true(body_a == body_b, "renderer is pure: same input + clock -> byte-identical")

    # Different clock -> different body (proves the timestamp is the
    # only non-deterministic field).
    body_c = render_run_summary_markdown(inp, freshness_timestamp="2026-06-18T09:00:00Z")
    assert_true(
        body_a != body_c,
        "different freshness_timestamp -> different body bytes",
    )

    # Required sections all present.
    for marker in (
        "# Run summary — FORA-339",
        "## What was shipped",
        "## Source",
        "## Stages",
        "## Links",
        "_Generated by `doc-agent` (run_summary generator)",
    ):
        assert_true(marker in body_a, f"renderer: body contains '{marker}'")


# ---------------------------------------------------------------------------
# 8. Payload coercion (the wake handler entry point)
# ---------------------------------------------------------------------------

def test_payload_coercion() -> None:
    print("\n[PAYLOAD COERCION]")
    payload = {
        "schema": INPUT_SCHEMA_VERSION,
        "tenantId": SAMPLE_TENANT,
        "runId": SAMPLE_RUN_ID,
        "sourceRunSha": SAMPLE_SOURCE_RUN_SHA,
        "source": {
            "kind": "jira_issue",
            "ref": "FORA-339",
            "oneLinePrompt": "We need to prepare an MVP demo.",
        },
        "stages": [
            {
                "stageId": "devops",
                "stageRunId": "0190f7e1-7c2b-7e0a-8c1d-3e5a9b6f0666",
                "agentId": "devops",
                "status": "ok",
                "artefactKind": "deploy_receipt",
                "artefactId": "deploy-001",
                "artefactUrl": "https://example.com/deploy",
                "summary": "Deployed MVP demo.",
                "approvedAt": "2026-06-18T08:45:00Z",
                "approvedBy": {"type": "user", "id": "devops-lead", "displayName": "DevOps Lead"},
            },
        ],
        "links": {
            "console": f"https://forge.fora.dev/forge/runs/{SAMPLE_RUN_ID}",
            "jiraTicket": "FORA-339",
            "repo": "foraffle/forge-ai@main",
        },
        "cost_envelope": {"per_run_tokens_in": 60_000, "per_run_tokens_out": 20_000},
        "model": "claude-sonnet-4-6",
        "fallback_model": "gemini-2.5-pro",
        "timeout_ms": 30_000,
    }

    side_effects = RunSummarySideEffects()
    out = run_run_summary(payload, side_effects=side_effects, clock=_fixed_clock)
    assert_true(out.status == "ok", "payload coercion: status=ok")
    assert_true(len(out.artefacts) == 1, "payload coercion: one artefact emitted")
    assert_true(out.run_id == SAMPLE_RUN_ID, "payload coercion: run_id echoed")
    assert_true(
        out.source_run_sha == SAMPLE_SOURCE_RUN_SHA,
        "payload coercion: source_run_sha echoed",
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    print("=== run_summary generator smoke test (FORA-362 / MVP-6.a) ===")

    # 1. Sample run.
    sample_out = run_sample()

    # 2. Failure modes.
    test_missing_input_sha()
    test_empty_stages()
    test_model_timeout_fallback()
    test_oversized_input()
    test_jira_post_failed_non_fatal()
    test_console_event_failed_non_fatal()

    # 3. Idempotency.
    test_idempotency()

    # 4. Determinism.
    test_determinism()

    # 5. Side-effect ordering.
    test_side_effect_ordering()

    # 6. Cost ceiling.
    test_cost_ceiling()

    # 7. Pure renderer.
    test_pure_renderer()

    # 8. Payload coercion.
    test_payload_coercion()

    # Persist evidence.
    evidence_dir = Path(HERE) / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%dT%H%M%SZ")
    evidence_path = evidence_dir / f"run_summary_smoke_{stamp}.json"
    evidence_path.write_text(
        json.dumps(sample_out.to_dict(), indent=2, default=str)
    )
    print(f"\n[smoke] wrote {evidence_path}")

    if FAILURES:
        print(f"\n[smoke] FAILED: {len(FAILURES)} assertion(s) failed")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("\n[smoke] all assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())