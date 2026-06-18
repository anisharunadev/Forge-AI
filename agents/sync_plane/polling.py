"""
Polling backstop (FORA-257 / Epic 11.7).

Per ADR-0010 §7.1, webhooks are best-effort (GitHub Apps drop
redeliveries after 24h; Jira webhooks can be disabled).  The
polling backstop is the per-tenant 5-min tick that catches the
gap by querying each remote for events that arrived since the
last cursor, and feeding the delta through the *same* Tier-1 /
Tier-2 path the webhook receiver uses.  This guarantees:

  1. Webhook-vs-poll is idempotent (both paths produce the same
     §8.1 audit row shape; the §6 canonical comment envelope is
     identical).
  2. `Retry-After` is honoured per-tenant (R-SYNC-08); the
     scheduler skips a row in `retry_until` and resumes the next
     tick.
  3. Back-pressure to inbound: if the platform's circuit breaker
     (11.6) is open, the poller pauses too (the inbound keeps
     flowing because the webhook receiver is the same backstop;
     see `BurstControl` port in the 11.1 skeleton).

Idempotency is the AC #2 contract: replaying the same delta must
NOT produce new audit events beyond the `sync.backfill.completed`
summary.  We enforce that by:

  * The reconciler is the single ingest path.  It takes a
    per-event `idempotency_key` (the remote's stable id) and
    dedups against a per-tenant ledger.  The smoke test proves
    this with a property test (idempotency_under_replay).

Reference: ADR-0010 §7.1, §8.1 (audit events), R-SYNC-05
(audit-divergence P0), R-SYNC-08 (Retry-After + back-pressure),
FORA-117 storage contract pattern (smoke-test + AC checks),
FORA-168 integration-child unblock pattern (recovery loop).

This module is pure-Python (no Postgres / no JetStream).  The
production wiring substitutes the InMemoryCursorStore /
InMemoryAuditLog for their Postgres counterparts; the call site
is one line in the runtime.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Mapping, Optional, Protocol, Sequence, Set, Tuple

from .audit import (
    BACKFILL_COMPLETED,
    EVENT_APPLIED,
    EVENT_RECEIVED,
    PLATFORM_DEGRADED,
    AuditRow,
    build_audit_row,
)
from .cursor import (
    DEFAULT_TICK_SECONDS,
    Cursor,
    CursorStore,
    InMemoryCursorStore,
    Platform,
    PLATFORMS,
    TickStatus,
    advance_cursor_value,
    compute_backoff_seconds,
)


_log = logging.getLogger("fora.sync_plane.polling")


# --- the event the fetcher hands to the reconciler -------------------------

@dataclass(frozen=True)
class RemoteEvent:
    """One event the platform returned for a `since` query.

    `remote_id` is the platform's stable id (Jira issue update
    id, GitHub event id, ClickUp task history id).  It is the
    idempotency key the reconciler dedups on.
    """
    remote_id: str
    platform: Platform
    tenant_id: str
    entity_id: str                  # canonical Paperclip issue id (after actor mapping)
    event_type: str                 # "issue.updated" / "comment.added" / "status.changed"
    occurred_at: dt.datetime
    payload: Mapping[str, Any]
    hlc: str = ""                   # HLC string from the remote; empty if remote doesn't speak HLC

    def idempotency_key(self) -> str:
        return f"{self.platform.value}:{self.tenant_id}:{self.remote_id}"


# --- fetcher port (per-platform) -------------------------------------------

class FetcherErrorKind(str, Enum):
    RETRY_AFTER = "retry_after"
    TRANSIENT = "transient"
    FATAL = "fatal"


@dataclass
class FetcherError(Exception):
    kind: FetcherErrorKind
    retry_after_seconds: int = 0
    message: str = ""

    def __str__(self) -> str:        # pragma: no cover (debug only)
        return f"{self.kind.value}: {self.message}"


# The Fetcher port is the seam 11.2a/b/c adapters (Jira, GitHub,
# ClickUp) implement.  The smoke test uses a stub that returns a
# canned delta; production uses the per-platform adapter.
#
# A Fetcher MUST:
#   * Honour the cursor and return ONLY events strictly after
#     `since` (cursor is exclusive on the remote).
#   * Raise FetcherError(RETRY_AFTER, retry_after_seconds=...) on
#     429 so the backstop preserves the cursor and respects
#     `Retry-After`.
#   * Be idempotent: re-invoking the same call with the same
#     cursor returns the same delta (the remote is the source
#     of truth here; the cursor is a strict cursor).
Fetcher = Callable[[str, Platform, str], Sequence[RemoteEvent]]


# --- audit-log port --------------------------------------------------------

class AuditLog(Protocol):
    """The seam the FORA-36 audit forwarder implements.

    `append()` is the only writer; the call site is the
    `emit_*` helpers in `agents/audit/emit.py` which hash-chain
    the event.  The smoke test uses an in-memory log that
    also records the order of appends for the idempotency
    property test."""

    def append(self, row: AuditRow) -> None: ...
    def list_for_tenant(self, tenant_id: str, since: Optional[dt.datetime] = None) -> List[AuditRow]: ...
    def count(self) -> int: ...


class InMemoryAuditLog:
    """Append-only in-memory audit log.  Mirrors the FORA-36
    contract for the smoke test:

      * `append()` is the only writer (no update / no delete).
      * `list_for_tenant` returns rows in append order (the
        smoke test asserts the §AC #2 idempotency invariant
        by counting rows).
    """

    def __init__(self) -> None:
        self._rows: List[AuditRow] = []
        self._lock = threading.Lock()

    def append(self, row: AuditRow) -> None:
        with self._lock:
            d = row.to_dict()
            self._rows.append(AuditRow(
                event_type=d["event_type"],
                tenant_id=d["tenant_id"],
                actor=d["actor"],
                timestamp=d.get("timestamp", "") or _utc_now_iso(),
                field=d.get("field", ""),
                winner_platform=d.get("winner_platform", ""),
                loser_platform=d.get("loser_platform", ""),
                winner_hlc=d.get("winner_hlc", ""),
                loser_hlc=d.get("loser_hlc", ""),
                reason=d.get("reason", ""),
                metadata=dict(d.get("metadata", {})),
            ))

    def list_for_tenant(self, tenant_id: str, since: Optional[dt.datetime] = None) -> List[AuditRow]:
        with self._lock:
            out = [r for r in self._rows if r.tenant_id == tenant_id]
            if since is not None:
                out = [r for r in out if _parse_iso(r.timestamp) and _parse_iso(r.timestamp) >= since]
            return out

    def count(self) -> int:
        with self._lock:
            return len(self._rows)

    def count_for_tenant(self, tenant_id: str) -> int:
        with self._lock:
            return sum(1 for r in self._rows if r.tenant_id == tenant_id)


# --- reconciler port (Tier-1 / Tier-2 path) -------------------------------

@dataclass
class ReconcilerResult:
    """The result of one remote event's Tier-1/Tier-2 reconciliation.

    `applied` is True iff the event passed Tier-1 (or Tier-2 LWW)
    and was written to canonical state; the audit row carries
    `event_type = "sync.event.applied"`.  `applied` is False iff
    the event was rejected (Tier-1 owner reject or Tier-3
    divergence); the audit row carries
    `event_type = "sync.event.divergence_detected"` (Tier 3
    candidate).

    `deduplicated` is True iff the reconciler already processed
    this event (matched on `idempotency_key`).  When True, the
    poller MUST NOT emit a `sync.event.received` or
    `sync.event.applied` row — the audit log only grows by the
    `sync.backfill.completed` summary.  This is the §AC #2
    contract (re-running the same delta produces no new audit
    events beyond `sync.backfill.completed`).
    """
    applied: bool
    audit_row: AuditRow
    deduplicated: bool = False


Reconciler = Callable[[RemoteEvent], ReconcilerResult]


# --- the polling backstop itself -------------------------------------------

@dataclass
class PollingTick:
    """The result of one tick for one (tenant, platform)."""
    tenant_id: str
    platform: Platform
    status: TickStatus
    events_received: int = 0
    events_applied: int = 0
    events_rejected: int = 0
    cursor_before: str = ""
    cursor_after: str = ""
    started_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))
    finished_at: Optional[dt.datetime] = None
    error_message: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tenant_id": self.tenant_id,
            "platform": self.platform.value,
            "status": self.status.value,
            "events_received": self.events_received,
            "events_applied": self.events_applied,
            "events_rejected": self.events_rejected,
            "cursor_before": self.cursor_before,
            "cursor_after": self.cursor_after,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "error_message": self.error_message,
        }


# --- back-pressure gate (R-SYNC-08) ---------------------------------------

class BackpressureGate:
    """Honours the per-tenant `Retry-After` and the platform circuit
    breaker (R-SYNC-08).

    `paused` is True iff the Sync Plane has decided the platform
    is unhealthy enough to pause outbound (we keep inbound
    flowing because the webhook receiver is upstream of us).  In
    a real deployment the 11.6 `BurstControl` port is the source
    of truth; here we expose a callable so the smoke test can
    drive it deterministically.
    """

    def __init__(self, *, circuit_open: Callable[[Platform], bool] = lambda _p: False) -> None:
        self._circuit_open = circuit_open

    def is_paused(self, platform: Platform) -> bool:
        return bool(self._circuit_open(platform))


# --- the orchestrator ------------------------------------------------------

class PollingBackstop:
    """The 5-min polling backstop per ADR-0010 §7.1.

    Public surface:

        pb = PollingBackstop(
            store=cursor_store,
            fetchers={Platform.JIRA: jira_fetcher, ...},
            reconciler=tier12_reconciler,
            audit_log=audit_log,
            alert=alert_channel,
            backpressure=BackpressureGate(),
            clock=lambda: dt.datetime.now(dt.timezone.utc),
        )
        pb.tick_once(tenant_id, Platform.JIRA)   # one (tenant, platform)
        pb.tick_all(Platform.JIRA)               # scheduler entry

    The orchestrator is intentionally a thin loop:

        1. Read the cursor from the store.
        2. If the platform is back-pressured, return NO_DELTA
           (the cursor is preserved; inbound keeps flowing).
        3. Call the fetcher.  On RETRY_AFTER, store the retry
           and return.
        4. For each event, call the reconciler and append the
           resulting audit row.
        5. Advance the cursor to the max `occurred_at` we saw.
        6. Emit a `sync.backfill.completed` audit row.
        7. Persist the new cursor.
    """

    def __init__(
        self,
        *,
        store: CursorStore,
        fetchers: Mapping[Platform, Fetcher],
        reconciler: Reconciler,
        audit_log: AuditLog,
        backpressure: Optional[BackpressureGate] = None,
        clock: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.timezone.utc),
    ) -> None:
        if not fetchers:
            raise ValueError("fetchers map is required (at least one platform)")
        for p in fetchers:
            if p not in PLATFORMS:
                raise ValueError(f"unknown platform: {p!r}")
        self._store = store
        self._fetchers = dict(fetchers)
        self._reconciler = reconciler
        self._audit = audit_log
        self._backpressure = backpressure or BackpressureGate()
        self._clock = clock

    # --- public surface ---------------------------------------------------

    def tick_once(
        self, tenant_id: str, platform: Platform, *, now: Optional[dt.datetime] = None
    ) -> PollingTick:
        now = now or self._clock()
        cursor = self._store.get(tenant_id, platform)
        if cursor is None:
            cursor = Cursor(tenant_id=tenant_id, platform=platform)
        tick = PollingTick(
            tenant_id=tenant_id, platform=platform,
            status=TickStatus.NO_DELTA,
            cursor_before=cursor.cursor_value,
        )

        # R-SYNC-08: honour Retry-After and back-pressure.
        if cursor.retry_until and cursor.retry_until > now:
            tick.status = TickStatus.RETRY_AFTER
            tick.finished_at = now
            return tick
        if self._backpressure.is_paused(platform):
            tick.status = TickStatus.NO_DELTA
            tick.error_message = "backpressure: circuit_open or platform degraded"
            tick.finished_at = now
            return tick

        fetcher = self._fetchers[platform]
        try:
            events = list(fetcher(tenant_id, platform, cursor.cursor_value))
        except FetcherError as e:
            tick.finished_at = now
            tick.error_message = e.message
            if e.kind is FetcherErrorKind.RETRY_AFTER:
                cursor.retry_until = now + dt.timedelta(seconds=max(1, e.retry_after_seconds))
                cursor.last_status = TickStatus.RETRY_AFTER
                cursor.last_run_at = now
                self._store.upsert(cursor)
                tick.status = TickStatus.RETRY_AFTER
                # Audit the degraded platform (R-SYNC-05 / §8.1).
                self._emit_platform_degraded(cursor, e, now)
                return tick
            if e.kind is FetcherErrorKind.FATAL:
                cursor.consecutive_errors += 1
                cursor.backoff_seconds = compute_backoff_seconds(cursor.consecutive_errors)
                cursor.last_status = TickStatus.FATAL
                cursor.last_run_at = now
                self._store.upsert(cursor)
                tick.status = TickStatus.FATAL
                self._emit_platform_degraded(cursor, e, now)
                return tick
            # TRANSIENT
            cursor.consecutive_errors += 1
            cursor.backoff_seconds = compute_backoff_seconds(cursor.consecutive_errors)
            cursor.last_status = TickStatus.TRANSIENT
            cursor.last_run_at = now
            self._store.upsert(cursor)
            tick.status = TickStatus.TRANSIENT
            return tick

        # --- success path ------------------------------------------------
        if not events:
            cursor.last_status = TickStatus.NO_DELTA
            cursor.last_run_at = now
            cursor.consecutive_errors = 0
            cursor.backoff_seconds = 0
            self._store.upsert(cursor)
            tick.status = TickStatus.NO_DELTA
            tick.finished_at = now
            return tick

        max_observed = cursor.cursor_value
        for ev in events:
            key = ev.idempotency_key()
            # Ask the reconciler first.  If it dedups (replay),
            # we do NOT emit `sync.event.received` or
            # `sync.event.applied` — the §AC #2 contract says
            # "no new audit events beyond sync.backfill.completed".
            # Production Tier-1/Tier-2 will be a thin wrapper
            # around this same dedup contract.
            result = self._reconciler(ev)
            if result.deduplicated:
                tick.events_received += 0   # unchanged; replay not counted
                max_observed = advance_cursor_value(
                    platform, max_observed, ev.occurred_at.isoformat()
                )
                continue
            # 1. The webhook receiver would also emit `event.received`
            #    on this row; the poller emits the same row so the
            #    audit log does not distinguish webhook vs poll.
            self._audit.append(build_audit_row(
                event_type=EVENT_RECEIVED,
                tenant_id=ev.tenant_id,
                actor=f"system:polling-backstop:{ev.platform.value}",
                field=ev.event_type,
                metadata={
                    "remote_id": ev.remote_id,
                    "idempotency_key": key,
                    "occurred_at": ev.occurred_at.isoformat(),
                    "hlc": ev.hlc or "",
                    "source": "polling",
                },
            ))
            # 2. Apply the audit row the reconciler returned.
            self._audit.append(result.audit_row)
            tick.events_received += 1
            if result.applied:
                tick.events_applied += 1
            else:
                tick.events_rejected += 1
            max_observed = advance_cursor_value(platform, max_observed, ev.occurred_at.isoformat())

        # 3. Advance the cursor.  Important: even on a 0-applied
        #    tick we advance (Tier-1 reject or Tier-3 candidate
        #    is still "received").  The reconciler is responsible
        #    for emitting the appropriate audit row in that case.
        cursor.cursor_value = max_observed or cursor.cursor_value
        cursor.last_status = TickStatus.SUCCESS
        cursor.last_run_at = now
        cursor.consecutive_errors = 0
        cursor.backoff_seconds = 0
        cursor.retry_until = None
        self._store.upsert(cursor)

        # 4. Emit the §8.1 backfill-completed summary row.
        self._emit_backfill_completed(cursor, tick, now)
        tick.cursor_after = cursor.cursor_value
        tick.status = TickStatus.SUCCESS
        tick.finished_at = now
        return tick

    def tick_all(self, platform: Platform, *, now: Optional[dt.datetime] = None) -> List[PollingTick]:
        now = now or self._clock()
        out: List[PollingTick] = []
        for c in self._store.list_due(platform, now):
            out.append(self.tick_once(c.tenant_id, platform, now=now))
        return out

    # --- audit helpers ---------------------------------------------------

    def _emit_backfill_completed(
        self, cursor: Cursor, tick: PollingTick, now: dt.datetime
    ) -> None:
        row = build_audit_row(
            event_type=BACKFILL_COMPLETED,
            tenant_id=cursor.tenant_id,
            actor=f"system:polling-backstop:{cursor.platform.value}",
            metadata={
                "platform": cursor.platform.value,
                "events_received": str(tick.events_received),
                "events_applied": str(tick.events_applied),
                "events_rejected": str(tick.events_rejected),
                "cursor_before": tick.cursor_before,
                "cursor_after": tick.cursor_after,
                "tick_status": tick.status.value,
                "source": "polling",
            },
        )
        # Override the timestamp; the resolver would let the
        # forwarder stamp it, but for the smoke test we want
        # deterministic ordering.
        row.timestamp = now.isoformat()
        self._audit.append(row)

    def _emit_platform_degraded(
        self, cursor: Cursor, err: FetcherError, now: dt.datetime
    ) -> None:
        row = build_audit_row(
            event_type=PLATFORM_DEGRADED,
            tenant_id=cursor.tenant_id,
            actor=f"system:polling-backstop:{cursor.platform.value}",
            metadata={
                "platform": cursor.platform.value,
                "error_kind": err.kind.value,
                "error_message": err.message,
                "retry_after_seconds": str(err.retry_after_seconds),
                "consecutive_errors": str(cursor.consecutive_errors),
            },
        )
        row.timestamp = now.isoformat()
        self._audit.append(row)


# --- helpers ---------------------------------------------------------------

def _utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _parse_iso(s: str) -> Optional[dt.datetime]:
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s)
    except ValueError:
        return None


# --- default reconciler for the smoke test --------------------------------

# A naive reconciler for the smoke test that records the canonical
# comment envelope (FORA-253 will replace this with the real
# Tier-1/Tier-2 path).  It is *idempotent* — the production
# behaviour the §AC #2 contract requires — because it checks the
# in-memory audit log for the same idempotency key.

class InMemoryIdempotentReconciler:
    """The smoke-test reconciler.  Marks every new event as
    applied; replays return `deduplicated=True` and the poller
    does NOT emit any audit row for them (the §AC #2 contract).

    `idempotency_key` is the §6.1 envelope field that protects
    against the poller-and-webhook double delivery.  The
    production Tier-1/Tier-2 reconciler (FORA-254) is a thin
    wrapper around this same dedup contract.
    """

    def __init__(self, audit_log: AuditLog) -> None:
        self._audit = audit_log
        self._seen: Set[str] = set()
        self._lock = threading.Lock()

    def __call__(self, ev: RemoteEvent) -> ReconcilerResult:
        key = ev.idempotency_key()
        with self._lock:
            if key in self._seen:
                # Replay: the canonical state already has this
                # event.  Return deduplicated=True so the poller
                # emits NO new audit row.  This is the §AC #2
                # contract.
                return ReconcilerResult(
                    applied=True,
                    audit_row=AuditRow(
                        event_type=EVENT_APPLIED,
                        tenant_id=ev.tenant_id,
                        actor=f"system:polling-backstop:{ev.platform.value}",
                    ),
                    deduplicated=True,
                )
            self._seen.add(key)
        return ReconcilerResult(
            applied=True,
            audit_row=build_audit_row(
                event_type=EVENT_APPLIED,
                tenant_id=ev.tenant_id,
                actor=f"system:polling-backstop:{ev.platform.value}",
                field=ev.event_type,
                metadata={
                    "idempotency_key": key,
                    "remote_id": ev.remote_id,
                    "source": "polling",
                    "replayed": "false",
                },
            ),
            deduplicated=False,
        )

    def seen_count(self) -> int:
        with self._lock:
            return len(self._seen)
