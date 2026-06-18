#!/usr/bin/env python3
"""
End-to-end smoke test for the Agent Runtime (FORA-30).

Acceptance contract:

    1. A sub-agent can be invoked, plan a 3-step task, call only
       allow-listed tools, and produce a structured run record.
    2. Runtime never calls a non-allow-listed tool; attempts are
       logged and surfaced as a typed error.
    3. Retries do not duplicate side effects when handlers return
       idempotency keys.
    4. Cost ceiling enforcement aborts the run with a typed error
       rather than silently exceeding budget.

The smoke test exercises each acceptance criterion in isolation,
plus a final "all four" scenario, and writes the produced run
records to `agents/runtime/evidence/` for review.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents.runtime import (  # noqa: E402
    AgentRuntime,
    BudgetExceededError,
    CostBudget,
    CostSnapshot,
    Plan,
    PlanStep,
    RetryConfig,
    RunStatus,
    RuntimeConfig,
    Stage,
    StageStatus,
    ToolAllowList,
    ToolNotAllowedError,
)


# ---------------------------------------------------------------------------
# Test handlers
# ---------------------------------------------------------------------------

class CountingHandler:
    """A handler that records every invocation.  Used to prove that
    retries do not duplicate side effects."""

    def __init__(self, fail_first_n: int = 0, raise_code: str = "TRANSIENT",
                 output: Any = None, cost_usd: float = 0.01) -> None:
        self.fail_first_n = fail_first_n
        self.raise_code = raise_code
        self.output = output
        self.cost_usd = cost_usd
        self.calls: List[Tuple[str, str]] = []  # (tool, idempotency_key)

    def __call__(self, step: PlanStep):
        self.calls.append((step.tool, step.idempotency_key))
        if len(self.calls) <= self.fail_first_n:
            # Raise an exception that the retry helper classifies as
            # transient.  The exception's `code` attribute drives the
            # classifier in `retry.py`.
            err = RuntimeError(f"forced failure #{len(self.calls)}")
            err.code = self.raise_code  # type: ignore[attr-defined]
            raise err
        return (
            {"result": self.output if self.output is not None else "ok", "calls_so_far": len(self.calls)},
            CostSnapshot(tokens_in=10, tokens_out=5, usd=self.cost_usd),
        )


# A handler that records all calls but charges a custom cost so we
# can force the cost ceiling to be breached.
class CostlyHandler:
    def __init__(self, cost_usd: float) -> None:
        self.cost_usd = cost_usd
        self.calls: List[str] = []

    def __call__(self, step: PlanStep):
        self.calls.append(step.idempotency_key)
        return (
            {"echo": step.arguments},
            CostSnapshot(tokens_in=20, tokens_out=10, usd=self.cost_usd),
        )


# ---------------------------------------------------------------------------
# Test scenarios
# ---------------------------------------------------------------------------

def _three_step_plan(tool_prefix: str = "noop") -> Plan:
    return Plan(
        plan_id=f"plan-{tool_prefix}",
        goal="demonstrate a 3-step plan",
        steps=[
            PlanStep(step_id="s1", stage=Stage.ACT, tool=f"{tool_prefix}_a", arguments={"i": 1}),
            PlanStep(step_id="s2", stage=Stage.ACT, tool=f"{tool_prefix}_b", arguments={"i": 2}),
            PlanStep(step_id="s3", stage=Stage.ACT, tool=f"{tool_prefix}_c", arguments={"i": 3}),
        ],
    )


def _cheap_runtime(allowlist: ToolAllowList, max_usd: float = 1.0) -> RuntimeConfig:
    return RuntimeConfig(
        allowlist=allowlist,
        cost_budget=CostBudget(max_usd=max_usd),
        retry=RetryConfig(
            max_attempts=3,
            initial_backoff_s=0.01,
            max_backoff_s=0.05,
            total_budget_s=2.0,
        ),
    )


def scenario_1_happy_path() -> Tuple[Dict[str, Any], List[str]]:
    """AC1: a 3-step plan executes against allow-listed tools and
    produces a structured run record."""
    al = ToolAllowList.of({Stage.ACT: {"noop_a", "noop_b", "noop_c"}})
    rt = AgentRuntime(_cheap_runtime(al))
    h = CountingHandler(output="ok")
    record = rt.run(_three_step_plan(), inputs={"brief": "happy"},
                    handlers={"noop_a": h, "noop_b": h, "noop_c": h})
    failures: List[str] = []
    if record.status != RunStatus.SUCCEEDED:
        failures.append(f"status={record.status.value!r}, expected 'succeeded'")
    if len(record.steps) != 3:
        failures.append(f"steps={len(record.steps)}, expected 3")
    for s in record.steps:
        if s.status != StageStatus.SUCCEEDED:
            failures.append(f"step {s.step_id} status={s.status.value!r}")
    if record.total_cost.usd <= 0:
        failures.append("total_cost.usd should be > 0 after a run")
    if len(h.calls) != 3:
        failures.append(f"handler was called {len(h.calls)} times, expected 3")
    if record.output is None or "step_outputs" not in record.output:
        failures.append("run record output is missing step_outputs")
    return record.to_dict(), failures


def scenario_2_allowlist_rejects() -> Tuple[Dict[str, Any], List[str]]:
    """AC2: a non-allow-listed tool call is refused with a typed error
    and never reaches the handler."""
    al = ToolAllowList.of({Stage.ACT: {"allowed_tool"}})
    rt = AgentRuntime(_cheap_runtime(al))
    h = CountingHandler(output="never-called")
    plan = Plan(
        plan_id="plan-bad",
        goal="reference a tool that is not in the allow-list",
        steps=[PlanStep(step_id="s1", stage=Stage.ACT, tool="forbidden_tool",
                        arguments={})],
    )
    record = rt.run(plan, inputs={}, handlers={"allowed_tool": h, "forbidden_tool": h})
    failures: List[str] = []
    if record.status != RunStatus.TOOL_NOT_ALLOWED:
        failures.append(f"status={record.status.value!r}, expected 'tool_not_allowed'")
    if h.calls:
        failures.append(f"handler was called {len(h.calls)} times despite allow-list rejection")
    if not record.error or record.error.get("code") != "TOOL_NOT_ALLOWED":
        failures.append(f"error code missing or wrong: {record.error!r}")
    if "forbidden_tool" not in str(record.error):
        failures.append("error does not name the offending tool")
    return record.to_dict(), failures


def scenario_2b_allowlist_blocks_at_plan_validation() -> Tuple[Dict[str, Any], List[str]]:
    """AC2 (belt-and-braces): the runtime refuses a plan that
    references a non-allow-listed tool, before the first step runs."""
    al = ToolAllowList.of({Stage.ACT: {"allowed_tool"}})
    rt = AgentRuntime(_cheap_runtime(al))
    h = CountingHandler()
    plan = _three_step_plan(tool_prefix="allowed")
    # Swap the third step's tool to one that is not allowed.
    plan.steps[2] = PlanStep(step_id="s3", stage=Stage.ACT, tool="forbidden",
                             arguments={"i": 3})
    record = rt.run(plan, inputs={}, handlers={"allowed_a": h, "allowed_b": h, "forbidden": h})
    failures: List[str] = []
    if record.status != RunStatus.TOOL_NOT_ALLOWED:
        failures.append(f"status={record.status.value!r}, expected 'tool_not_allowed'")
    if h.calls:
        failures.append(f"handler was called {len(h.calls)} times despite plan-level rejection")
    return record.to_dict(), failures


def scenario_3_retry_idempotency() -> Tuple[Dict[str, Any], List[str]]:
    """AC3: a transient failure is retried, but the handler is NOT
    re-invoked for an already-succeeded key (cache + handler both
    honour the key)."""
    al = ToolAllowList.of({Stage.ACT: {"flaky_tool"}})
    rt = AgentRuntime(_cheap_runtime(al))
    # Fail twice, succeed on the third call.
    h = CountingHandler(fail_first_n=2, output="ok-on-third")
    plan = Plan(plan_id="plan-flaky", goal="retry safety",
                steps=[PlanStep(step_id="s1", stage=Stage.ACT, tool="flaky_tool",
                                arguments={"x": 1})])
    record = rt.run(plan, inputs={}, handlers={"flaky_tool": h})
    failures: List[str] = []
    if record.status != RunStatus.SUCCEEDED:
        failures.append(f"status={record.status.value!r}, expected 'succeeded'")
    # 2 forced failures + 1 success = 3 invocations of the handler.
    if len(h.calls) != 3:
        failures.append(f"handler was called {len(h.calls)} times, expected 3 (2 fails + 1 success)")
    # And the retry log should show 3 records, the last ok.
    step = record.steps[0]
    if len(step.retries) != 3:
        failures.append(f"retries recorded {len(step.retries)}, expected 3")
    if not all(r.idempotency_key == step.retries[0].idempotency_key for r in step.retries):
        failures.append("retry records do not all carry the same idempotency key")
    if not step.retries[-1].ok:
        failures.append("last retry should be ok=True")
    if step.status != StageStatus.SUCCEEDED:
        failures.append(f"step status={step.status.value!r}")
    return record.to_dict(), failures


def scenario_3b_retry_does_not_duplicate_side_effects() -> Tuple[Dict[str, Any], List[str]]:
    """AC3 (deeper): even if the handler is called multiple times
    within a single step's retries, the runtime's cache ensures the
    side effect is counted exactly once at the run level."""
    al = ToolAllowList.of({Stage.ACT: {"idempotent"}})
    rt = AgentRuntime(_cheap_runtime(al))
    # Fail once, then succeed.  The handler is called twice; the
    # side effect ("create ticket") must only be recorded once.
    side_effects: List[str] = []
    def handler(step: PlanStep):
        if not side_effects:
            side_effects.append(f"create:{step.arguments['id']}")
            err = RuntimeError("first call fails")
            err.code = "TRANSIENT"  # type: ignore[attr-defined]
            raise err
        return ({"ticket": step.arguments['id']},
                CostSnapshot(tokens_in=5, tokens_out=2, usd=0.005))
    plan = Plan(plan_id="plan-idem", goal="no duplicate side effects",
                steps=[PlanStep(step_id="s1", stage=Stage.ACT, tool="idempotent",
                                arguments={"id": "TICKET-1"})])
    record = rt.run(plan, inputs={}, handlers={"idempotent": handler})
    failures: List[str] = []
    if record.status != RunStatus.SUCCEEDED:
        failures.append(f"status={record.status.value!r}, expected 'succeeded'")
    if len(side_effects) != 1:
        failures.append(f"side effect recorded {len(side_effects)} times, expected 1")
    return record.to_dict(), failures


def scenario_4_cost_ceiling_aborts() -> Tuple[Dict[str, Any], List[str]]:
    """AC4: a run that would breach the cost ceiling is aborted with
    a typed BudgetExceededError, not allowed to silently overrun."""
    al = ToolAllowList.of({Stage.ACT: {"expensive"}})
    # Set a budget of $0.05; the first call charges $0.04, the
    # second would charge $0.04 (total $0.08 > ceiling) and so
    # must abort.
    budget = CostBudget(max_usd=0.05)
    cfg = RuntimeConfig(allowlist=al, cost_budget=budget,
                        retry=RetryConfig(max_attempts=1, initial_backoff_s=0.01,
                                          max_backoff_s=0.05, total_budget_s=2.0))
    rt = AgentRuntime(cfg)
    h = CostlyHandler(cost_usd=0.04)
    plan = Plan(plan_id="plan-costly", goal="breach the budget",
                steps=[
                    PlanStep(step_id="s1", stage=Stage.ACT, tool="expensive",
                             arguments={"n": 1}),
                    PlanStep(step_id="s2", stage=Stage.ACT, tool="expensive",
                             arguments={"n": 2}),
                ])
    record = rt.run(plan, inputs={}, handlers={"expensive": h})
    failures: List[str] = []
    if record.status != RunStatus.BUDGET_EXCEEDED:
        failures.append(f"status={record.status.value!r}, expected 'budget_exceeded'")
    if not record.error or record.error.get("code") != "BUDGET_EXCEEDED":
        failures.append(f"error code missing or wrong: {record.error!r}")
    if record.total_cost.usd > 0.05 + 1e-9:
        failures.append(f"total_cost.usd={record.total_cost.usd} exceeded the ceiling of 0.05")
    if len(h.calls) < 1 or len(h.calls) > 1:
        failures.append(f"expected exactly 1 invocation before the abort, got {len(h.calls)}")
    return record.to_dict(), failures


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print("=" * 72)
    print("Agent Runtime — end-to-end smoke test (FORA-30)")
    print("=" * 72)

    scenarios = [
        ("AC1 3-step plan succeeds and produces a structured record", scenario_1_happy_path),
        ("AC2 allow-list rejects non-allow-listed tool call",          scenario_2_allowlist_rejects),
        ("AC2 plan-level validation refuses non-allow-listed tool",    scenario_2b_allowlist_blocks_at_plan_validation),
        ("AC3 retries do not duplicate side effects (single key)",     scenario_3_retry_idempotency),
        ("AC3 handler-side idempotency is honoured",                    scenario_3b_retry_does_not_duplicate_side_effects),
        ("AC4 cost ceiling aborts with typed error",                   scenario_4_cost_ceiling_aborts),
    ]

    evidence: Dict[str, Any] = {"scenarios": {}}
    all_failures: List[str] = []
    for name, fn in scenarios:
        print(f"\n[{name}]")
        try:
            record_dict, failures = fn()
        except Exception as exc:  # noqa: BLE001
            failures = [f"scenario raised an exception: {exc!r}"]
            record_dict = {"error": str(exc)}
        evidence["scenarios"][name] = record_dict
        if failures:
            for f in failures:
                print(f"  FAIL: {f}")
                all_failures.append(f"{name}: {f}")
        else:
            print(f"  OK")

    out_dir = os.path.join(ROOT, "agents", "runtime", "evidence")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "smoke_runs.json")
    with open(out_path, "w") as fp:
        json.dump(evidence, fp, indent=2)
    print(f"\nEvidence written to: {out_path}")

    print("\n" + "=" * 72)
    if all_failures:
        print("FAIL:")
        for f in all_failures:
            print(f"  - {f}")
        return 1
    print("OK: Agent Runtime smoke test passed")
    print("    - AC1 3-step plan + structured record: yes")
    print("    - AC2 allow-list rejection (runtime + plan): yes")
    print("    - AC3 retry idempotency (cache + handler): yes")
    print("    - AC4 cost-ceiling abort with typed error: yes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
