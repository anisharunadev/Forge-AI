"""
Read API for the board and the CTO (FORA-36 deliverable, FORA-75
consumer, FORA-110 consumer).

Tenant-scoped on every method.  The reader does not perform
writes; the only mutation is the synthetic `event_redacted` from
`apply_retention`, which goes through the store, not the reader.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from .chain import ChainBreak, HashChain
from .schema import AuditEvent
from .store import AuditStore


@dataclass
class ReadResult:
    """What the board view returns for one run: the events and the
    chain verdict."""
    events: List[AuditEvent]
    chain_ok: bool
    breaks: List[ChainBreak]

    def to_dict(self) -> dict:
        return {
            "events": [e.to_dict() for e in self.events],
            "chainOk": self.chain_ok,
            "breaks": [b.to_dict() for b in self.breaks],
        }


class AuditReader:
    """The read API.  Every method takes `tenant_id` as the first
    argument; the reader refuses to cross tenants even when a
    caller holds a `superuser` token.  This is the
    "tenant isolation" property from `memory/security.md §4`."""

    def __init__(self, store: AuditStore) -> None:
        self._store = store

    def read_run(self, tenant_id: str, run_id: str) -> ReadResult:
        """Return every event for a single run, in append order,
        with the chain verdict.  A board user calling this can
        reconstruct the agent's decision path (issue acceptance
        criterion)."""
        events = self._store.list_for_run(tenant_id, run_id)
        ok, breaks = HashChain.verify(events)
        return ReadResult(events=events, chain_ok=ok, breaks=breaks)

    def read_tenant(self, tenant_id: str, *, limit: int = 1000) -> List[AuditEvent]:
        """Return events for a tenant, newest first.  The limit is
        a server-side cap; the board view pages on the client side
        because the store is append-only and the cursor is the
        newest event id seen."""
        return self._store.list_for_tenant(tenant_id, limit=limit)

    def verify_run(self, tenant_id: str, run_id: str) -> Tuple[bool, List[ChainBreak]]:
        """Return the chain verdict for one run.  Cheaper than
        `read_run` because it skips materialising the events as
        dicts."""
        events = self._store.list_for_run(tenant_id, run_id)
        return HashChain.verify(events)

    def get(self, tenant_id: str, event_id: str) -> Optional[AuditEvent]:
        """Return a single event.  The tenant gate is enforced:
        an event id from a different tenant is not returned even
        if it exists in the store."""
        ev = self._store.get(event_id)
        if ev is None or ev.tenant_id != tenant_id:
            return None
        return ev

    def cost_summary(self, tenant_id: str, run_id: str) -> dict:
        """The shape FORA-75 cost tracking reads.  Returns totals
        derived from the audit events themselves; this is how
        0.6 avoids a parallel ledger (issue acceptance criterion)."""
        events = self._store.list_for_run(tenant_id, run_id)
        total_cents = sum(e.cost_cents for e in events)
        total_prompt = sum(e.prompt_tokens for e in events)
        total_completion = sum(e.completion_tokens for e in events)
        total_wall_ms = sum(e.wall_ms for e in events)
        by_tool: dict = {}
        for e in events:
            t = e.tool or "<boundary>"
            slot = by_tool.setdefault(t, {"calls": 0, "costCents": 0,
                                          "promptTokens": 0,
                                          "completionTokens": 0,
                                          "wallMs": 0.0,
                                          "errorCount": 0})
            slot["calls"] += 1
            slot["costCents"] += e.cost_cents
            slot["promptTokens"] += e.prompt_tokens
            slot["completionTokens"] += e.completion_tokens
            slot["wallMs"] += e.wall_ms
            if e.error_code:
                slot["errorCount"] += 1
        return {
            "tenantId": tenant_id,
            "runId": run_id,
            "totalCostCents": total_cents,
            "totalPromptTokens": total_prompt,
            "totalCompletionTokens": total_completion,
            "totalWallMs": total_wall_ms,
            "byTool": by_tool,
            "eventCount": len(events),
        }
