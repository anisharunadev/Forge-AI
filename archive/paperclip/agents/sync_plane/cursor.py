"""
Polling cursor store (FORA-257 / Epic 11.7 — Polling backstop).

Per ADR-0010 §7.1, the polling backstop catches the webhook SLA
gap (GitHub 24h redelivery window; Jira webhooks can be disabled).
One cursor per (tenant, platform) pair is persisted across
restarts; the cursor value is the platform-specific opaque token
(Jira `updated_after`, GitHub `since`, ClickUp `date_updated_gt`).

The cursor also carries scheduling state so the backstop can
honour per-tenant `Retry-After` (R-SYNC-08) and back-pressure to
inbound when the platform's rate limit is hot.

Reference: ADR-0010 §7.1 row 1 (Webhook missed), §7.1 row 4
(per-tenant rate limit), R-SYNC-08 (Retry-After + back-pressure).

This module is pure-Python.  Production wiring swaps
`InMemoryCursorStore` for a Postgres-backed adapter; the call
sites are one-line substitutions.
"""

from __future__ import annotations

import datetime as dt
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Protocol, Tuple


# --- platform + cursor-field registry --------------------------------------

class Platform(str, Enum):
    JIRA = "jira"
    GITHUB = "github"
    CLICKUP = "clickup"

    @property
    def cursor_field(self) -> str:
        """The query-parameter name the platform uses for the cursor.

        Jira: `updated_after`
        GitHub: `since`  (ISO 8601)
        ClickUp: `date_updated_gt` (unix ms)
        """
        return {
            Platform.JIRA: "updated_after",
            Platform.GITHUB: "since",
            Platform.CLICKUP: "date_updated_gt",
        }[self]


PLATFORMS: Tuple[Platform, ...] = (Platform.JIRA, Platform.GITHUB, Platform.CLICKUP)


# Default tick interval per ADR-0010 §7.1 — 5 min.
DEFAULT_TICK_SECONDS = 300


class TickStatus(str, Enum):
    """Outcome of the last tick for one (tenant, platform) cursor.

    * SUCCESS      — fetcher returned a non-empty delta; the cursor
                     advanced and Tier-1/Tier-2 applied the events.
    * NO_DELTA     — fetcher returned empty; the cursor did not
                     advance (avoids burning a new cursor on an
                     empty `since` query that some platforms treat
                     as a hard error).
    * RETRY_AFTER  — fetcher returned 429 with `Retry-After`; cursor
                     is preserved (not advanced) and the next tick
                     is gated by `retry_until`.
    * TRANSIENT    — fetcher failed for a non-429 reason; the cursor
                     is preserved and `consecutive_errors` is bumped
                     so the next tick can be backed off.
    * FATAL        — fetcher returned a 4xx other than 429; the
                     cursor is *not* advanced and the alert channel
                     receives a P1 (the platform is misconfigured
                     for this tenant, e.g. revoked token).
    """
    SUCCESS = "success"
    NO_DELTA = "no_delta"
    RETRY_AFTER = "retry_after"
    TRANSIENT = "transient"
    FATAL = "fatal"


@dataclass
class Cursor:
    """One cursor row, keyed by (tenant_id, platform)."""
    tenant_id: str
    platform: Platform
    cursor_value: str = ""          # empty = "from the start of time"
    last_run_at: Optional[dt.datetime] = None
    last_status: TickStatus = TickStatus.NO_DELTA
    retry_until: Optional[dt.datetime] = None
    consecutive_errors: int = 0
    backoff_seconds: int = 0        # doubles on TRANSIENT, capped at 1h
    metadata: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "tenant_id": self.tenant_id,
            "platform": self.platform.value,
            "cursor_value": self.cursor_value,
            "last_run_at": self.last_run_at.isoformat() if self.last_run_at else None,
            "last_status": self.last_status.value,
            "retry_until": self.retry_until.isoformat() if self.retry_until else None,
            "consecutive_errors": self.consecutive_errors,
            "backoff_seconds": self.backoff_seconds,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, d: Dict) -> "Cursor":
        return cls(
            tenant_id=d["tenant_id"],
            platform=Platform(d["platform"]),
            cursor_value=d.get("cursor_value", ""),
            last_run_at=(
                dt.datetime.fromisoformat(d["last_run_at"])
                if d.get("last_run_at") else None
            ),
            last_status=TickStatus(d.get("last_status", "no_delta")),
            retry_until=(
                dt.datetime.fromisoformat(d["retry_until"])
                if d.get("retry_until") else None
            ),
            consecutive_errors=int(d.get("consecutive_errors", 0)),
            backoff_seconds=int(d.get("backoff_seconds", 0)),
            metadata=dict(d.get("metadata", {})),
        )


# --- store port ------------------------------------------------------------

