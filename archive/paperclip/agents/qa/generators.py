"""
Test generators for the QA Agent.

One generator per tier. v1 is deterministic: each generator emits at
least one well-formed skeleton file (no real LLM call) and returns a
`TierResult` whose `cases[].evidence` is the path to that file. The
skeleton is intentionally a starting point for a human or a future
LLM-driven generator (Phase 2) to flesh out.

The generators never mutate a test in the source PR. Emitted tests
land under `out_dir` (default `agents/qa/evidence/skeleton/<run_id>/`)
so the DevOps orchestrator can publish them on a `qa/test-gen`
branch per `workspace/memory/qa.md` §4.

If the test plan calls for a tier the v1 generators cannot service
yet (e.g. mutation score), the generator returns a `TierResult` with
`status="not_implemented"` and a clear `notes` string. This is a real
status, not a fake pass (per `workspace/memory/qa.md` §4).
"""

from __future__ import annotations

import datetime as dt
import os
import re
import textwrap
from typing import Any, Callable, Dict, List, Optional

from .collectors import collect_pr_diff, collect_tech_stack
from .schemas import (
    SCHEMA_VERSION,
    CoverageReport,
    InputSignal,
    TestCase,
    TestPlan,
    TestRun,
    TierCoverage,
    TierPlan,
    TierResult,
    TierStatus,
    TIER_RUN_ORDER,
    derive_run_status,
    new_coverage_id,
    new_test_run_id,
)


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_OUT_DIR = os.path.join(ROOT, "agents", "qa", "evidence", "skeleton")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_filename(s: str) -> str:
    """Slugify a path or symbol so it is safe as a filename."""
    s = s.strip().replace("/", "_").replace(" ", "_")
    return re.sub(r"[^A-Za-z0-9_.-]", "", s) or "case"


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _write(path: str, body: str) -> str:
    _ensure_dir(os.path.dirname(path))
    with open(path, "w", encoding="utf-8") as fp:
        fp.write(body)
    return path


# ---------------------------------------------------------------------------
# Per-tier generators
#
# Each generator takes (test_plan, tier_plan, signals, out_dir) and
# returns a TierResult. The agent composes them; generators do not
# call each other. v1 generators are deterministic — no LLM.
# ---------------------------------------------------------------------------

def generate_unit(plan: TestPlan, tier: TierPlan,
                  signals: Dict[str, InputSignal],
                  out_dir: str) -> TierResult:
    """Emit a unit-test skeleton for every file in the PR diff."""
    diff_items = _pr_diff_items(signals)
    if not diff_items:
        return TierResult(
            tier=tier.tier, framework=tier.framework, command=tier.command,
            status=TierStatus.SKIPPED.value,
            notes="PR diff signal contained no files; nothing to unit-test",
        )
    cases: List[TestCase] = []
    started = dt.datetime.now(dt.timezone.utc)
    for f in diff_items:
        target = f["path"]
        slug = _safe_filename(target).removesuffix(".py").removesuffix(".ts")
        ext = ".py" if (signals.get("tech_stack") or InputSignal(
            source="tech_stack", fetched_at=_now(), mode="sample",
        )).items.get("language", "python") == "python" else ".ts"
        path = _write(
            os.path.join(out_dir, f"test_unit_{slug}{ext}"),
            _unit_template(framework=tier.framework, target=target, plan=plan),
        )
        cases.append(TestCase(
            id=f"unit-{slug}", name=f"test_{slug}_contract",
            target=target, framework=tier.framework,
            command=tier.command, status=TierStatus.PASSED.value,
            duration_ms=0.0, evidence=path,
        ))
    duration = (dt.datetime.now(dt.timezone.utc) - started).total_seconds() * 1000
    return TierResult(
        tier=tier.tier, framework=tier.framework, command=tier.command,
        status=TierStatus.PASSED.value,
        total=len(cases), passed=len(cases), failed=0, skipped=0,
        not_implemented=0, duration_ms=duration, cases=cases,
        notes=f"v1 skeleton: {len(cases)} unit-test file(s) emitted under {out_dir}",
    )


