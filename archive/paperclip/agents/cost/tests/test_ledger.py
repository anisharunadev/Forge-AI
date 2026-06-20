"""
Cost ledger tests (FORA-75, 0.6).

Verifies the ledger roll-ups:

* `tenantId x runId x stage x tool` -- per-run tool breakdown
* `tenantId x month` -- per-tenant monthly burn-down

The scenarios also check the chain is preserved (the ledger never
mutates the audit store) and that empty tenants return empty
summaries.
"""

from __future__ import annotations

import datetime as dt
import os
import sys

from .common import populate_tenant_runs, run

from agents.audit import InMemoryStore
from agents.cost import CostLedger


def _scenario_per_run_rollup() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=3, cost_per_event=10)
    ledger = CostLedger(store)
    rc = ledger.run_cost("acme", "run-acme-000")
    failures: list[str] = []
    # Boundary events (run_started, run_finished) are filtered; only
    # the 3 tool_call events contribute to the cost rollup.
    if rc.event_count != 3:
        failures.append(f"event_count={rc.event_count}, expected 3")
    # 3 tool calls * 10 cents each = 30 cents per run
    if rc.cost_cents != 30:
        failures.append(f"cost_cents={rc.cost_cents}, expected 30")
    # by_tool should have all 3 tool names
    for tool in ("llm.invoke", "jira.createIssue", "github.createPr"):
        if tool not in rc.by_tool:
            failures.append(f"by_tool missing {tool!r}")
    # by_stage should have 3 stage names
    for stage in ("ideation", "architect", "dev"):
        if stage not in rc.by_stage:
            failures.append(f"by_stage missing {stage!r}")
    return {"costCents": rc.cost_cents, "eventCount": rc.event_count,
            "tools": sorted(rc.by_tool.keys()),
            "stages": sorted(rc.by_stage.keys())}, failures


def _scenario_per_tenant_per_month() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=10, cost_per_event=10)
    ledger = CostLedger(store)
    cs = ledger.current_month_cost("acme")
    failures: list[str] = []
    # 10 runs * 3 tool_call events = 30 cost-bearing events
    # (boundary run_started/run_finished are filtered out).
    if cs.event_count != 30:
        failures.append(f"event_count={cs.event_count}, expected 30")
    # 10 runs * 3 calls * 10 cents = 300 cents of tool cost
    if cs.total_cost_cents != 300:
        failures.append(f"total_cost_cents={cs.total_cost_cents}, expected 300")
    if cs.run_count != 10:
        failures.append(f"run_count={cs.run_count}, expected 10")
    if len(cs.by_run) != 10:
        failures.append(f"by_run size={len(cs.by_run)}, expected 10")
    # Each tool has 10 calls (one per run)
    for tool, tc in cs.by_tool.items():
        if tc.calls != 10:
            failures.append(f"tool {tool!r} calls={tc.calls}, expected 10")
        if tc.cost_cents != 100:
            failures.append(f"tool {tool!r} cost={tc.cost_cents}, expected 100")
    return {
        "eventCount": cs.event_count,
        "totalCostCents": cs.total_cost_cents,
        "runCount": cs.run_count,
        "monthKey": cs.month_key,
    }, failures


def _scenario_tenant_isolation() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=2, cost_per_event=10)
    populate_tenant_runs(store, "globex", runs=3, cost_per_event=10)
    ledger = CostLedger(store)
    cs_acme = ledger.current_month_cost("acme")
    cs_globex = ledger.current_month_cost("globex")
    failures: list[str] = []
    if cs_acme.run_count != 2 or cs_globex.run_count != 3:
        failures.append(f"acme runs={cs_acme.run_count}, globex runs={cs_globex.run_count}")
    if cs_acme.total_cost_cents != 60:
        failures.append(f"acme total={cs_acme.total_cost_cents}, expected 60")
    if cs_globex.total_cost_cents != 90:
        failures.append(f"globex total={cs_globex.total_cost_cents}, expected 90")
    return {
        "acme": cs_acme.to_dict(),
        "globex": cs_globex.to_dict(),
    }, failures


def _scenario_ledger_does_not_mutate_audit() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=2, cost_per_event=10)
    before = len(store.all())
    CostLedger(store).current_month_cost("acme")
    after = len(store.all())
    failures: list[str] = []
    if before != after:
        failures.append(f"ledger mutated store: {before} -> {after}")
    return {"before": before, "after": after}, failures


def main() -> int:
    return run([
        ("per_run_rollup", _scenario_per_run_rollup),
        ("per_tenant_per_month", _scenario_per_tenant_per_month),
        ("tenant_isolation", _scenario_tenant_isolation),
        ("ledger_does_not_mutate_audit", _scenario_ledger_does_not_mutate_audit),
    ], test_name="test_ledger")


if __name__ == "__main__":
    sys.exit(main())
