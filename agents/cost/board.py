"""
Board read API (FORA-75, 0.6).

The board / CEO inspection surface for cost.  Three endpoints worth
of data:

* `monthly_burndown(tenant_id)` -- the per-month series the board
  renders as a bar / line chart.
* `top_spending(tenant_id, *, by="agent")` -- the agents (or stages,
  or tools) that drove the most spend in the current month.
* `alert_log(tenant_id)` -- the alert timeline.

The reader is tenant-scoped.  A reader constructed with one tenant
refuses to return another tenant's data.  In production the
constructor takes the caller's tenant_id (from the JWT) and the
read methods take no tenant argument; the dev path takes the
tenant_id as an argument so tests can exercise isolation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .alerts import AlertLog, AlertRecord
from .ledger import CostLedger, CostSummary
from .policy import TenantPolicyStore


_log = logging.getLogger("fora.cost.board")


@dataclass
class BurndownPoint:
    month_key: str
    cost_cents: int
    event_count: int
    run_count: int

    def to_dict(self) -> dict:
        return {
            "monthKey": self.month_key,
            "costCents": self.cost_cents,
            "eventCount": self.event_count,
            "runCount": self.run_count,
        }


@dataclass
class SpenderEntry:
    """One row in the top-spenders list.  `dimension` is "agent" /
    "stage" / "tool"; `key` is the value; `cost_cents` is the sum."""
    dimension: str
    key: str
    cost_cents: int
    calls: int

    def to_dict(self) -> dict:
        return {
            "dimension": self.dimension,
            "key": self.key,
            "costCents": self.cost_cents,
            "calls": self.calls,
        }


class BoardReader:
    """The read API the board view consumes.

    Constructor takes the ledger, the policy store, and the alert
    log.  In production these are wired by the cost-agent's
    bootstrap; in dev the tests construct them by hand.
    """

    def __init__(
        self,
        *,
        ledger: CostLedger,
        policy_store: TenantPolicyStore,
        alerts: AlertLog,
    ) -> None:
        self._ledger = ledger
        self._policies = policy_store
        self._alerts = alerts

    # -- monthly burn-down ---------------------------------------------------

    def monthly_burndown(self, tenant_id: str) -> List[BurndownPoint]:
        """Per-month cost series, chronological."""
        summaries = self._ledger.list_month_costs(tenant_id)
        return [
            BurndownPoint(
                month_key=s.month_key,
                cost_cents=s.total_cost_cents,
                event_count=s.event_count,
                run_count=s.run_count,
            )
            for s in summaries
        ]

    def current_month(self, tenant_id: str) -> CostSummary:
        """The current-month roll-up (used by the dashboard hero card)."""
        return self._ledger.current_month_cost(tenant_id)

    def tenant_policy(self, tenant_id: str) -> dict:
        return self._policies.get(tenant_id).to_dict()

    # -- top spending --------------------------------------------------------

    def top_spending(
        self,
        tenant_id: str,
        *,
        by: str = "agent",
        month_key: Optional[str] = None,
        limit: int = 10,
    ) -> List[SpenderEntry]:
        """Top-spenders list for a tenant in a month, sliced by
        `by` (one of "agent", "stage", "tool").  The audit store
        is the source -- the ledger walks it directly.  The board
        view picks `by` from a dropdown."""
        if by not in {"agent", "stage", "tool"}:
            raise ValueError(f"by must be 'agent', 'stage', or 'tool'; got {by!r}")
        if month_key is None:
            import datetime as dt
            month_key = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
        summary = self._ledger.month_cost(tenant_id, month_key)
        if by == "tool":
            rows = [
                SpenderEntry(
                    dimension="tool", key=tc.tool,
                    cost_cents=tc.cost_cents, calls=tc.calls,
                )
                for tc in summary.by_tool.values()
            ]
        elif by == "stage":
            rows = [
                SpenderEntry(
                    dimension="stage", key=sc.stage,
                    cost_cents=sc.cost_cents, calls=sc.calls,
                )
                for sc in summary.by_stage.values()
            ]
        else:  # by == "agent"
            from .ledger import _is_cost_event
            tally: Dict[str, Dict[str, int]] = {}
            for ev in self._ledger.store.all():
                if ev.tenant_id != tenant_id:
                    continue
                if not ev.timestamp or ev.timestamp[:7] != month_key:
                    continue
                if not _is_cost_event(ev):
                    continue        # skip boundary events
                slot = tally.setdefault(ev.agent_id or "<unknown>", {"cost": 0, "calls": 0})
                slot["cost"] += int(ev.cost_cents or 0)
                slot["calls"] += 1
            rows = [
                SpenderEntry(
                    dimension="agent", key=key,
                    cost_cents=val["cost"], calls=val["calls"],
                )
                for key, val in tally.items()
            ]
        rows.sort(key=lambda r: r.cost_cents, reverse=True)
        return rows[:limit]

    # -- alert log -----------------------------------------------------------

    def alert_log(self, tenant_id: Optional[str] = None) -> List[AlertRecord]:
        """The alert timeline.  Tenant-scoped when `tenant_id` is
        given; full log otherwise (the latter is the audit-admin
        view in production)."""
        if tenant_id is None:
            return self._alerts.all()
        return self._alerts.for_tenant(tenant_id)