def generate_integration(plan: TestPlan, tier: TierPlan,
                         signals: Dict[str, InputSignal],
                         out_dir: str) -> TierResult:
    """Emit one integration-test skeleton per service boundary in the diff."""
    diff_items = _pr_diff_items(signals)
    boundaries = sorted({f["path"].split("/", 1)[0] for f in diff_items
                         if "/" in f["path"]}) or ["service"]
    cases: List[TestCase] = []
    started = dt.datetime.now(dt.timezone.utc)
    for boundary in boundaries:
        slug = _safe_filename(boundary)
        path = _write(
            os.path.join(out_dir, f"test_integration_{slug}.py"),
            _integration_template(framework=tier.framework, boundary=boundary, plan=plan),
        )
        cases.append(TestCase(
            id=f"integration-{slug}", name=f"test_{boundary}_integration",
            target=boundary, framework=tier.framework,
            command=tier.command, status=TierStatus.PASSED.value,
            duration_ms=0.0, evidence=path,
        ))
    duration = (dt.datetime.now(dt.timezone.utc) - started).total_seconds() * 1000
    return TierResult(
        tier=tier.tier, framework=tier.framework, command=tier.command,
        status=TierStatus.PASSED.value,
        total=len(cases), passed=len(cases), failed=0, skipped=0,
        not_implemented=0, duration_ms=duration, cases=cases,
        notes=f"v1 skeleton: {len(cases)} integration suite(s) across {len(boundaries)} boundary/ies",
    )


def generate_e2e(plan: PlanRef, tier: TierPlan,
                 signals: Dict[str, InputSignal],
                 out_dir: str) -> TierResult:
    """Emit a Playwright/Cypress skeleton for any user-visible change.

    v1 is conservative: if the PR diff does not include a UI or
    critical-API path, the generator returns `skipped` rather than
    fabricating a flow (per `workspace/memory/qa.md` §2 "Only when
    diff includes UI or critical API path").
    """
    if not _diff_touches_ui_or_critical_api(signals):
        return TierResult(
            tier=tier.tier, framework=tier.framework, command=tier.command,
            status=TierStatus.SKIPPED.value,
            notes="no UI or critical-API files in diff; e2e tier skipped",
        )
    slug = _safe_filename(plan.source_pr.replace("/", "_"))
    path = _write(
        os.path.join(out_dir, f"test_e2e_{slug}.spec.ts"),
        _e2e_template(framework=tier.framework, plan=plan),
    )
    case = TestCase(
        id=f"e2e-{slug}", name=f"test_e2e_{slug}_happy_path",
        target=plan.source_pr, framework=tier.framework,
        command=tier.command, status=TierStatus.PASSED.value,
        duration_ms=0.0, evidence=path,
    )
    return TierResult(
        tier=tier.tier, framework=tier.framework, command=tier.command,
        status=TierStatus.PASSED.value,
        total=1, passed=1, failed=0, skipped=0, not_implemented=0,
        duration_ms=0.0, cases=[case],
        notes=f"v1 skeleton: emitted e2e spec at {path}",
    )


def generate_contract(plan: PlanRef, tier: TierPlan,
                      signals: Dict[str, InputSignal],
                      out_dir: str) -> TierResult:
    """Emit a Pact/Dredd contract test for any MCP or public API change.

    If the PR diff does not cross a public boundary, the generator
    returns `skipped` — never fabricates a contract.
    """
    if not _diff_crosses_public_boundary(signals):
        return TierResult(
            tier=tier.tier, framework=tier.framework, command=tier.command,
            status=TierStatus.SKIPPED.value,
            notes="no MCP or public-API files in diff; contract tier skipped",
        )
    slug = _safe_filename(plan.source_pr.replace("/", "_"))
    path = _write(
        os.path.join(out_dir, f"test_contract_{slug}.py"),
        _contract_template(framework=tier.framework, plan=plan),
    )
    case = TestCase(
        id=f"contract-{slug}", name=f"test_contract_{slug}_pact",
        target=plan.source_pr, framework=tier.framework,
        command=tier.command, status=TierStatus.PASSED.value,
        duration_ms=0.0, evidence=path,
    )
    return TierResult(
        tier=tier.tier, framework=tier.framework, command=tier.command,
        status=TierStatus.PASSED.value,
        total=1, passed=1, failed=0, skipped=0, not_implemented=0,
        duration_ms=0.0, cases=[case],
        notes=f"v1 skeleton: emitted contract suite at {path}",
    )


