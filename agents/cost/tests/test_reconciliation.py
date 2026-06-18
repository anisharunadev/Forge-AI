"""
Reconciliation test (FORA-75, 0.6 acceptance line 3).

The cost ledger reconciles to the audit ledger to the cent on a
random-day audit.  Concretely:

* `CostLedger.total_cents(tenant_id)` is the sum of every
  `cost_cents` field on every `audit.events` row for the tenant.
* The per-month roll-ups summed across months must equal
  `total_cents`.
* The per-run roll-ups summed across runs must equal the per-month
  roll-up for the same month.
* The per-tool roll-ups summed across tools must equal the per-run
  roll-up for the same run.
"""

from __future__ import annotations

import datetime as dt
import os
import random
import sys

from .common import populate_tenant_runs, run

from agents.audit import InMemoryStore, emit_tool_call
from agents.cost import CostLedger


def _scenario_random_day_audit() -> tuple[dict, list[str]]:
    """Run a random cost profile for 30 days across two tenants,
    then assert the total reconciles."""
    store = InMemoryStore()
    rng = random.Random(20260617)
    n_events = 0
    for day in range(30):
        # Spread events across 3 tenants and 20 runs, varying cost.
        for _ in range(50):
            tenant = rng.choice(["acme", "globex", "initech"])
            cents = rng.randint(1, 100)
            emit_tool_call(
                store,
                run_id=f"run-{rng.randint(0, 19)}",
                agent_id=f"agent-{rng.randint(0, 4)}",
                tenant_id=tenant,
                stage=rng.choice(["ideation", "architect", "dev", "qa"]),
                tool=rng.choice(["llm.invoke", "jira.createIssue",
                                 "github.createPr", "noop"]),
                arguments={"i": n_events},
                output={"ok": True},
                cost_cents=cents,
                prompt_tokens=rng.randint(1, 100),
                completion_tokens=rng.randint(1, 50),
                wall_ms=float(rng.randint(1, 100)),
            )
            n_events += 1

    ledger = CostLedger(store)
    failures: list[str] = []

    # 1. total_cents per tenant == sum of event cost_cents
    for tenant in ("acme", "globex", "initech"):
        events_cents = sum(
            int(ev.cost_cents or 0) for ev in store.all()
            if ev.tenant_id == tenant
        )
        ledger_cents = ledger.total_cents(tenant)
        if events_cents != ledger_cents:
            failures.append(
                f"{tenant}: events={events_cents} vs ledger={ledger_cents}"
            )

    # 2. per-month sum == total
    for tenant in ("acme", "globex", "initech"):
        months = ledger.list_month_costs(tenant)
        months_total = sum(m.total_cost_cents for m in months)
        if months_total != ledger.total_cents(tenant):
            failures.append(
                f"{tenant}: month-sum={months_total} vs total={ledger.total_cents(tenant)}"
            )

    # 3. per-run sum (within current month) == per-month total
    cs_acme = ledger.current_month_cost("acme")
    per_run = sum(rc.cost_cents for rc in cs_acme.by_run.values())
    if per_run != cs_acme.total_cost_cents:
        failures.append(
            f"acme per-run sum={per_run} vs month total={cs_acme.total_cost_cents}"
        )

    # 4. per-tool sum == per-month total
    per_tool = sum(tc.cost_cents for tc in cs_acme.by_tool.values())
    if per_tool != cs_acme.total_cost_cents:
        failures.append(
            f"acme per-tool sum={per_tool} vs month total={cs_acme.total_cost_cents}"
        )

    return {
        "events": n_events,
        "acme": ledger.total_cents("acme"),
        "globex": ledger.total_cents("globex"),
        "initech": ledger.total_cents("initech"),
    }, failures


def _scenario_per_run_reconciles_to_per_tool() -> tuple[dict, list[str]]:
    """A run's per-tool breakdown sums to the run total."""
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=5, cost_per_event=10)
    ledger = CostLedger(store)
    failures: list[str] = []
    for run_id, run_cost in ledger.current_month_cost("acme").by_run.items():
        tool_sum = sum(t.cost_cents for t in run_cost.by_tool.values())
        if tool_sum != run_cost.cost_cents:
            failures.append(
                f"{run_id}: tool-sum={tool_sum} vs run={run_cost.cost_cents}"
            )
    return {"runsChecked": len(ledger.current_month_cost("acme").by_run)}, failures


def _scenario_no_parallel_write_path() -> tuple[dict, list[str]]:
    """The ledger never inserts into the audit store.  Count events
    before and after every operation; deltas must be 0."""
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=3, cost_per_event=10)
    before = len(store.all())
    ledger = CostLedger(store)
    ledger.run_cost("acme", "run-acme-000")
    ledger.current_month_cost("acme")
    ledger.list_month_costs("acme")
    ledger.list_tenant_costs()
    ledger.total_cents("acme")
    after = len(store.all())
    failures: list[str] = []
    if before != after:
        failures.append(f"events changed: {before} -> {after}")
    return {"before": before, "after": after}, failures


def main() -> int:
    return run([
        ("random_day_audit", _scenario_random_day_audit),
        ("per_run_reconciles_to_per_tool", _scenario_per_run_reconciles_to_per_tool),
        ("no_parallel_write_path", _scenario_no_parallel_write_path),
    ], test_name="test_reconciliation")


if __name__ == "__main__":
    sys.exit(main())
