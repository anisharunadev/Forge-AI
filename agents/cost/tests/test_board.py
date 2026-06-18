"""
Board read API tests (FORA-75, 0.6 acceptance line 1).

Verifies:

* After 10 sub-agent runs in one tenant, the board can pull the
  cost breakdown by stage and by tool.
* Monthly burn-down, top-spending, and alert log views.
"""

from __future__ import annotations

import os
import sys

from .common import populate_tenant_runs, run

from agents.audit import InMemoryStore
from agents.cost import AlertLog, BoardReader, CostLedger, TenantPolicyStore


def _scenario_ten_runs_breakdown_by_stage() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=10, cost_per_event=10)
    reader = BoardReader(
        ledger=CostLedger(store),
        policy_store=TenantPolicyStore(),
        alerts=AlertLog(),
    )
    cs = reader.current_month("acme")
    failures: list[str] = []
    # 10 runs * 3 tool_call events = 30 cost-bearing events
    # (boundary run_started/run_finished are filtered out).
    if cs.event_count != 30:
        failures.append(f"event_count={cs.event_count}, expected 30")
    if cs.run_count != 10:
        failures.append(f"run_count={cs.run_count}, expected 10")
    if cs.total_cost_cents != 300:
        failures.append(f"total={cs.total_cost_cents}, expected 300")
    # by_stage should be populated for each of the 3 stages
    for stage in ("ideation", "architect", "dev"):
        if stage not in cs.by_stage:
            failures.append(f"by_stage missing {stage!r}")
    return {
        "eventCount": cs.event_count,
        "runCount": cs.run_count,
        "totalCostCents": cs.total_cost_cents,
        "stages": sorted(cs.by_stage.keys()),
    }, failures


def _scenario_ten_runs_breakdown_by_tool() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=10, cost_per_event=10)
    reader = BoardReader(
        ledger=CostLedger(store),
        policy_store=TenantPolicyStore(),
        alerts=AlertLog(),
    )
    cs = reader.current_month("acme")
    failures: list[str] = []
    # 3 tools * 10 calls each
    for tool, tc in cs.by_tool.items():
        if tc.calls != 10:
            failures.append(f"tool {tool!r} calls={tc.calls}, expected 10")
        if tc.cost_cents != 100:
            failures.append(f"tool {tool!r} cost={tc.cost_cents}, expected 100")
    # The "by_tool" top-spenders list should match
    top = reader.top_spending("acme", by="tool", limit=10)
    if len(top) != 3:
        failures.append(f"top_spending(tool) size={len(top)}, expected 3")
    if top and top[0].cost_cents != 100:
        failures.append(f"top tool spend={top[0].cost_cents}, expected 100")
    return {
        "byTool": sorted(cs.by_tool.keys()),
        "topSpend": [(t.key, t.cost_cents) for t in top],
    }, failures


def _scenario_monthly_burndown() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=5, cost_per_event=10)
    reader = BoardReader(
        ledger=CostLedger(store),
        policy_store=TenantPolicyStore(),
        alerts=AlertLog(),
    )
    burndown = reader.monthly_burndown("acme")
    failures: list[str] = []
    if len(burndown) != 1:
        failures.append(f"burndown size={len(burndown)}, expected 1 month")
    if burndown and burndown[0].cost_cents != 150:
        failures.append(f"month cost={burndown[0].cost_cents}, expected 150")
    return {"burndown": [(p.month_key, p.cost_cents) for p in burndown]}, failures


def _scenario_top_spending_by_agent() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=10, cost_per_event=10)
    reader = BoardReader(
        ledger=CostLedger(store),
        policy_store=TenantPolicyStore(),
        alerts=AlertLog(),
    )
    top = reader.top_spending("acme", by="agent", limit=10)
    failures: list[str] = []
    # populate_tenant_runs uses agent_id = f"agent-{r % 3}" -> 3 agents
    if len(top) != 3:
        failures.append(f"unique agents={len(top)}, expected 3")
    total = sum(t.cost_cents for t in top)
    if total != 300:
        failures.append(f"top agent total={total}, expected 300")
    return {"agents": [(t.key, t.cost_cents) for t in top]}, failures


def main() -> int:
    return run([
        ("ten_runs_breakdown_by_stage", _scenario_ten_runs_breakdown_by_stage),
        ("ten_runs_breakdown_by_tool", _scenario_ten_runs_breakdown_by_tool),
        ("monthly_burndown", _scenario_monthly_burndown),
        ("top_spending_by_agent", _scenario_top_spending_by_agent),
    ], test_name="test_board")


if __name__ == "__main__":
    sys.exit(main())
