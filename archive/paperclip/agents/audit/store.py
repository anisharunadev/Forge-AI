"""
Audit store protocol and shipped implementations (ADR-0001 §D1).

The protocol is the seam: production code uses `PostgresStore`
(append-only Postgres, three roles, DB-level UPDATE/DELETE triggers
that raise); dev/test code uses `InMemoryStore` (append-only list,
optional JSON-lines file for persistence).  Both implement the same
`AuditStore` ABC so the runtime does not care which is wired in.

A bug in the store is a P0 -- the acceptance test in
`tests/test_store.py` exercises the boundary in isolation.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from abc import ABC, abstractmethod
from typing import Iterable, List, Optional, Tuple

from .chain import GENESIS_HASH, HashChain
from .schema import AuditEvent, AuditEventType, canonical_json


_log = logging.getLogger("fora.audit.store")


class AuditStore(ABC):
    """The append-only audit store.  Implementations MUST refuse
    `update()` and `delete()` at the boundary; the admin path lives
    in `agents/audit/admin.py` and itself emits an `admin_override`
    event so the action is auditable (per the issue acceptance
    criterion)."""

    @abstractmethod
    def append(self, event: AuditEvent) -> AuditEvent:
        """Append `event` to the store.  Implementations stamp
        `prev_hash` and `record_hash` (if not already set) so the
        caller cannot forge the chain.  Returns the event with
        `record_hash` populated."""

    @abstractmethod
    def get(self, event_id: str) -> Optional[AuditEvent]:
        """Read a single event by id.  Returns None if not found."""

    @abstractmethod
    def list_for_run(self, tenant_id: str, run_id: str) -> List[AuditEvent]:
        """Return all events for a (tenant, run) pair, in append
        order.  Used by the read API and the chain verifier."""

    @abstractmethod
    def list_for_tenant(self, tenant_id: str, *, limit: int = 1000) -> List[AuditEvent]:
        """Return events for a tenant, newest first.  Used by the
        board view; the limit is a server-side cap, not a paging
        contract."""

    @abstractmethod
    def all(self) -> List[AuditEvent]:
        """Return every event in append order across all tenants.
        Used by retention sweeps and admin tooling; not for
        production read paths."""

    @abstractmethod
    def flush(self) -> None:
        """Persist any in-memory state.  No-op for stores that
        write through."""


class InMemoryStore(AuditStore):
    """Append-only in-memory store, optionally mirrored to a
    JSON-lines file.  The file is the durable artefact in the dev
    environment; in production this class is not deployed (the
    PostgresStore + SQS path takes over).

    Thread-safety: a single lock guards all mutations.  The lock
    is held only for the duration of an append, so the
    throughput is bounded by the chain hash (sub-millisecond
    per event in practice)."""

    def __init__(self, path: Optional[str] = None,
                 tenant_id: Optional[str] = None) -> None:
        self._lock = threading.Lock()
        self._events: List[AuditEvent] = []
        # The chain head is keyed on (tenant_id, run_id) so the
        # chain is per-run, as the ADR requires.  We keep the heads
        # in a dict so concurrent runs do not interleave.
        self._heads: dict = {}
        self._path = path
        if self._path is not None:
            self._load()

    # -- AuditStore ---------------------------------------------------------

    def append(self, event: AuditEvent) -> AuditEvent:
        with self._lock:
            key = (event.tenant_id, event.run_id)
            if not event.prev_hash:
                event.prev_hash = self._heads.get(key, GENESIS_HASH)
            if not event.record_hash:
                event.record_hash = HashChain.next_hash(event, event.prev_hash)
            self._events.append(event)
            self._heads[key] = event.record_hash
            if self._path is not None:
                self._append_to_file(event)
        return event

    def get(self, event_id: str) -> Optional[AuditEvent]:
        with self._lock:
            for ev in self._events:
                if ev.event_id == event_id:
                    return ev
        return None

    def list_for_run(self, tenant_id: str, run_id: str) -> List[AuditEvent]:
        with self._lock:
            return [ev for ev in self._events
                    if ev.tenant_id == tenant_id and ev.run_id == run_id]

    def list_for_tenant(self, tenant_id: str, *, limit: int = 1000) -> List[AuditEvent]:
        with self._lock:
            matches = [ev for ev in self._events if ev.tenant_id == tenant_id]
        # Newest first; events are append-ordered so we reverse.
        return list(reversed(matches[-limit:]))

    def all(self) -> List[AuditEvent]:
        with self._lock:
            return list(self._events)

    def flush(self) -> None:
        # No-op: appends write through to the file when configured.
        return None

    # -- file I/O ------------------------------------------------------------

    def _append_to_file(self, event: AuditEvent) -> None:
        # Append a single JSON line.  The file is the durable audit
        # artefact in dev; the chain is verified by replaying it.
        # We never rewrite a line; this method opens in append mode
        # only.
        assert self._path is not None
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        with open(self._path, "a", encoding="utf-8") as fp:
            fp.write(canonical_json(event.to_dict(include_hash=True)) + "\n")

    def _load(self) -> None:
        assert self._path is not None
        if not os.path.exists(self._path):
            return
        with open(self._path, "r", encoding="utf-8") as fp:
            for line in fp:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                ev = _from_dict(d)
                # The file already carries the chain head; trust it
                # and seed the in-memory state.
                self._events.append(ev)
                self._heads[(ev.tenant_id, ev.run_id)] = ev.record_hash


def _from_dict(d: dict) -> AuditEvent:
    """Reconstruct an `AuditEvent` from its on-disk form.  Defensive
    against missing optional fields; tolerates older revisions
    provided the required fields are present."""
    return AuditEvent(
        event_id=d.get("eventId", ""),
        schema_version=d.get("schemaVersion", "0.1.0"),
        event_type=AuditEventType(d.get("eventType", "tool_call")),
        timestamp=d.get("timestamp", ""),
        run_id=d.get("runId", ""),
        agent_id=d.get("agentId", ""),
        tenant_id=d.get("tenantId", ""),
        stage=d.get("stage", ""),
        tool=d.get("tool", ""),
        input_digest=d.get("inputDigest", ""),
        output_digest=d.get("outputDigest", ""),
        cost_cents=int(d.get("costCents", 0) or 0),
        prompt_tokens=int(d.get("promptTokens", 0) or 0),
        completion_tokens=int(d.get("completionTokens", 0) or 0),
        wall_ms=float(d.get("wallMs", 0.0) or 0.0),
        call_id=d.get("callId", ""),
        step_id=d.get("stepId", ""),
        idempotency_key=d.get("idempotencyKey", ""),
        error_code=d.get("errorCode", ""),
        actor=d.get("actor", ""),
        request_id=d.get("requestId", ""),
        input_ref=d.get("inputRef", ""),
        output_ref=d.get("outputRef", ""),
        metadata=d.get("metadata", {}) or {},
        prev_hash=d.get("prevHash", ""),
        record_hash=d.get("recordHash", ""),
    )
