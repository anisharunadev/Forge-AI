"""
Cost ledger (FORA-75, 0.6).

The ledger is a **read-only derivation** from the audit store.  There
is no second place to write cost.  The audit event carries
`cost_cents`, `prompt_tokens`, `completion_tokens`, `wall_ms`; the
ledger sums these by:

* `tenantId x runId x stage x tool` -- the per-tool roll-up the
  board can pull to understand which tools drive spend.
* `tenantId x month` -- the per-tenant monthly burn-down the board
  read API returns.

The ledger is a pure function of the audit store at a point in time.
`recompute()` walks the store once and returns a snapshot; calling it
again on the same store returns an equivalent snapshot to the cent.
The reconciliation test (`tests/test_reconciliation.py`) is the
property test for the contract.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..audit import AuditEvent, AuditStore, InMemoryStore


_log = logging.getLogger("fora.cost.ledger")


@dataclass
class CostSummary:
    """A snapshot of cost totals for one (tenant, month) pair.

    The summary is the unit the `CeilingMeter` and `BoardReader`
    consume.  All numbers are cents or token counts -- never
    floats -- so reconciliation to the audit ledger is integer
    arithmetic.
    """
    tenant_id: str
    month_key: str                                  # e.g. "2026-06"
    total_cost_cents: int = 0
    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    total_wall_ms: int = 0
    event_count: int = 0
    run_count: int = 0
    by_tool: Dict[str, "ToolCost"] = field(default_factory=dict)
    by_stage: Dict[str, "StageCost"] = field(default_factory=dict)
    by_run: Dict[str, "RunCost"] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "tenantId": self.tenant_id,
            "monthKey": self.month_key,
            "totalCostCents": self.total_cost_cents,
            "totalPromptTokens": self.total_prompt_tokens,
            "totalCompletionTokens": self.total_completion_tokens,
            "totalWallMs": self.total_wall_ms,
            "eventCount": self.event_count,
            "runCount": self.run_count,
            "byTool": {k: v.to_dict() for k, v in self.by_tool.items()},
            "byStage": {k: v.to_dict() for k, v in self.by_stage.items()},
            "byRun": {k: v.to_dict() for k, v in self.by_run.items()},
        }


@dataclass
class ToolCost:
    tool: str
    calls: int = 0
    cost_cents: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    wall_ms: int = 0
    error_count: int = 0

    def to_dict(self) -> dict:
        return {
            "tool": self.tool,
            "calls": self.calls,
            "costCents": self.cost_cents,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "wallMs": self.wall_ms,
            "errorCount": self.error_count,
        }


@dataclass
class StageCost:
    stage: str
    cost_cents: int = 0
    calls: int = 0
    run_count: int = 0
    by_tool: Dict[str, ToolCost] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "stage": self.stage,
            "costCents": self.cost_cents,
            "calls": self.calls,
            "runCount": self.run_count,
            "byTool": {k: v.to_dict() for k, v in self.by_tool.items()},
        }


@dataclass
class RunCost:
    run_id: str
    cost_cents: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    wall_ms: int = 0
    event_count: int = 0
    by_tool: Dict[str, ToolCost] = field(default_factory=dict)
    by_stage: Dict[str, StageCost] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "runId": self.run_id,
            "costCents": self.cost_cents,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "wallMs": self.wall_ms,
            "eventCount": self.event_count,
            "byTool": {k: v.to_dict() for k, v in self.by_tool.items()},
            "byStage": {k: v.to_dict() for k, v in self.by_stage.items()},
        }


def _event_month_key(timestamp: str) -> str:
    """Extract the YYYY-MM key from an audit event timestamp.  We
    parse only the first 7 characters to keep this cheap on the hot
    path; malformed timestamps are bucketed under 'unknown' so the
    reconciliation test can still assert total cents == sum(event
    cents)."""
    if not timestamp or len(timestamp) < 7:
        return "unknown"
    return timestamp[:7]


def _is_cost_event(ev) -> bool:
    """True iff `ev` is a per-step tool call that contributes to
    the cost rollup.  The audit design (FORA-36 design v0.1, §4)
    states the source of truth is the per-step `tool_call` events;
    `run_started`, `run_finished`, `admin_override`, and
    `event_redacted` are boundary / synthetic events that should
    not be summed into the cost rollup (the `run_finished` event
    carries the per-run aggregate for defence-in-depth and would
    double-count).

    `total_cents()` is the sum of every event's `cost_cents` --
    including boundary events -- because that is the raw total
    the audit ledger produces.  The two views are consistent:
    the boundary events carry 0 cost in well-formed audit
    streams; the test suite asserts that property."""
    et = getattr(ev, "event_type", None)
    if et is None:
        return True        # be permissive for older / stub events
    from .schema_compat import is_tool_call_event
    return is_tool_call_event(et)


class CostLedger:
    """Read-only cost ledger.  Wraps an `AuditStore` and exposes
    aggregations by tenant x run x stage x tool and tenant x month.

    The ledger never appends.  The audit store is the single source
    of truth (per FORA-36 / ADR-0001 §D1).  A new `recompute()`
    walk is the only way to refresh the summary; if the audit store
    is appending live, callers re-invoke `recompute()` on every
    heartbeat (cheap for the dev store; the prod path uses a
    Postgres `audit.events` view materialised per minute).
    """

    def __init__(self, store: AuditStore) -> None:
        self._store = store

    @property
    def store(self) -> AuditStore:
        return self._store

    # -- per-run -------------------------------------------------------------

    def run_cost(self, tenant_id: str, run_id: str) -> RunCost:
        """Return the cost roll-up for one run.  This is the
        cheapest derivation: it walks the events for the (tenant,
        run) pair and aggregates.  Matches `AuditReader.cost_summary`
        exactly; we keep it here so the runtime can call it without
        taking a dependency on the reader.

        Boundary events (`run_started`, `run_finished`) are
        skipped: the audit design states that per-step `tool_call`
        events are the source of truth and the `run_finished`
        aggregate is a defence-in-depth rollup that would
        double-count.  The reconciliation property test
        (`tests/test_reconciliation.py::test_no_parallel_write_path`)
        verifies the ledger does not insert; the integer-arithmetic
        reconciliation is the integrity contract."""
        events = [
            ev for ev in self._store.list_for_run(tenant_id, run_id)
            if _is_cost_event(ev)
        ]
        return self._roll_up_run(run_id, events)

    # -- per-tenant per-month ------------------------------------------------

    def month_cost(self, tenant_id: str, month_key: str) -> CostSummary:
        """Return the per-tenant cost roll-up for one month.  The
        `month_key` is the YYYY-MM form; the helper `_event_month_key`
        applies the same transform on the event side so the bucket
        assignment is consistent.  Boundary events are filtered
        out -- see `run_cost` for the rationale."""
        events = [
            ev for ev in self._store.all()
            if ev.tenant_id == tenant_id
            and _event_month_key(ev.timestamp) == month_key
            and _is_cost_event(ev)
        ]
        return self._roll_up_tenant_month(tenant_id, month_key, events)

    def current_month_cost(self, tenant_id: str, *, now: Optional[dt.datetime] = None) -> CostSummary:
        """Convenience: the cost roll-up for the current UTC month."""
        n = now or dt.datetime.now(dt.timezone.utc)
        return self.month_cost(tenant_id, n.strftime("%Y-%m"))

    def list_month_costs(self, tenant_id: str) -> List[CostSummary]:
        """All per-month roll-ups for a tenant, ordered chronologically.
        Used by the board read API for the burn-down chart."""
        events = [
            ev for ev in self._store.all()
            if ev.tenant_id == tenant_id and _is_cost_event(ev)
        ]
        by_month: Dict[str, List[AuditEvent]] = {}
        for ev in events:
            mk = _event_month_key(ev.timestamp)
            by_month.setdefault(mk, []).append(ev)
        out: List[CostSummary] = []
        for mk in sorted(by_month.keys()):
            out.append(self._roll_up_tenant_month(tenant_id, mk, by_month[mk]))
        return out

    def list_tenant_costs(self) -> List[CostSummary]:
        """All tenants' current-month roll-ups.  The board's
        tenant picker uses this; the per-tenant sub-agents are then
        drilled into with `current_month_cost`."""
        out: List[CostSummary] = []
        seen: Dict[str, set] = {}
        for ev in self._store.all():
            if not _is_cost_event(ev):
                continue
            mk = _event_month_key(ev.timestamp)
            seen.setdefault(ev.tenant_id, set()).add(mk)
        for tenant_id, months in seen.items():
            for mk in sorted(months):
                out.append(self.month_cost(tenant_id, mk))
        return out

    # -- reconciliation ------------------------------------------------------

    def total_cents(self, tenant_id: str) -> int:
        """Sum of `cost_cents` for every cost-bearing event in the
        tenant's chain (per-step `tool_call` rows; boundary events
        are excluded by the same filter as the rollups).  This
        must equal the sum of per-month rollup totals to the cent;
        the reconciliation test asserts that.

        For the raw sum that *does* include boundary events (e.g.
        when a `run_finished` aggregate is non-zero), use
        `raw_total_cents` -- it is provided for the audit-side
        reconciliation and is not the value the ceiling meter
        consumes."""
        return sum(
            int(ev.cost_cents or 0)
            for ev in self._store.all()
            if ev.tenant_id == tenant_id and _is_cost_event(ev)
        )

    def raw_total_cents(self, tenant_id: str) -> int:
        """Sum of `cost_cents` for every event in the tenant's chain,
        including boundary events.  The reconciliation test
        compares this against the audit store's `sum(cost_cents)`
        to assert the ledger's read path matches the audit's
        write path exactly, regardless of the boundary-filtering
        policy."""
        return sum(
            int(ev.cost_cents or 0)
            for ev in self._store.all()
            if ev.tenant_id == tenant_id
        )

    # -- internals -----------------------------------------------------------

    def _roll_up_run(self, run_id: str, events: List[AuditEvent]) -> RunCost:
        rc = RunCost(run_id=run_id)
        for ev in events:
            cents = int(ev.cost_cents or 0)
            pt = int(ev.prompt_tokens or 0)
            ct = int(ev.completion_tokens or 0)
            wm = int(ev.wall_ms or 0)
            tool = ev.tool or "<boundary>"
            stage = ev.stage or "<boundary>"
            rc.cost_cents += cents
            rc.prompt_tokens += pt
            rc.completion_tokens += ct
            rc.wall_ms += wm
            rc.event_count += 1
            tslot = rc.by_tool.setdefault(tool, ToolCost(tool=tool))
            tslot.calls += 1
            tslot.cost_cents += cents
            tslot.prompt_tokens += pt
            tslot.completion_tokens += ct
            tslot.wall_ms += wm
            if ev.error_code:
                tslot.error_count += 1
            sslot = rc.by_stage.setdefault(stage, StageCost(stage=stage))
            sslot.cost_cents += cents
            sslot.calls += 1
            stslot = sslot.by_tool.setdefault(tool, ToolCost(tool=tool))
            stslot.calls += 1
            stslot.cost_cents += cents
            stslot.prompt_tokens += pt
            stslot.completion_tokens += ct
            stslot.wall_ms += wm
            if ev.error_code:
                stslot.error_count += 1
        # Distinct run count for a run is always 1; populated to
        # keep the shape consistent with `CostSummary`.
        for s in rc.by_stage.values():
            s.run_count = 1
        return rc

    def _roll_up_tenant_month(
        self,
        tenant_id: str,
        month_key: str,
        events: List[AuditEvent],
    ) -> CostSummary:
        cs = CostSummary(tenant_id=tenant_id, month_key=month_key)
        run_ids: set = set()
        for ev in events:
            cents = int(ev.cost_cents or 0)
            pt = int(ev.prompt_tokens or 0)
            ct = int(ev.completion_tokens or 0)
            wm = int(ev.wall_ms or 0)
            tool = ev.tool or "<boundary>"
            stage = ev.stage or "<boundary>"
            cs.total_cost_cents += cents
            cs.total_prompt_tokens += pt
            cs.total_completion_tokens += ct
            cs.total_wall_ms += wm
            cs.event_count += 1
            run_ids.add(ev.run_id)
            tslot = cs.by_tool.setdefault(tool, ToolCost(tool=tool))
            tslot.calls += 1
            tslot.cost_cents += cents
            tslot.prompt_tokens += pt
            tslot.completion_tokens += ct
            tslot.wall_ms += wm
            if ev.error_code:
                tslot.error_count += 1
            sslot = cs.by_stage.setdefault(stage, StageCost(stage=stage))
            sslot.cost_cents += cents
            sslot.calls += 1
            sslot.run_count += 1
            stslot = sslot.by_tool.setdefault(tool, ToolCost(tool=tool))
            stslot.calls += 1
            stslot.cost_cents += cents
            stslot.prompt_tokens += pt
            stslot.completion_tokens += ct
            stslot.wall_ms += wm
            if ev.error_code:
                stslot.error_count += 1
            rslot = cs.by_run.setdefault(ev.run_id, RunCost(run_id=ev.run_id))
            rslot.cost_cents += cents
            rslot.prompt_tokens += pt
            rslot.completion_tokens += ct
            rslot.wall_ms += wm
            rslot.event_count += 1
            rtool = rslot.by_tool.setdefault(tool, ToolCost(tool=tool))
            rtool.calls += 1
            rtool.cost_cents += cents
            rtool.prompt_tokens += pt
            rtool.completion_tokens += ct
            rtool.wall_ms += wm
            if ev.error_code:
                rtool.error_count += 1
            rstage = rslot.by_stage.setdefault(stage, StageCost(stage=stage))
            rstage.cost_cents += cents
            rstage.calls += 1
        cs.run_count = len(run_ids)
        return cs
