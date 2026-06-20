"""
Ceiling meter tests (FORA-75, 0.6).

Verifies the soft/hard threshold detection, the idempotency of the
fired alerts, and the state machine transitions.
"""

from __future__ import annotations

import datetime as dt
import os
import sys

from .common import populate_tenant_runs, run

from agents.audit import InMemoryStore
from agents.cost import (
    AlertKind, AlertLog, CeilingMeter, CeilingState, CostLedger,
    TenantPolicyStore, BudgetPolicy,
)


def _scenario_ok_below_soft() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=1, cost_per_event=10)
    ledger = CostLedger(store)
    policy_store = TenantPolicyStore()
    alerts = AlertLog()
    meter = CeilingMeter(policy_store=policy_store, ledger=ledger, alerts=alerts)
    verdict = meter.recompute("acme")
    failures: list[str] = []
    if verdict.state != CeilingState.OK:
        failures.append(f"state={verdict.state.value}, expected ok")
    if verdict.alerts:
        failures.append(f"alerts fired: {[a.kind.value for a in verdict.alerts]}")
    return {"state": verdict.state.value, "spendCents": verdict.spend_cents,
            "alerts": [a.to_dict() for a in verdict.alerts]}, failures


def _scenario_soft_breach_fires_alert() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    # Use a small policy so the soft threshold is reachable.
    # populate_tenant_runs(runs=1, cost_per_event=10) -> 3 tool calls = 30 cents.
    # We push 14 more 10-cent events -> 17 events * 10 = 170 cents of
    # cost-bearing events.  Soft at 150 cents of a 300-cent ceiling.
    policy = BudgetPolicy(
        monthly_ceiling_cents=300,
        soft_threshold_fraction=0.50,        # 150 cents soft
        per_run_budget_cents=500,
    )
    populate_tenant_runs(store, "acme", runs=1, cost_per_event=10)
    from agents.audit import emit_tool_call
    for i in range(14):
        emit_tool_call(
            store, run_id="run-acme-001", agent_id="agent-0",
            tenant_id="acme", stage="dev", tool="noop",
            arguments={"i": 99 + i}, output={"ok": True},
            cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    ledger = CostLedger(store)
    alerts = AlertLog()
    meter = CeilingMeter(
        policy_store=TenantPolicyStore(defaults=policy),
        ledger=ledger, alerts=alerts,
    )
    verdict = meter.recompute("acme")
    failures: list[str] = []
    if verdict.state != CeilingState.SOFT_BREACH:
        failures.append(f"state={verdict.state.value}, expected soft_breach")
    soft = [a for a in verdict.alerts if a.kind == AlertKind.SOFT_THRESHOLD]
    if not soft:
        failures.append("no soft_threshold alert fired")
    return {"state": verdict.state.value, "spendCents": verdict.spend_cents,
            "alerts": [a.to_dict() for a in verdict.alerts]}, failures


def _scenario_hard_breach_pauses_tenant() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=10, cost_per_event=10)
    # 10 runs * 3 tool calls = 30 tool events * 10 cents = 300 cents
    # plus 10 started + 10 finished = 20 boundary events at 0 cents
    # total = 300 cents, well above 20000/100? no, 20000 cents ceiling.
    # Push the spend way over:
    from agents.audit import emit_tool_call
    # Add 200 more events of 100 cents each = 20000 cents
    for i in range(200):
        emit_tool_call(
            store, run_id="run-acme-000", agent_id="agent-0",
            tenant_id="acme", stage="dev", tool="heavy",
            arguments={"i": i}, output={"ok": True},
            cost_cents=100, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    ledger = CostLedger(store)
    alerts = AlertLog()
    meter = CeilingMeter(
        policy_store=TenantPolicyStore(),
        ledger=ledger, alerts=alerts,
    )
    verdict = meter.recompute("acme")
    failures: list[str] = []
    if verdict.state != CeilingState.HARD_BREACH:
        failures.append(f"state={verdict.state.value}, expected hard_breach")
    hard = [a for a in verdict.alerts if a.kind == AlertKind.HARD_THRESHOLD]
    paused = [a for a in verdict.alerts if a.kind == AlertKind.TENANT_PAUSED]
    if not hard:
        failures.append("no hard_threshold alert fired")
    if not paused:
        failures.append("no tenant_paused alert fired")
    if not alerts.is_paused("acme"):
        failures.append("alerts.is_paused('acme') is False after hard breach")
    return {"state": verdict.state.value,
            "spendCents": verdict.spend_cents,
            "hardCount": len(hard), "pausedCount": len(paused)}, failures


def _scenario_alerts_idempotent_on_month() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    from agents.audit import emit_tool_call
    # 18 events * 100 cents = 1800 cents (soft = 16000/100? no,
    # soft at 80% of 20000 = 16000; let's just make a tenant past
    # the soft threshold and confirm a second recompute does not
    # re-fire the alert.)
    for i in range(20):
        emit_tool_call(
            store, run_id="run-x", agent_id="agent-x",
            tenant_id="t1", stage="dev", tool="t",
            arguments={"i": i}, output={"ok": True},
            cost_cents=100, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    ledger = CostLedger(store)
    alerts = AlertLog()
    meter = CeilingMeter(
        policy_store=TenantPolicyStore(),
        ledger=ledger, alerts=alerts,
    )
    # Use a small policy so 2000 cents triggers soft.
    policy_store = TenantPolicyStore(
        defaults=BudgetPolicy(
            monthly_ceiling_cents=10_000,
            soft_threshold_fraction=0.10,    # 1000 cents soft
            per_run_budget_cents=500,
        )
    )
    meter = CeilingMeter(policy_store=policy_store, ledger=ledger, alerts=alerts)
    v1 = meter.recompute("t1")
    v2 = meter.recompute("t1")
    v3 = meter.recompute("t1")
    failures: list[str] = []
    soft_alerts_logged = [a for a in alerts.for_tenant("t1")
                          if a.kind == AlertKind.SOFT_THRESHOLD]
    if len(soft_alerts_logged) != 1:
        failures.append(f"expected 1 soft alert in log, got {len(soft_alerts_logged)}")
    if len(v1.alerts) != 1:
        failures.append(f"first recompute fired {len(v1.alerts)} alerts, expected 1")
    if v2.alerts:
        failures.append(f"second recompute fired {v2.alerts}, expected none")
    if v3.alerts:
        failures.append(f"third recompute fired {v3.alerts}, expected none")
    return {"softInLog": len(soft_alerts_logged),
            "firstFired": len(v1.alerts),
            "secondFired": len(v2.alerts)}, failures


def _scenario_resume_clears_pause() -> tuple[dict, list[str]]:
    store = InMemoryStore()
    from agents.audit import emit_tool_call
    for i in range(20):
        emit_tool_call(
            store, run_id="run-x", agent_id="agent-x",
            tenant_id="t1", stage="dev", tool="t",
            arguments={"i": i}, output={"ok": True},
            cost_cents=100, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    policy_store = TenantPolicyStore(
        defaults=BudgetPolicy(
            monthly_ceiling_cents=1_000,         # 1000 cents = $10
            soft_threshold_fraction=0.50,
            per_run_budget_cents=100,
        )
    )
    alerts = AlertLog()
    meter = CeilingMeter(policy_store=policy_store,
                         ledger=CostLedger(store), alerts=alerts)
    v = meter.recompute("t1")
    failures: list[str] = []
    if v.state != CeilingState.HARD_BREACH:
        failures.append(f"setup: state={v.state.value}, expected hard_breach")
    if not alerts.is_paused("t1"):
        failures.append("setup: expected pause active")
    rec = meter.resume("t1", reason="admin")
    if alerts.is_paused("t1"):
        failures.append("after resume: pause still active")
    if rec.kind != AlertKind.TENANT_RESUMED:
        failures.append(f"resume returned {rec.kind.value}, expected tenant_resumed")
    return {"resumed": True, "stillPaused": alerts.is_paused("t1")}, failures


def main() -> int:
    return run([
        ("ok_below_soft", _scenario_ok_below_soft),
        ("soft_breach_fires_alert", _scenario_soft_breach_fires_alert),
        ("hard_breach_pauses_tenant", _scenario_hard_breach_pauses_tenant),
        ("alerts_idempotent_on_month", _scenario_alerts_idempotent_on_month),
        ("resume_clears_pause", _scenario_resume_clears_pause),
    ], test_name="test_ceiling")


if __name__ == "__main__":
    sys.exit(main())
