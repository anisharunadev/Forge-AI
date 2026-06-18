"""
Tenant gate tests (FORA-75, 0.6).

Verifies the gate admits runs when the tenant is in `OK` or
`SOFT_BREACH` state, denies them when in `HARD_BREACH` and the
alert log shows a pause, and admits again after an admin resume.
"""

from __future__ import annotations

import os
import sys

from .common import run

from agents.audit import InMemoryStore, emit_tool_call
from agents.cost import (
    AlertLog, BudgetPolicy, CeilingMeter, CeilingState, CostLedger,
    GateDecision, TenantGate, TenantPolicyStore,
)


def _make_meter(tenant_id: str, *, policy: BudgetPolicy) -> tuple:
    """Helper: build a meter with one tenant's events.  Returns
    (meter, alerts, gate)."""
    store = InMemoryStore()
    alerts = AlertLog()
    ledger = CostLedger(store)
    policy_store = TenantPolicyStore(defaults=policy)
    meter = CeilingMeter(policy_store=policy_store, ledger=ledger, alerts=alerts)
    gate = TenantGate(meter, alerts)
    return store, meter, alerts, gate


def _scenario_admits_below_soft() -> tuple[dict, list[str]]:
    policy = BudgetPolicy(monthly_ceiling_cents=10_000,
                          soft_threshold_fraction=0.50,
                          per_run_budget_cents=100)
    store, meter, alerts, gate = _make_meter("acme", policy=policy)
    # 2 events of 10 cents = 20 cents
    for i in range(2):
        emit_tool_call(
            store, run_id="r1", agent_id="a", tenant_id="acme",
            stage="dev", tool="t", arguments={"i": i}, output={},
            cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    v = gate.check("acme")
    failures: list[str] = []
    if v.decision != GateDecision.ADMIT:
        failures.append(f"decision={v.decision.value}, expected admit")
    if v.state != CeilingState.OK:
        failures.append(f"state={v.state.value}, expected ok")
    return {"decision": v.decision.value, "state": v.state.value,
            "reason": v.reason}, failures


def _scenario_admits_at_soft_breach() -> tuple[dict, list[str]]:
    policy = BudgetPolicy(monthly_ceiling_cents=1_000,
                          soft_threshold_fraction=0.50,
                          per_run_budget_cents=100)
    store, meter, alerts, gate = _make_meter("acme", policy=policy)
    # 60 events of 10 cents = 600 cents -> soft at 500 cents
    for i in range(60):
        emit_tool_call(
            store, run_id="r1", agent_id="a", tenant_id="acme",
            stage="dev", tool="t", arguments={"i": i}, output={},
            cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    v = gate.check("acme")
    failures: list[str] = []
    if v.decision != GateDecision.ADMIT:
        failures.append(f"soft_breach: decision={v.decision.value}, expected admit")
    if v.state != CeilingState.SOFT_BREACH:
        failures.append(f"state={v.state.value}, expected soft_breach")
    return {"decision": v.decision.value, "state": v.state.value}, failures


def _scenario_denies_after_hard_breach_and_pause() -> tuple[dict, list[str]]:
    policy = BudgetPolicy(monthly_ceiling_cents=1_000,
                          soft_threshold_fraction=0.50,
                          per_run_budget_cents=100)
    store, meter, alerts, gate = _make_meter("acme", policy=policy)
    # 200 events of 10 cents = 2000 cents (well over 1000 ceiling)
    for i in range(200):
        emit_tool_call(
            store, run_id="r1", agent_id="a", tenant_id="acme",
            stage="dev", tool="t", arguments={"i": i}, output={},
            cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    # First recompute -> hard + pause
    meter.recompute("acme")
    v = gate.check("acme")
    failures: list[str] = []
    if v.decision != GateDecision.DENY:
        failures.append(f"hard_breach: decision={v.decision.value}, expected deny")
    if v.state != CeilingState.HARD_BREACH:
        failures.append(f"state={v.state.value}, expected hard_breach")
    if v.reason != "monthly_ceiling_breach":
        failures.append(f"reason={v.reason!r}, expected monthly_ceiling_breach")
    return {"decision": v.decision.value, "state": v.state.value,
            "reason": v.reason}, failures


def _scenario_admits_again_after_resume() -> tuple[dict, list[str]]:
    policy = BudgetPolicy(monthly_ceiling_cents=1_000,
                          soft_threshold_fraction=0.50,
                          per_run_budget_cents=100)
    store, meter, alerts, gate = _make_meter("acme", policy=policy)
    for i in range(200):
        emit_tool_call(
            store, run_id="r1", agent_id="a", tenant_id="acme",
            stage="dev", tool="t", arguments={"i": i}, output={},
            cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    meter.recompute("acme")
    v1 = gate.check("acme")
    assert v1.decision == GateDecision.DENY
    meter.resume("acme", reason="admin")
    v2 = gate.check("acme")
    failures: list[str] = []
    if v2.decision != GateDecision.ADMIT:
        failures.append(f"post-resume: decision={v2.decision.value}, expected admit")
    return {"postResume": v2.decision.value}, failures


def _scenario_unrelated_tenant_not_paused() -> tuple[dict, list[str]]:
    policy = BudgetPolicy(monthly_ceiling_cents=1_000,
                          soft_threshold_fraction=0.50,
                          per_run_budget_cents=100)
    store, meter, alerts, gate = _make_meter("acme", policy=policy)
    for i in range(200):
        emit_tool_call(
            store, run_id="r1", agent_id="a", tenant_id="acme",
            stage="dev", tool="t", arguments={"i": i}, output={},
            cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    meter.recompute("acme")
    # globex has no events
    v = gate.check("globex")
    failures: list[str] = []
    if v.decision != GateDecision.ADMIT:
        failures.append(f"unrelated tenant: decision={v.decision.value}, expected admit")
    return {"globexDecision": v.decision.value, "globexSpend": v.spend_cents}, failures


def main() -> int:
    return run([
        ("admits_below_soft", _scenario_admits_below_soft),
        ("admits_at_soft_breach", _scenario_admits_at_soft_breach),
        ("denies_after_hard_breach_and_pause", _scenario_denies_after_hard_breach_and_pause),
        ("admits_again_after_resume", _scenario_admits_again_after_resume),
        ("unrelated_tenant_not_paused", _scenario_unrelated_tenant_not_paused),
    ], test_name="test_gate")


if __name__ == "__main__":
    sys.exit(main())
