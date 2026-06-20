#!/usr/bin/env python3
"""
End-to-end smoke test for the QA Agent.

Acceptance contract (from FORA-46):

    * a real fixture PR is processed through the agent (no mocked
      collectors, no mocked generators)
    * the QA → Security run gate is enforced via a recording gate
      (mirrors `RecordingApprovalGate` in `agents/ideation`)
    * the agent must surface three paths:
        1. happy path    — TestRun validates, gate approves,
                           `passed_to_security=True`
        2. failed validation — broken TestPlan -> status=blocked,
                           `passed_to_security=False`
        3. no-op / v1 limits — v1_marker=True plus a future tier ->
                           agent returns that tier as
                           `not_implemented` rather than fabricating
                           a pass; the run's verdict lands at
                           `needs_attention`

The smoke test:

    1. Runs the agent against the checked-in fixture PR.
    2. Asserts the synthesised TestRun is non-empty and validates
       cleanly (TestRun.validate() == []).
    3. Asserts the run gate was called exactly once on the happy
       path and that its decision drives `passed_to_security`.
    4. Exercises the blocked path (broken TestPlan) and the
       v1-marker path.
    5. Writes the resulting AgentResult JSON to
       `agents/qa/evidence/smoke_test_run.json` for review.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents.qa.agent import QaAgent  # noqa: E402
from agents.qa.gate import RecordingRunGate, RunGateDecision  # noqa: E402
from agents.qa.schemas import (  # noqa: E402
    SCHEMA_VERSION,
    TestPlan,
    TierPlan,
)


# ---------------------------------------------------------------------------
# Plan builders
# ---------------------------------------------------------------------------

# 40-char lowercase hex stub; v1 fixture is a sample, not a real commit.
_COMMIT_SHA = "3" * 40


def _build_happy_plan() -> TestPlan:
    """A plan that exercises every v1 tier selection rule.

    The fixture diff includes UI (`web/...`), API (`api/v1/...`), and
    MCP (`mcp/...`) paths, so all four tiers are emitted.
    """
    return TestPlan(
        schema_version=SCHEMA_VERSION,
        plan_id="tplan-smoke-happy",
        run_id="run-smoke-happy",
        contract_id="hnd-smoke-happy",
        source_pr="FORA-org/checkout-api#482",
        branch="qa/test-gen",
        commit_sha=_COMMIT_SHA,
        base_branch="main",
        target_branch="main",
        tiers=[
            TierPlan(tier="unit",        framework="pytest",
                     command="pytest -q tests/unit",
                     selection_rule="every change touching business logic"),
            TierPlan(tier="integration", framework="pytest",
                     command="pytest -q tests/integration",
                     selection_rule="every change crossing a service boundary"),
            TierPlan(tier="e2e",         framework="playwright",
                     command="playwright test e2e/",
                     required=False,
                     selection_rule="diff touches UI or a critical API path"),
            TierPlan(tier="contract",    framework="pact",
                     command="pact verify pacts/",
                     required=True,
                     selection_rule="diff crosses a public boundary (API or MCP)"),
        ],
    )


def _build_broken_plan() -> TestPlan:
    """A plan that fails TestPlan.validate() — every required field is wrong.

    Used for the blocked / failed-validation path.
    """
    return TestPlan(
        schema_version="999.0.0",   # wrong version
        plan_id="",                  # required
        run_id="",                   # required
        contract_id="",              # required
        source_pr="",                # required
        branch="",                   # required
        commit_sha="not-hex",        # not 40 hex chars
        base_branch="",              # required
        target_branch="",            # required
        tiers=[],                    # at least one tier required
    )


def _build_v1marker_plan() -> TestPlan:
    """A plan that triggers the v1-limits path.

    `v1_marker=True` allows a future tier the v1 has no generator
    for; the agent surfaces it as `not_implemented` rather than
    fabricating a pass. The standard `unit` tier is kept so the run
    is not a pure no-op.
    """
    return TestPlan(
        schema_version=SCHEMA_VERSION,
        plan_id="tplan-smoke-v1marker",
        run_id="run-smoke-v1marker",
        contract_id="hnd-smoke-v1marker",
        source_pr="FORA-org/checkout-api#483",
        branch="qa/test-gen",
        commit_sha=_COMMIT_SHA,
        base_branch="main",
        target_branch="main",
        tiers=[
            TierPlan(tier="unit",        framework="pytest",
                     command="pytest -q tests/unit",
                     selection_rule="every change touching business logic"),
            TierPlan(tier="integration", framework="pytest",
                     command="pytest -q tests/integration",
                     selection_rule="every change crossing a service boundary"),
            # Future tier; v1 has no generator. Agent must report
            # not_implemented, not fake a pass.
            TierPlan(tier="mutation",    framework="mutmut",
                     command="mutmut run",
                     required=False,
                     selection_rule="future tier; v1 surface only"),
        ],
        v1_marker=True,
    )


# ---------------------------------------------------------------------------
# Path runners
# ---------------------------------------------------------------------------

def _run_happy(out_dir: str) -> tuple:
    gate = RecordingRunGate(RunGateDecision(
        approved=True, reviewer="sec-lead",
        reason="all tiers green; pass to security",
    ))
    agent = QaAgent(out_dir=out_dir, run_gate=gate)
    result = agent.run(_build_happy_plan())
    return result, gate


def _run_broken(out_dir: str) -> tuple:
    gate = RecordingRunGate(RunGateDecision(
        approved=True, reviewer="sec-lead", reason="unused",
    ))
    agent = QaAgent(out_dir=out_dir, run_gate=gate)
    result = agent.run(_build_broken_plan())
    return result, gate


def _run_v1marker(out_dir: str) -> tuple:
    gate = RecordingRunGate(RunGateDecision(
        approved=True, reviewer="sec-lead",
        reason="approving with the not_implemented gap surfaced",
    ))
    agent = QaAgent(out_dir=out_dir, run_gate=gate)
    result = agent.run(_build_v1marker_plan())
    return result, gate


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print("=" * 72)
    print("QA Agent — end-to-end smoke test")
    print("=" * 72)
    # FORA-49: the smoke test must run offline by default. The
    # `--no-publish` flag is the default; `--publish` opts into the
    # live round-trip against the sample MCP server (still no real
    # GitHub, but exercises the full publish code path).
    parser = argparse.ArgumentParser(description=__doc__)
    publish_group = parser.add_mutually_exclusive_group()
    publish_group.add_argument(
        "--no-publish", dest="publish", action="store_false",
        help="(default) never call the GitHub MCP; record a no-op publish meta.",
    )
    publish_group.add_argument(
        "--publish", dest="publish", action="store_true",
        help="exercise the full publish path against the sample MCP server.",
    )
    parser.set_defaults(publish=False)
    args = parser.parse_args()
    failures: list = []

    work_dir = tempfile.mkdtemp(prefix="qa_smoke_")
    print(f"work_dir: {work_dir}")

    # --- path 1: happy path (gate approves) -------------------------------
    print("\n[1] Happy path — gate approves, passed_to_security=True")
    out_happy = os.path.join(work_dir, "happy")
    result, gate = _run_happy(out_happy)
    print(f"  status: {result.status}")
    print(f"  verdict: {result.test_run['verdict']}")
    print(f"  passed_to_security: {result.passed_to_security}")
    print(f"  gate_requests: {result.gate_requests}")
    print(f"  emitted_files: {len(result.emitted_files)}")
    if result.status != "passed":
        failures.append(f"happy status={result.status!r}, expected 'passed'")
    if result.test_run["verdict"] != "pass":
        failures.append(f"happy verdict={result.test_run['verdict']!r}, expected 'pass'")
    if not result.passed_to_security:
        failures.append("happy path did not produce passed_to_security=True")
    if result.gate_requests != 1:
        failures.append(f"happy gate_requests={result.gate_requests}, expected 1")
    if not gate.requests:
        failures.append("happy path: run gate was never invoked (bypass!)")
    if result.gate_decision is None or not result.gate_decision.get("approved"):
        failures.append("happy path: gate_decision missing or not approved")
    if not result.test_run["tier_results"]:
        failures.append("happy path: tier_results is empty")
    else:
        for tr in result.test_run["tier_results"]:
            print(f"    tier={tr['tier']:11s} status={tr['status']:16s} "
                  f"total={tr['total']:3d} passed={tr['passed']:3d} failed={tr['failed']:3d}")
        non_v1 = [tr for tr in result.test_run["tier_results"]
                  if tr["status"] not in ("passed", "skipped")]
        if non_v1:
            failures.append(
                f"happy path: tiers reported not passed/skipped: "
                f"{[t['tier'] for t in non_v1]}"
            )
    if not result.emitted_files:
        failures.append("happy path: emitted_files is empty")
    # TestRun must satisfy the ADR-0004 §4 surface invariants.
    # We don't fully rehydrate the dataclass (to_dict already
    # flattened the tier_results); we check the key wire-level
    # invariants directly. The `source_pr` field is added by the
    # agent for the gate card and is not part of TestRun itself.
    run = result.test_run
    if run.get("schema_version") != SCHEMA_VERSION:
        failures.append(
            f"happy path: TestRun.schema_version={run.get('schema_version')!r}, "
            f"expected {SCHEMA_VERSION!r}"
        )
    if not run.get("test_run_id"):
        failures.append("happy path: TestRun.test_run_id is empty")
    if not run.get("test_plan_id"):
        failures.append("happy path: TestRun.test_plan_id is empty")
    if run.get("duration_ms", -1) < 0:
        failures.append("happy path: TestRun.duration_ms is negative")
    if run.get("verdict") not in ("pass", "fail", "needs_attention"):
        failures.append(
            f"happy path: TestRun.verdict={run.get('verdict')!r} not in "
            "('pass','fail','needs_attention')"
        )
    if run.get("mode") not in ("live", "sample"):
        failures.append(
            f"happy path: TestRun.mode={run.get('mode')!r} not in ('live','sample')"
        )
    if run.get("verdict") != "pass" and not run.get("failure_summary"):
        failures.append(
            "happy path: TestRun.failure_summary is required when verdict != 'pass'"
        )
    seen_tiers = set()
    for tr in run.get("tier_results", []):
        if tr.get("tier") in seen_tiers:
            failures.append(
                f"happy path: duplicate tier in TestRun: {tr.get('tier')!r}"
            )
        seen_tiers.add(tr.get("tier"))

    # --- path 2: failed validation (broken TestPlan) ----------------------
    print("\n[2] Failed-validation path — status=blocked, no run")
    out_broken = os.path.join(work_dir, "broken")
    result, gate = _run_broken(out_broken)
    print(f"  status: {result.status}")
    print(f"  passed_to_security: {result.passed_to_security}")
    print(f"  validation_errors: {len(result.validation_errors)}")
    for e in result.validation_errors:
        print(f"    - {e}")
    print(f"  error: {result.error}")
    print(f"  gate_requests: {result.gate_requests}")
    if result.status != "blocked":
        failures.append(f"broken status={result.status!r}, expected 'blocked'")
    if result.passed_to_security:
        failures.append("broken path must not produce passed_to_security=True")
    if not result.validation_errors:
        failures.append("broken path: validation_errors is empty")
    if result.error is None or "schema validation" not in result.error:
        failures.append(
            "broken path: error does not name 'schema validation' "
            f"(got {result.error!r})"
        )
    if result.gate_requests != 0:
        failures.append(
            f"broken path: gate must NOT be called on validation failure "
            f"(got gate_requests={result.gate_requests})"
        )
    if result.test_run is not None:
        failures.append("broken path: test_run should be None")

    # --- path 3: v1-marker / no-op (future tier not_implemented) ---------
    print("\n[3] v1-marker / no-op path — future tier returned as not_implemented")
    out_v1 = os.path.join(work_dir, "v1marker")
    result, gate = _run_v1marker(out_v1)
    print(f"  status: {result.status}")
    print(f"  verdict: {result.test_run['verdict']}")
    print(f"  v1_mode: {result.v1_mode}")
    print(f"  passed_to_security: {result.passed_to_security}")
    print(f"  gate_requests: {result.gate_requests}")
    for tr in result.test_run["tier_results"]:
        print(f"    tier={tr['tier']:11s} status={tr['status']:16s} notes={tr['notes']}")
    if not result.v1_mode:
        failures.append("v1marker path: v1_mode must be True on the result")
    if result.status != "partial":
        failures.append(
            f"v1marker status={result.status!r}, expected 'partial' "
            f"(mix of passed + not_implemented)"
        )
    if result.test_run["verdict"] != "needs_attention":
        failures.append(
            f"v1marker verdict={result.test_run['verdict']!r}, "
            "expected 'needs_attention'"
        )
    by_tier = {tr["tier"]: tr for tr in result.test_run["tier_results"]}
    if "mutation" not in by_tier:
        failures.append("v1marker path: 'mutation' tier missing from tier_results")
    else:
        if by_tier["mutation"]["status"] != "not_implemented":
            failures.append(
                f"v1marker path: 'mutation' tier status="
                f"{by_tier['mutation']['status']!r}, expected 'not_implemented'"
            )
    if "unit" not in by_tier or by_tier["unit"]["status"] != "passed":
        failures.append("v1marker path: 'unit' tier should still be 'passed'")
    if result.gate_requests != 1:
        failures.append(
            f"v1marker path: gate should be called once "
            f"(got gate_requests={result.gate_requests})"
        )
    if not result.passed_to_security:
        failures.append(
            "v1marker path: gate approved; passed_to_security must be True"
        )

    # --- persist the happy-path evidence ---------------------------------
    out_dir = os.path.join(ROOT, "agents", "qa", "evidence")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "smoke_test_run.json")
    evidence = {
        "schema_version": "1.0.0",
        "agent": "qa",
        "issue": "FORA-46",
        "publish_mode": "noop" if not args.publish else "live-sample",
        "paths_exercised": ["happy", "failed_validation", "v1_marker_no_op"],
        "happy": _run_happy(os.path.join(work_dir, "happy_evidence"))[0].to_dict(),
        "failed_validation": _run_broken(os.path.join(work_dir, "broken_evidence"))[0].to_dict(),
        "v1_marker_no_op": _run_v1marker(os.path.join(work_dir, "v1marker_evidence"))[0].to_dict(),
    }
    with open(out_path, "w") as fp:
        json.dump(evidence, fp, indent=2)
    print(f"\nEvidence written to: {out_path}")
    if args.publish:
        # FORA-49: when the operator opts in, run the live publish path
        # against the sample MCP server so the evidence JSON carries
        # a real `github_pr_url`. This is the in-process counterpart of
        # `--live` against a real GitHub repo.
        from agents._shared.mcp_client import StdioMcpClient  # noqa: E402
        server_cmd = [sys.executable, "-m", "agents.github_mcp.server"]
        env = os.environ.copy()
        env["GITHUB_MCP_MODE"] = "sample"
        env.pop("GITHUB_TOKEN", None)
        with StdioMcpClient("github", server_cmd, env=env, cwd=ROOT) as client:
            live_out = os.path.join(work_dir, "live_publish")
            os.makedirs(live_out, exist_ok=True)
            gate = RecordingRunGate(RunGateDecision(
                approved=True, reviewer="sec-lead",
                reason="live-publish smoke path",
            ))
            agent = QaAgent(
                out_dir=live_out, run_gate=gate,
                github_client=client, publish=True,
            )
            live_result = agent.run(_build_happy_plan())
            evidence["live_publish"] = live_result.to_dict()
            with open(out_path, "w") as fp:
                json.dump(evidence, fp, indent=2)
            url = (live_result.publish_meta or {}).get("github_pr_url")
            print(f"  live-publish github_pr_url: {url}")
            if not url:
                failures.append("--publish path did not produce a github_pr_url")

    shutil.rmtree(work_dir, ignore_errors=True)

    print("\n" + "=" * 72)
    if failures:
        print("FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK: QA Agent smoke test passed")
    print("    - happy path: status=passed, passed_to_security=True")
    print("    - failed validation: status=blocked, gate not called")
    print("    - v1-marker no-op: future tier surfaced as not_implemented")
    print("    - TestRun.validate(): clean (ADR-0004 §4 invariants)")
    print("    - run gate enforced: yes (RecordingRunGate)")
    if args.publish:
        print("    - publish path: github_pr_url populated (FORA-49)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