class CursorStore(Protocol):
    """The seam the production Postgres adapter implements.

    All methods are synchronous; production wires them through
    asyncpg with `asyncio.to_thread` if the call site is async.
    """

    def get(self, tenant_id: str, platform: Platform) -> Optional[Cursor]: ...
    def upsert(self, cursor: Cursor) -> None: ...
    def list_due(
        self, platform: Platform, now: dt.datetime
    ) -> List[Cursor]: ...
    def list_all(self, platform: Platform) -> List[Cursor]: ...


class InMemoryCursorStore:
    """The smoke-test / dev backstop.  Thread-safe; survives a
    snapshot/load round-trip via `to_dict` / `from_dict` so the
    AC #1 "cursor persists across restarts" can be proven without
    Postgres."""

    def __init__(self) -> None:
        self._rows: Dict[Tuple[str, Platform], Cursor] = {}
        self._lock = threading.Lock()

    def get(self, tenant_id: str, platform: Platform) -> Optional[Cursor]:
        with self._lock:
            c = self._rows.get((tenant_id, platform))
            return _copy_cursor(c) if c else None

    def upsert(self, cursor: Cursor) -> None:
        with self._lock:
            # Store a defensive copy so external mutations don't
            # silently poison the in-memory table.  We can't go
            # through to_dict/from_dict because `Platform` is a
            # `str, Enum`; to_dict() flattens it to a string and
            # the round-trip would lose the enum.
            self._rows[(cursor.tenant_id, cursor.platform)] = _copy_cursor(cursor)

    def list_due(
        self, platform: Platform, now: dt.datetime
    ) -> List[Cursor]:
        with self._lock:
            out: List[Cursor] = []
            for c in self._rows.values():
                if c.platform is not platform:
                    continue
                # Skip rows gated by Retry-After.
                if c.retry_until and c.retry_until > now:
                    continue
                # Skip rows in backoff (TRANSIENT or FATAL).
                if c.backoff_seconds > 0 and c.last_run_at is not None:
                    next_due = c.last_run_at + dt.timedelta(seconds=c.backoff_seconds)
                    if next_due > now:
                        continue
                out.append(_copy_cursor(c))
            out.sort(key=lambda c: (c.tenant_id, c.last_run_at or dt.datetime.min))
            return out

    def list_all(self, platform: Platform) -> List[Cursor]:
        with self._lock:
            return [
                _copy_cursor(c)
                for c in self._rows.values()
                if c.platform is platform
            ]

    # --- snapshot for AC #1 (persistence-across-restart) -----------------

    def snapshot(self) -> List[Dict]:
        with self._lock:
            return [c.to_dict() for c in self._rows.values()]

    @classmethod
    def from_snapshot(cls, rows: List[Dict]) -> "InMemoryCursorStore":
        s = cls()
        for r in rows:
            s.upsert(Cursor.from_dict(r))
        return s


# --- helpers ---------------------------------------------------------------

def advance_cursor_value(platform: Platform, current: str, observed_max: str) -> str:
    """Return the new cursor value after a successful tick.

    The cursor is the *opaque* `max(updated_at)` we've consumed;
    a higher value is strictly newer.  The poller uses this to
    guarantee the next tick picks up where this one stopped even
    if the Tier-1/Tier-2 path rejected some events (so the event
    set is not strictly monotonic).
    """
    if not observed_max:
        return current
    if not current:
        return observed_max
    # ISO 8601 strings sort lexically; ClickUp unix-ms is a string
    # of digits which also sorts lexically.
    if observed_max > current:
        return observed_max
    return current


def compute_backoff_seconds(consecutive_errors: int) -> int:
    """Exponential backoff for TRANSIENT ticks.

    1 → 30s, 2 → 60s, 3 → 120s, 4 → 240s, ...  capped at 1 hour.
    Capped at 1h because the next tick is at most 1 tick away in
    any case (5 min default); the cap keeps the per-tenant
    recovery latency bounded.
    """
    if consecutive_errors <= 0:
        return 0
    return min(3600, 30 * (2 ** (consecutive_errors - 1)))


def _copy_cursor(c: Cursor) -> Cursor:
    """Defensive copy that preserves the `Platform` enum.

    We can't use `copy.deepcopy` (it works but is overkill) and
    we can't use `Cursor(**c.to_dict())` (to_dict flattens the
    Platform enum to a string and the round-trip loses the
    enum).  This helper is the seam.
    """
    return Cursor(
        tenant_id=c.tenant_id,
        platform=c.platform,
        cursor_value=c.cursor_value,
        last_run_at=c.last_run_at,
        last_status=c.last_status,
        retry_until=c.retry_until,
        consecutive_errors=c.consecutive_errors,
        backoff_seconds=c.backoff_seconds,
        metadata=dict(c.metadata),
    )
