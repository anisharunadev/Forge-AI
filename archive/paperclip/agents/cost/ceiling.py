"""
Ceiling meter (FORA-75, 0.6).

Consumes the cost ledger, fires soft/hard threshold alerts, and
maintains a tenant-state machine:

    OK                 spend < soft_threshold_cents
    SOFT_BREACH        soft_threshold_cents <= spend < monthly_ceiling_cents
    HARD_BREACH        spend >= monthly_ceiling_cents
    PAUSED             hard_breach observed + tenant gate active

The meter is the property test for "soft threshold breach produces a
board notification within one heartbeat; hard threshold pauses new
runs" (the issue body acceptance).  A heartbeat is one recompute()
call.  In production the orchestrator schedules the meter on the
same cadence as the audit fan-out (~1 minute in v1, 30s in v1.1).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from .alerts import AlertLog, AlertRecord
from .ledger import CostLedger
from .policy import BudgetPolicy, TenantPolicyStore, _month_key


_log = logging.getLogger("fora.cost.ceiling")


class CeilingState(str, Enum):
    """The per-tenant state the meter computes from spend + policy."""
    OK = "ok"
    SOFT_BREACH = "soft_breach"
    HARD_BREACH = "hard_breach"


@dataclass
class CeilingVerdict:
    """The result of one `recompute` call.  Carries the per-tenant
    state and the alerts that fired during this recompute (which may
    be empty on a quiet heartbeat)."""
    tenant_id: str
    month_key: str
    spend_cents: int
    state: CeilingState
    policy: BudgetPolicy
    alerts: list  # list[AlertRecord] -- avoid forward import

    def to_dict(self) -> dict:
        return {
            "tenantId": self.tenant_id,
            "monthKey": self.month_key,
            "spendCents": self.spend_cents,
            "state": self.state.value,
            "policy": self.policy.to_dict(),
            "alerts": [a.to_dict() for a in self.alerts],
        }


class CeilingMeter:
    """The per-tenant ceiling state machine.

    Constructor takes the policy store, the ledger, and the alert log.
    `recompute(tenant_id, *, now=None)` returns a `CeilingVerdict`
    and appends any new alerts to the log.  Recompute is idempotent
    for the same `(tenant_id, month_key)`: the alert log dedupes on
    `soft:<tenant>:<month>` and `hard:<tenant>:<month>` so a
    heartbeat that re-finds the tenant above 80% does not re-fire.
    """

    def __init__(
        self,
        *,
        policy_store: TenantPolicyStore,
        ledger: CostLedger,
        alerts: AlertLog,
    ) -> None:
        self._policies = policy_store
        self._ledger = ledger
        self._alerts = alerts

    @property
    def ledger(self) -> CostLedger:
        return self._ledger

    @property
    def alerts(self) -> AlertLog:
        return self._alerts

    def recompute(self, tenant_id: str, *, now: Optional[object] = None) -> CeilingVerdict:
        """Recompute the per-tenant state for the current month.  Fires
        `soft_threshold` and/or `hard_threshold` and/or `tenant_paused`
        alerts on the transition.  Returns the verdict.

        The `now` parameter is exposed so the tests can pin a month
        boundary without freezing the clock; in production it is
        `None` and the meter uses `dt.datetime.now(UTC)`."""
        import datetime as dt
        n = now or dt.datetime.now(dt.timezone.utc)
        if isinstance(n, dt.datetime):
            mk = n.strftime("%Y-%m")
        else:
            mk = _month_key(None)  # current
        summary = self._ledger.month_cost(tenant_id, mk)
        policy = self._policies.get(tenant_id)
        spend = summary.total_cost_cents
        fired: list = []
        if spend >= policy.monthly_ceiling_cents:
            state = CeilingState.HARD_BREACH
            rec = self._alerts.append(AlertLog.make_hard(
                tenant_id=tenant_id, month_key=mk, spend_cents=spend,
                ceiling_cents=policy.monthly_ceiling_cents,
                soft_cents=policy.soft_threshold_cents,
            ))
            if rec is not None:
                fired.append(rec)
                # The first hard alert in a month also pauses the
                # tenant.  The tenant_resumed alert clears it.
                pause = self._alerts.append(AlertLog.make_paused(
                    tenant_id=tenant_id, month_key=mk, spend_cents=spend,
                    ceiling_cents=policy.monthly_ceiling_cents,
                    soft_cents=policy.soft_threshold_cents,
                ))
                if pause is not None:
                    fired.append(pause)
        elif spend >= policy.soft_threshold_cents:
            state = CeilingState.SOFT_BREACH
            rec = self._alerts.append(AlertLog.make_soft(
                tenant_id=tenant_id, month_key=mk, spend_cents=spend,
                ceiling_cents=policy.monthly_ceiling_cents,
                soft_cents=policy.soft_threshold_cents,
            ))
            if rec is not None:
                fired.append(rec)
        else:
            state = CeilingState.OK
        return CeilingVerdict(
            tenant_id=tenant_id,
            month_key=mk,
            spend_cents=spend,
            state=state,
            policy=policy,
            alerts=fired,
        )

    def resume(self, tenant_id: str, *, reason: str = "admin_resume") -> AlertRecord:
        """Admin path: lift the pause.  The alert log records the
        action; the gate consults the log to admit new runs again."""
        rec = AlertLog.make_resumed(tenant_id, reason=reason)
        inserted = self._alerts.append(rec)
        # `make_resumed` uses a unique key (uuid suffix) so it always
        # inserts; but be defensive and return whichever record is in
        # the log.
        return inserted or rec

    def state(self, tenant_id: str) -> CeilingState:
        """Cheap state query -- does not refire alerts.  Useful for
        the orchestrator to make a gate decision without a full
        recompute."""
        import datetime as dt
        mk = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
        summary = self._ledger.month_cost(tenant_id, mk)
        policy = self._policies.get(tenant_id)
        if summary.total_cost_cents >= policy.monthly_ceiling_cents:
            return CeilingState.HARD_BREACH
        if summary.total_cost_cents >= policy.soft_threshold_cents:
            return CeilingState.SOFT_BREACH
        return CeilingState.OK
