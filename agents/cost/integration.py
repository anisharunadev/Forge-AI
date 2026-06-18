"""
Runtime budget hint (FORA-75, 0.6).

The seam between the cost system and the Agent runtime 0.2.  The
runtime asks `RuntimeBudgetHint.remaining(runId)` before each tool
call; the hint answers in *cents* (matching the audit store and the
ledger) but exposes a `usd` convenience for the runtime, which
tracks `CostSnapshot.usd` (dollars).

The hint is computed from three numbers:

    per_run_budget_cents  -- from the tenant's `BudgetPolicy`
    spend so far          -- sum of `cost_cents` for the run
    tenant remaining      -- monthly ceiling minus monthly spend

`remaining(runId)` returns the **smaller** of (per-run cap - run spend)
and (tenant cap - tenant spend).  This is the property the issue
calls out: "Agent runtime can read `budget.remaining(runId)` and
short-circuit before exceeding it."

The runtime treats a non-positive hint as a hard stop.  In dev the
runtime's `CostBudget.can_afford` is the consumer; in production
the hint is plumbed into the same `BudgetMeter` that lives in
`agents/runtime/cost.py`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from .ledger import CostLedger
from .policy import TenantPolicyStore


_log = logging.getLogger("fora.cost.integration")


def _cents_to_usd(cents: int) -> float:
    return round(cents / 100.0, 4)


@dataclass
class BudgetHint:
    """The answer to `RuntimeBudgetHint.remaining(runId)`.

    `cents` is the canonical value (integer arithmetic).  `usd` is
    the dollar convenience for the runtime's `CostSnapshot`.

    `reason` is one of:

        "ok"            -- the runtime may proceed.
        "run_breach"    -- this run alone would exceed the per-run cap.
        "tenant_breach" -- the tenant's monthly cap is already exhausted.
        "unknown_run"   -- the run has no events yet; the hint is the
                           full per-run cap.  The runtime still has
                           the tenant cap to fall back on.
    """
    cents: int
    usd: float
    run_spend_cents: int
    tenant_spend_cents: int
    per_run_cap_cents: int
    tenant_remaining_cents: int
    reason: str

    def to_dict(self) -> dict:
        return {
            "cents": self.cents,
            "usd": self.usd,
            "runSpendCents": self.run_spend_cents,
            "tenantSpendCents": self.tenant_spend_cents,
            "perRunCapCents": self.per_run_cap_cents,
            "tenantRemainingCents": self.tenant_remaining_cents,
            "reason": self.reason,
        }

    @property
    def is_blocked(self) -> bool:
        """True iff the runtime should short-circuit."""
        return self.cents <= 0 or self.reason in {"run_breach", "tenant_breach"}


class RuntimeBudgetHint:
    """The `budget.remaining(runId)` seam.

    The runtime calls this once per tool call (or once per plan
    step) to decide whether to proceed.  The hint is a pure
    function of the audit store + the tenant's policy; a fresh
    recompute on every call is cheap (the dev store is in-memory;
    the prod path is a materialised view).
    """

    def __init__(
        self,
        *,
        ledger: CostLedger,
        policy_store: TenantPolicyStore,
    ) -> None:
        self._ledger = ledger
        self._policies = policy_store

    def remaining(self, tenant_id: str, run_id: str) -> BudgetHint:
        """Return the budget hint for `run_id` under `tenant_id`.

        Algorithm:

            run_spent       = sum(cost_cents) for the (tenant, run) pair
            tenant_spent    = sum(cost_cents) for the (tenant, current_month) pair
            per_run_remaining = max(0, per_run_cap_cents - run_spent)
            tenant_remaining  = max(0, monthly_ceiling_cents - tenant_spent)
            remaining         = min(per_run_remaining, tenant_remaining)

        The reason is "run_breach" when the per-run bucket is the
        binding constraint, "tenant_breach" when the tenant cap is,
        "unknown_run" when the run has not been seen yet (the hint
        is the full per-run cap), and "ok" otherwise.
        """
        import datetime as dt
        mk = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
        policy = self._policies.get(tenant_id)
        per_run_cap = policy.per_run_budget_cents
        monthly_cap = policy.monthly_ceiling_cents
        # Run spend: sum of events for the (tenant, run) pair.
        run_events = self._ledger.store.list_for_run(tenant_id, run_id)
        run_spent = sum(int(e.cost_cents or 0) for e in run_events)
        # Tenant spend: per-month summary (uses the ledger's bucketing
        # helper, but the spend is summed across all months for
        # simplicity here -- a tenant that already blew the cap in a
        # prior month is, by the gate's rules, paused already).
        month_summary = self._ledger.month_cost(tenant_id, mk)
        tenant_spent = month_summary.total_cost_cents
        per_run_remaining = max(0, per_run_cap - run_spent) if per_run_cap > 0 else monthly_cap
        tenant_remaining = max(0, monthly_cap - tenant_spent)
        # Bind on the smaller of the two.  If per_run_cap is 0, the
        # policy is "no per-run cap" and the tenant cap is the only
        # constraint.
        if per_run_cap > 0:
            remaining = min(per_run_remaining, tenant_remaining)
        else:
            remaining = tenant_remaining
        if per_run_cap > 0 and per_run_remaining <= 0:
            reason = "run_breach"
        elif tenant_remaining <= 0:
            reason = "tenant_breach"
        elif not run_events:
            reason = "unknown_run"
        else:
            reason = "ok"
        return BudgetHint(
            cents=remaining,
            usd=_cents_to_usd(remaining),
            run_spend_cents=run_spent,
            tenant_spend_cents=tenant_spent,
            per_run_cap_cents=per_run_cap,
            tenant_remaining_cents=tenant_remaining,
            reason=reason,
        )
