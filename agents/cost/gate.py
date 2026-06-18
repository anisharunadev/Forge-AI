"""
Tenant gate (FORA-75, 0.6).

The gate is the spine that decides whether a new run may be admitted.
The `MasterOrchestrator` (FORA-110) calls `gate.check(tenant_id)`
before launching a run; the result is `ADMIT` or `DENY` with a reason.

The gate reads the `CeilingMeter` state and the `AlertLog` pause
flag.  A tenant is denied admission iff:

    * The meter is in HARD_BREACH, AND
    * The alert log shows the tenant is currently paused (i.e. no
      later `tenant_resumed` alert exists).

This split -- state + log -- is the property test for "hard threshold
pauses new runs".  The orchestrator does not need to know about the
ceiling at all; it asks the gate, the gate knows the rule.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from .alerts import AlertLog
from .ceiling import CeilingMeter, CeilingState


_log = logging.getLogger("fora.cost.gate")


class GateDecision(str, Enum):
    ADMIT = "admit"
    DENY = "deny"


@dataclass
class GateVerdict:
    decision: GateDecision
    reason: str
    state: CeilingState
    spend_cents: int
    ceiling_cents: int
    month_key: str

    def to_dict(self) -> dict:
        return {
            "decision": self.decision.value,
            "reason": self.reason,
            "state": self.state.value,
            "spendCents": self.spend_cents,
            "ceilingCents": self.ceiling_cents,
            "monthKey": self.month_key,
        }


class TenantGate:
    """The admission control for new runs.

    The gate composes a `CeilingMeter` and an `AlertLog`.  The
    production wire-up is identical: the meter derives state from
    the audit store, the log carries the pause / resume record, and
    the gate is the single `check()` the orchestrator calls.
    """

    def __init__(self, meter: CeilingMeter, alerts: AlertLog) -> None:
        self._meter = meter
        self._alerts = alerts

    def check(self, tenant_id: str) -> GateVerdict:
        # Re-derive spend + ceiling from the most recent recompute
        # path; the meter recompute is the one place we already pay
        # for both.  The gate is on the hot path -- a `recompute`
        # per check is acceptable in dev; the prod path is a
        # cached view in `audit.events` (one Postgres SELECT).
        import datetime as dt
        mk = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
        summary = self._meter.ledger.month_cost(tenant_id, mk)
        policy = self._meter._policies.get(tenant_id)
        spend = summary.total_cost_cents
        ceiling = policy.monthly_ceiling_cents
        state = self._meter.state(tenant_id)
        if state == CeilingState.HARD_BREACH and self._alerts.is_paused(tenant_id):
            return GateVerdict(
                decision=GateDecision.DENY,
                reason="monthly_ceiling_breach",
                state=state,
                spend_cents=spend,
                ceiling_cents=ceiling,
                month_key=mk,
            )
        return GateVerdict(
            decision=GateDecision.ADMIT,
            reason="within_budget",
            state=state,
            spend_cents=spend,
            ceiling_cents=ceiling,
            month_key=mk,
        )
