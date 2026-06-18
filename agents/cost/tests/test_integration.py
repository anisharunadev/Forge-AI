"""
Runtime budget hint tests (FORA-75, 0.6 acceptance line 4).

Verifies `RuntimeBudgetHint.remaining(tenant_id, run_id)` short-circuits
the runtime before exceeding the cap.  The hint exposes `cents` (the
canonical answer), `usd` (the runtime's `CostSnapshot.usd` view), and
`is_blocked` (the runtime's short-circuit signal).
"""

from __future__ import annotations

import os
import sys

from .common import populate_tenant_runs, run

from agents.audit import InMemoryStore, emit_tool_call
from agents.cost import (
    BudgetPolicy, CostLedger, RuntimeBudgetHint, TenantPolicyStore,
)


def _scenario_hint_caps_run_spend() -> tuple[dict, list[str]]:
    """A run that has already burned the per-run cap returns
    is_blocked=True with reason='run_breach'."""
    policy = BudgetPolicy(
        monthly_ceiling_cents=10_000,
        soft_threshold_fraction=0.80,
        per_run_budget_cents=100,        # $1 per run cap
    )
    store = InMemoryStore()
    # 12 cents spent in this run, over the $1 cap
    for i in range(12):
        emit_tool_call(
            store, run_id="r1", agent_id="a", tenant_id="acme",
            stage="dev", tool="t", arguments={"i": i}, output={},
            cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    hint = RuntimeBudgetHint(
        ledger=CostLedger(store),
        policy_store=TenantPolicyStore(defaults=policy),
    )
    h = hint.remaining("acme", "r1")
    failures: list[str] = []
    if not h.is_blocked:
        failures.append("is_blocked=False; expected True (run_breach)")
    if h.reason != "run_breach":
        failures.append(f"reason={h.reason!r}, expected run_breach")
    if h.cents != 0:
        failures.append(f"cents={h.cents}, expected 0")
    if h.usd != 0.0:
        failures.append(f"usd={h.usd}, expected 0.0")
    return {"isBlocked": h.is_blocked, "cents": h.cents,
            "usd": h.usd, "reason": h.reason,
            "runSpend": h.run_spend_cents}, failures


def _scenario_hint_caps_tenant_spend() -> tuple[dict, list[str]]:
    """When the tenant's monthly cap is exhausted, the hint says
    tenant_breach even for a fresh run with zero spend."""
    policy = BudgetPolicy(
        monthly_ceiling_cents=1_000,        # $10 monthly cap
        soft_threshold_fraction=0.50,
        per_run_budget_cents=500,           # $5 per run cap (high)
    )
    store = InMemoryStore()
    # 200 cents across several runs in this tenant this month
    for r in range(4):
        for i in range(5):
            emit_tool_call(
                store, run_id=f"r{r}", agent_id="a", tenant_id="acme",
                stage="dev", tool="t", arguments={"i": i}, output={},
                cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
            )
    # Total: 4 runs * 5 calls * 10 cents = 200 cents.  Now push to 1100.
    for i in range(90):
        emit_tool_call(
            store, run_id="r0", agent_id="a", tenant_id="acme",
            stage="dev", tool="t", arguments={"i": 100 + i}, output={},
            cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    # New run with no events
    hint = RuntimeBudgetHint(
        ledger=CostLedger(store),
        policy_store=TenantPolicyStore(defaults=policy),
    )
    h = hint.remaining("acme", "fresh-run")
    failures: list[str] = []
    if not h.is_blocked:
        failures.append("is_blocked=False; expected True (tenant_breach)")
    if h.reason != "tenant_breach":
        failures.append(f"reason={h.reason!r}, expected tenant_breach")
    if h.tenant_remaining_cents != 0:
        failures.append(f"tenant_remaining={h.tenant_remaining_cents}, expected 0")
    return {"isBlocked": h.is_blocked, "reason": h.reason,
            "tenantRemaining": h.tenant_remaining_cents,
            "tenantSpend": h.tenant_spend_cents}, failures


def _scenario_hint_within_budget() -> tuple[dict, list[str]]:
    """A run that is well under both caps returns is_blocked=False."""
    policy = BudgetPolicy(
        monthly_ceiling_cents=10_000,
        soft_threshold_fraction=0.80,
        per_run_budget_cents=500,        # $5 per run cap
    )
    store = InMemoryStore()
    populate_tenant_runs(store, "acme", runs=1, cost_per_event=10)
    hint = RuntimeBudgetHint(
        ledger=CostLedger(store),
        policy_store=TenantPolicyStore(defaults=policy),
    )
    h = hint.remaining("acme", "run-acme-000")
    failures: list[str] = []
    if h.is_blocked:
        failures.append(f"is_blocked=True; expected False ({h.reason})")
    if h.reason != "ok":
        failures.append(f"reason={h.reason!r}, expected ok")
    if h.cents <= 0:
        failures.append(f"cents={h.cents}, expected > 0")
    return {"cents": h.cents, "usd": h.usd, "reason": h.reason}, failures


def _scenario_hint_unknown_run_uses_full_per_run_cap() -> tuple[dict, list[str]]:
    """A run with no events yet returns the full per-run cap as the
    hint, with reason='unknown_run'."""
    policy = BudgetPolicy(
        monthly_ceiling_cents=10_000,
        soft_threshold_fraction=0.80,
        per_run_budget_cents=500,
    )
    store = InMemoryStore()
    hint = RuntimeBudgetHint(
        ledger=CostLedger(store),
        policy_store=TenantPolicyStore(defaults=policy),
    )
    h = hint.remaining("acme", "fresh-run")
    failures: list[str] = []
    if h.cents != 500:
        failures.append(f"cents={h.cents}, expected 500 (full per-run cap)")
    if h.reason != "unknown_run":
        failures.append(f"reason={h.reason!r}, expected unknown_run")
    if h.is_blocked:
        failures.append("is_blocked=True; expected False (full budget available)")
    return {"cents": h.cents, "reason": h.reason}, failures


def _scenario_hint_with_no_per_run_cap() -> tuple[dict, list[str]]:
    """If the policy sets per_run_budget_cents=0, the per-run cap is
    disabled and the hint is bound by the tenant cap only."""
    policy = BudgetPolicy(
        monthly_ceiling_cents=1_000,
        soft_threshold_fraction=0.50,
        per_run_budget_cents=0,           # no per-run cap
    )
    store = InMemoryStore()
    for i in range(50):
        emit_tool_call(
            store, run_id="r1", agent_id="a", tenant_id="acme",
            stage="dev", tool="t", arguments={"i": i}, output={},
            cost_cents=10, prompt_tokens=1, completion_tokens=1, wall_ms=1.0,
        )
    hint = RuntimeBudgetHint(
        ledger=CostLedger(store),
        policy_store=TenantPolicyStore(defaults=policy),
    )
    h = hint.remaining("acme", "r1")
    failures: list[str] = []
    if h.tenant_remaining_cents != 500:
        failures.append(f"tenant_remaining={h.tenant_remaining_cents}, expected 500")
    if h.cents != 500:
        failures.append(f"cents={h.cents}, expected 500")
    if h.reason != "ok":
        failures.append(f"reason={h.reason!r}, expected ok")
    return {"cents": h.cents, "tenantRemaining": h.tenant_remaining_cents,
            "reason": h.reason}, failures


def main() -> int:
    return run([
        ("hint_caps_run_spend", _scenario_hint_caps_run_spend),
        ("hint_caps_tenant_spend", _scenario_hint_caps_tenant_spend),
        ("hint_within_budget", _scenario_hint_within_budget),
        ("hint_unknown_run_uses_full_per_run_cap",
         _scenario_hint_unknown_run_uses_full_per_run_cap),
        ("hint_with_no_per_run_cap", _scenario_hint_with_no_per_run_cap),
    ], test_name="test_integration")


if __name__ == "__main__":
    sys.exit(main())