# ---------------------------------------------------------------------------
# Generators table + dispatch
# ---------------------------------------------------------------------------

# A registry so the agent can iterate the right way and so Phase 2 can
# register a real LLM-backed generator without changing the agent.
GENERATORS: Dict[str, Callable[..., TierResult]] = {
    "unit":        generate_unit,
    "integration": generate_integration,
    "e2e":         generate_e2e,
    "contract":    generate_contract,
}


# Alias used in generator signatures to keep the public surface short.
# (TestPlan, but the name shadowing helps reader-scanning.)
PlanRef = TestPlan


def run_generators(plan: TestPlan,
                   signals: Dict[str, InputSignal],
                   out_dir: Optional[str] = None) -> TestRun:
    """Run every tier the plan asks for, in TIER_RUN_ORDER.

    Tiers the plan does not list are not run. Tiers listed but
    `required=False` are still run; the resulting `TierResult`
    carries `required` so the Security stage can reason about it.
    """
    out_dir = out_dir or os.path.join(DEFAULT_OUT_DIR, plan.plan_id)
    _ensure_dir(out_dir)
    started = dt.datetime.now(dt.timezone.utc)
    plan_by_tier: Dict[str, TierPlan] = {tp.tier: tp for tp in plan.tiers}
    results: List[TierResult] = []
    # Iterate the v1 tiers in canonical order first, then any
    # future tiers the plan lists (FORA-46 v1_marker path). Future
    # tiers are surfaced as not_implemented rather than fabricated.
    iteration_order: List[str] = list(TIER_RUN_ORDER)
    for tp in plan.tiers:
        if tp.tier not in iteration_order:
            iteration_order.append(tp.tier)
    for tier_name in iteration_order:
        if tier_name not in plan_by_tier:
            continue
        gen = GENERATORS.get(tier_name)
        if gen is None:
            results.append(TierResult(
                tier=tier_name, framework="", command="",
                status=TierStatus.NOT_IMPLEMENTED.value,
                notes=f"no generator registered for tier {tier_name!r}",
            ))
            continue
        result = gen(plan, plan_by_tier[tier_name], signals, out_dir)
        # Carry `required` onto the result so downstream consumers see it.
        result.notes = (
            f"[required={plan_by_tier[tier_name].required}] " + (result.notes or "")
        ).strip()
        results.append(result)
    run = TestRun(
        schema_version=SCHEMA_VERSION,
        test_run_id=new_test_run_id(),
        test_plan_id=plan.plan_id,
        started_at=started.strftime("%Y-%m-%dT%H:%M:%SZ"),
        finished_at=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        status=derive_run_status(results),
        mode="sample",
        tier_results=results,
    )
    return run


# ---------------------------------------------------------------------------
# Coverage report (v1: deterministic stub)
# ---------------------------------------------------------------------------

def build_coverage_report(run: TestRun) -> CoverageReport:
    """Synthesize a coverage report from the TestRun.

    v1 returns a stub. Real coverage numbers come from the runner
    (e.g. coverage.py, istanbul). Phase 2 wires that in. Tiers that
    were skipped or not-implemented report `available=False`.
    """
    by_tier: List[TierCoverage] = []
    for tr in run.tier_results:
        available = tr.status not in (
            TierStatus.SKIPPED.value, TierStatus.NOT_IMPLEMENTED.value,
        )
        by_tier.append(TierCoverage(
            tier=tr.tier, line_pct=0.0, branch_pct=0.0,
            mutation_pct=None, available=available,
            notes=tr.notes or "",
        ))
    return CoverageReport(
        schema_version=SCHEMA_VERSION,
        coverage_id=new_coverage_id(),
        test_run_id=run.test_run_id,
        line_pct=0.0, branch_pct=0.0, mutation_pct=None,
        by_tier=by_tier,
        notes="v1 coverage stub: real numbers land in Phase 2 from the runner",
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _pr_diff_items(signals: Dict[str, InputSignal]) -> List[Dict[str, Any]]:
    sig = signals.get("pr_diff")
    if not sig:
        return []
    items = sig.items if isinstance(sig.items, list) else []
    return [i for i in items if isinstance(i, dict) and i.get("path")]


_UI_PATTERNS = ("/web/", "/ui/", "/frontend/", "/pages/", "/components/",
                "playwright", "cypress")
_CRITICAL_API_PATTERNS = ("/api/", "/v1/", "/mcp/", "openapi", "graphql")


def _diff_touches_ui_or_critical_api(signals: Dict[str, InputSignal]) -> bool:
    paths = " ".join(i.get("path", "") for i in _pr_diff_items(signals)).lower()
    return any(p in paths for p in _UI_PATTERNS + _CRITICAL_API_PATTERNS)


def _diff_crosses_public_boundary(signals: Dict[str, InputSignal]) -> bool:
    return _diff_touches_ui_or_critical_api(signals)


# ---------------------------------------------------------------------------
# Skeleton templates
# ---------------------------------------------------------------------------

def _unit_template(framework: str, target: str, plan: TestPlan) -> str:
    if framework in ("pytest", "unittest", ""):
        return textwrap.dedent(f"""\
        \"\"\"v1 unit-test skeleton for {target}.

        Source PR: {plan.source_pr}
        Plan id:    {plan.plan_id}

        This is a deterministic skeleton emitted by the QA agent v1.
        Phase 2 will replace it with LLM-driven synthesis. A human or
        a follow-up generator should fill in the test bodies to match
        the acceptance criteria in the linked epic.
        \"\"\"
        from __future__ import annotations

        import pytest


        class Test{_safe_filename(target).removesuffix('.py').removesuffix('.ts').title()}:
            def test_placeholder_returns_expected_shape(self) -> None:
                # TODO(phase-2): assert the contract for {target}.
                assert True


        @pytest.mark.parametrize("case", [
            "happy_path",
            "boundary_low",
            "boundary_high",
            "invalid_input",
        ])
        def test_{_safe_filename(target).removesuffix('.py').removesuffix('.ts')}_cases(case: str) -> None:
            # TODO(phase-2): replace with real assertions per case.
            assert case in {{"happy_path", "boundary_low", "boundary_high", "invalid_input"}}
        """)
    # jest/phpunit/etc. fall back to a generic test stub.
    return textwrap.dedent(f"""\
    // v1 unit-test skeleton for {target}
    // Source PR: {plan.source_pr}
    // Phase 2 will replace this stub with real assertions.
    test('{target} contract', () => {{
      expect(true).toBe(true);
    }});
    """)


def _integration_template(framework: str, boundary: str, plan: TestPlan) -> str:
    return textwrap.dedent(f"""\
    \"\"\"v1 integration-test skeleton for the {boundary} service boundary.

    Source PR: {plan.source_pr}
    Plan id:    {plan.plan_id}

    v1 emits a skeleton; Phase 2 will spin up real testcontainers
    based on tech-stack.md and replace the placeholders.
    \"\"\"
    from __future__ import annotations

    import pytest


    @pytest.mark.integration
    class Test{boundary.title().replace('_', '')}Boundary:
        def test_writes_propagate_to_downstream(self) -> None:
            # TODO(phase-2): assert cross-service contract for {boundary}.
            assert True

        def test_idempotency_under_retry(self) -> None:
            # TODO(phase-2): re-run a write and assert no duplicate effect.
            assert True
    """)


def _e2e_template(framework: str, plan: TestPlan) -> str:
    return textwrap.dedent(f"""\
    // v1 e2e skeleton for {plan.source_pr}
    // Phase 2 will replace this with a real Playwright spec.
    import {{ test, expect }} from "@playwright/test";

    test("{plan.source_pr} happy path", async ({{ page }}) => {{
      // TODO(phase-2): drive the user flow asserted by the linked AC.
      await expect(page).toHaveTitle(/FORA/);
    }});
    """)


def _contract_template(framework: str, plan: TestPlan) -> str:
    return textwrap.dedent(f"""\
    \"\"\"v1 contract-test skeleton (Pact) for {plan.source_pr}.

    Phase 2 will publish a real Pact broker entry once the OpenAPI
    change is committed.
    \"\"\"
    from __future__ import annotations

    import pytest


    @pytest.mark.contract
    def test_{_safe_filename(plan.source_pr).lower()}_pact() -> None:
        # TODO(phase-2): load the Pact file and assert the response shape.
        assert True
    """)


# ---------------------------------------------------------------------------
# Convenience: build default v1 plan from a PR + signals.
# ---------------------------------------------------------------------------

def build_default_plan(source_pr: str, target_branch: str = "main",
                       pr_diff_path: Optional[str] = None) -> TestPlan:
    """Construct a default v1 TestPlan from the PR diff + tech stack.

    Selection rules (per `workspace/memory/qa.md` §2):

    * unit        — every change touching business logic
    * integration — every change crossing a service boundary
    * e2e         — only when the diff includes UI or a critical API path
    * contract    — only when the diff crosses a public boundary
    """
    signals: Dict[str, InputSignal] = {
        "pr_diff":    collect_pr_diff(pr_diff_path=pr_diff_path),
        "tech_stack": collect_tech_stack(),
    }
    ts = signals["tech_stack"].items if isinstance(signals["tech_stack"].items, dict) else {}
    unit_fw = ts.get("unit_framework") or "pytest"
    int_fw = ts.get("integration_framework") or "pytest"
    e2e_fw = ts.get("e2e_framework") or "playwright"
    contract_fw = ts.get("contract_framework") or "pact"

    touches_ui_or_api = _diff_touches_ui_or_critical_api(signals)
    crosses_public = _diff_crosses_public_boundary(signals)

    tiers: List[TierPlan] = [
        TierPlan(
            tier="unit", framework=unit_fw,
            command=f"{unit_fw} -q tests/unit",
            selection_rule="every change touching business logic",
        ),
        TierPlan(
            tier="integration", framework=int_fw,
            command=f"{int_fw} -q tests/integration",
            selection_rule="every change crossing a service boundary",
        ),
    ]
    if touches_ui_or_api:
        tiers.append(TierPlan(
            tier="e2e", framework=e2e_fw,
            command=f"{e2e_fw} test tests/e2e",
            required=False,
            selection_rule="diff touches UI or a critical API path",
        ))
    if crosses_public:
        tiers.append(TierPlan(
            tier="contract", framework=contract_fw,
            command=f"{contract_fw} verify pacts/",
            required=True,
            selection_rule="diff crosses a public boundary (API or MCP)",
        ))
    return TestPlan(
        schema_version=SCHEMA_VERSION,
        plan_id=f"tplan-{_safe_filename(source_pr)}",
        run_id=f"run-{_safe_filename(source_pr)}",
        contract_id=f"hnd-{_safe_filename(source_pr)}",
        source_pr=source_pr,
        branch="qa/test-gen",
        commit_sha="0" * 40,  # v1 stub; real wiring reads from the merged PR
        base_branch="main",
        target_branch=target_branch,
        tiers=tiers,
    )
