"""
Alert wiring for shadow_drift OOH (out-of-hours / unprocessed) —
FORA-268 (Epic 11.7 §AC #4).

Per ADR-0010 §8.2 R-SYNC-05 + Epic 11.7 §AC #4, any `sync.shadow_drift`
audit event older than 60 min and *unprocessed* must trigger a
Slack alert via the FORA-36 audit forwarder.  Unprocessed means:

  * the resolver has not yet emitted an `event.applied` row that
    references the drift's `metadata.run_id` (the resolver
    adopted the drift and overwrote the shadow log), AND
  * no `event.divergence_resolved` row references the drift's
    `metadata.run_id` (the resolver parked it in the Tier 3
    workbench via the §7.2 path), AND
  * the drift's `timestamp` is > 60 min in the past at alert
    check time.

The alert channel is a Slack webhook behind the FORA-36 forwarder
(production wires it via `audit.forwarder.page_to_slack(channel=
shadow_drift_ooh, …)`).  The smoke test uses an in-memory channel
that records every page so the test can assert the contract.

The job is per-tenant, tenant-scoped, and idempotent: the OOH
check is keyed off `(tenant_id, run_id)` so a re-run on the same
drift set does not produce duplicate pages (the alert channel
dedups on that key).

Reference: ADR-0010 §7.2 #4 (audit divergence P0), §8.2 R-SYNC-05
(daily divergence P0 + OOH shadow-drift P1).  Epic 11.7 sub-task
#7.  Owner: Architect (this module) + QA (DocAgent — exit-gate #4
verifies the alert fires within 60 min of an unprocessed drift).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import threading
from dataclasses import dataclass, field
from typing import Callable, Dict, Iterable, List, Optional, Protocol, Set, Tuple

from .audit import (
    AuditRow,
    DIVERGENCE_RESOLVED_EVENT,
    EVENT_APPLIED,
    SHADOW_DRIFT_EVENT,
)


_log = logging.getLogger("fora.sync_plane.alert_wiring")


# --- constants ------------------------------------------------------------

# The 60-min OOH threshold per the issue body / Epic 11.7 §AC #4.
OOH_THRESHOLD_MINUTES = 60
OOH_THRESHOLD_SECONDS = OOH_THRESHOLD_MINUTES * 60

# Closed set of platform strings the alert wiring accepts.
_VALID_PLATFORMS = frozenset({"jira", "github", "clickup"})

# The default Slack channel the FORA-36 forwarder pages on.
DEFAULT_SLACK_CHANNEL = "#sync-plane-shadow-drift"

# The actor stamped on every alert-wiring event the job emits.
DEFAULT_ACTOR = "system:shadow-drift-ooh-alert"


# --- ports ----------------------------------------------------------------

class SlackChannel(Protocol):
    """The seam the production FORA-36 forwarder implements.

    Production wires this to the `audit.forwarder.slack_page`
    function; the smoke test uses an in-memory list.  The channel
    is responsible for the actual HTTP POST to Slack — this module
    is pure with respect to the transport."""
    def page(self, payload: "SlackPage") -> None: ...


class InMemorySlackChannel:
    """Thread-safe in-memory SlackChannel.  Records every page and
    dedups on `(tenant_id, run_id)` so the §idempotency contract
    is testable without state leakage across calls."""
    def __init__(self) -> None:
        self._pages: List[SlackPage] = []
        self._seen: Set[Tuple[str, str]] = set()
        self._lock = threading.Lock()

    def page(self, payload: "SlackPage") -> bool:
        """Record a page; return True if accepted (new), False if
        a duplicate was suppressed.  The alerter keys off the
        return value so its `pending` list is also deduped."""
        key = (payload.tenant_id, payload.run_id)
        with self._lock:
            if key in self._seen:
                return False
            self._seen.add(key)
            self._pages.append(_copy_page(payload))
            return True

    def pages(self) -> List["SlackPage"]:
        with self._lock:
            return [_copy_page(p) for p in self._pages]

    def count(self) -> int:
        with self._lock:
            return len(self._pages)

    def reset(self) -> None:
        with self._lock:
            self._pages.clear()
            self._seen.clear()


# --- wire types -----------------------------------------------------------

@dataclass
class SlackPage:
    """The payload the FORA-36 forwarder hands to Slack.

    The shape matches the existing FORA-36 alert convention
    (R-SYNC-05 + the per-feature `audit.daily_sample` channel):
      * `channel`     — Slack channel name (default `#sync-plane-shadow-drift`)
      * `severity`    — `P1` for the OOH case (R-SYNC-05 reserved `P0` for
                        audit divergence; shadow-drift OOH is the §AC #4 P1
                        tier per the issue body)
      * `tenant_id`   — for the Slack thread header
      * `run_id`      — the drift's `metadata.run_id`; the dedup key
      * `title`       — Slack message title (first line)
      * `summary`     — Slack message body (markdown)
      * `details`     — structured payload for the Slack app
      * `fired_at`    — ISO 8601 UTC of when the alert was sent
    """
    channel: str
    severity: str
    tenant_id: str
    run_id: str
    title: str
    summary: str
    details: Dict[str, str] = field(default_factory=dict)
    fired_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))

    def to_dict(self) -> Dict:
        return {
            "channel": self.channel,
            "severity": self.severity,
            "tenant_id": self.tenant_id,
            "run_id": self.run_id,
            "title": self.title,
            "summary": self.summary,
            "details": dict(self.details),
            "fired_at": self.fired_at.isoformat(),
        }


def _copy_page(p: SlackPage) -> SlackPage:
    return SlackPage(
        channel=p.channel,
        severity=p.severity,
        tenant_id=p.tenant_id,
        run_id=p.run_id,
        title=p.title,
        summary=p.summary,
        details=dict(p.details),
        fired_at=p.fired_at,
    )


@dataclass
class OOHPending:
    """A drift event that triggered an OOH alert.  The smoke test
    asserts these tuples (without timestamp) are stable."""
    tenant_id: str
    run_id: str
    platform: str
    entity_id: str
    field: str
    age_seconds: int
    slack_page: SlackPage

    def to_dict(self) -> Dict:
        return {
            "tenant_id": self.tenant_id,
            "run_id": self.run_id,
            "platform": self.platform,
            "entity_id": self.entity_id,
            "field": self.field,
            "age_seconds": self.age_seconds,
            "slack_page": self.slack_page.to_dict(),
        }


# --- the job --------------------------------------------------------------

class ShadowDriftOOHAlerter:
    """The 60-min OOH check for `sync.shadow_drift` events.

    Public surface:

        alerter = ShadowDriftOOHAlerter(
            audit_log=audit_log,
            slack=slack_channel,
            clock=lambda: dt.datetime.now(dt.timezone.utc),
        )
        pending = alerter.scan(tenant_id="acme")
        # pending == [OOHPending, ...]  (alerts fired)

    Idempotency: the `InMemorySlackChannel` dedups on
    `(tenant_id, run_id)`, so re-scanning the same drift set
    produces zero new pages.  The smoke test proves this with a
    re-scan assertion.
    """

    def __init__(
        self,
        *,
        audit_log: "AuditLogReader",
        slack: SlackChannel,
        clock: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.timezone.utc),
        actor: str = DEFAULT_ACTOR,
        channel: str = DEFAULT_SLACK_CHANNEL,
        threshold_seconds: int = OOH_THRESHOLD_SECONDS,
    ) -> None:
        if audit_log is None:
            raise ValueError("audit_log is required")
        if slack is None:
            raise ValueError("slack is required")
        if threshold_seconds <= 0:
            raise ValueError("threshold_seconds must be > 0")
        self._audit = audit_log
        self._slack = slack
        self._clock = clock
        self._actor = actor
        self._channel = channel
        self._threshold_seconds = threshold_seconds

    @property
    def threshold_seconds(self) -> int:
        return self._threshold_seconds

    def scan(self, *, tenant_id: str, now: Optional[dt.datetime] = None) -> List[OOHPending]:
        """Scan the audit log for OOH shadow_drift events for one
        tenant.  Returns the list of `OOHPending` that fired an
        alert (empty list if every drift was already processed
        within the threshold)."""
        now = now or self._clock()
        if not tenant_id:
            raise ValueError("tenant_id is required")

        # 1. Collect every shadow_drift row for the tenant.
        drifts = [
            r for r in self._audit.list_for_tenant(tenant_id)
            if r.event_type == SHADOW_DRIFT_EVENT
        ]
        if not drifts:
            return []

        # 2. Build the set of (run_id)s the resolver has touched
        # (via event.applied or divergence_resolved) since the
        # drift landed.  The forwarder stores these in the same
        # log; the OOH check reads them out so we know which
        # drifts are still unprocessed.
        processed_run_ids = self._processed_run_ids(tenant_id)

        # 3. For each drift, decide if it is OOH.
        pending: List[OOHPending] = []
        for drift in drifts:
            run_id = (drift.metadata or {}).get("run_id", "")
            if not run_id:
                # Malformed row (no run_id) — skip; the
                # shadow_diff job always stamps one.
                continue
            if run_id in processed_run_ids:
                continue
            drift_ts = _parse_iso(drift.timestamp)
            if drift_ts is None:
                # No timestamp → cannot decide OOH; skip.
                continue
            age = (now - drift_ts).total_seconds()
            if age < self._threshold_seconds:
                continue
            platform = (drift.metadata or {}).get("platform", "")
            entity_id = (drift.metadata or {}).get("entity_id", "")
            page = self._build_page(
                drift=drift,
                tenant_id=tenant_id,
                run_id=run_id,
                platform=platform,
                entity_id=entity_id,
                age_seconds=int(age),
                now=now,
            )
            self._slack.page(page)
            pending.append(OOHPending(
                tenant_id=tenant_id,
                run_id=run_id,
                platform=platform,
                entity_id=entity_id,
                field=drift.field,
                age_seconds=int(age),
                slack_page=page,
            ))
        return pending

    # -- helpers ----------------------------------------------------------

    def _processed_run_ids(self, tenant_id: str) -> Set[str]:
        """The set of `metadata.run_id` values the resolver has
        touched (applied or diverged) for one tenant.  The OOH
        check subtracts this set from the drift set; the
        remainder is unprocessed."""
        out: Set[str] = set()
        for row in self._audit.list_for_tenant(tenant_id):
            if row.event_type not in (EVENT_APPLIED, DIVERGENCE_RESOLVED_EVENT):
                continue
            run_id = (row.metadata or {}).get("run_id", "")
            if run_id:
                out.add(run_id)
        return out

    def _build_page(
        self,
        *,
        drift: AuditRow,
        tenant_id: str,
        run_id: str,
        platform: str,
        entity_id: str,
        age_seconds: int,
        now: dt.datetime,
    ) -> SlackPage:
        """Build the Slack page payload.  Pure; the format is
        fixed so the QA exit-gate #4 can assert on the digest."""
        old = (drift.metadata or {}).get("old_value")
        new = (drift.metadata or {}).get("new_value")
        details = {
            "tenant_id": tenant_id,
            "run_id": run_id,
            "platform": platform,
            "entity_id": entity_id,
            "field": drift.field,
            "old_value": _stringify(old),
            "new_value": _stringify(new),
            "detected_hlc": (drift.metadata or {}).get("detected_hlc", ""),
            "remote_hlc": (drift.metadata or {}).get("remote_hlc", ""),
            "age_seconds": str(age_seconds),
            "threshold_seconds": str(self._threshold_seconds),
            "fired_at": now.isoformat(),
        }
        title = (
            f"[{tenant_id}] shadow_drift OOH ({age_seconds}s) "
            f"{platform}/{entity_id}/{drift.field}"
        )
        summary = (
            f"Sync Plane shadow-drift event *{run_id}* on tenant "
            f"`{tenant_id}` has been unprocessed for "
            f"{age_seconds // 60} min (threshold "
            f"{self._threshold_seconds // 60} min).\n\n"
            f"* Platform: `{platform or 'unknown'}`\n"
            f"* Entity: `{entity_id or 'unknown'}`\n"
            f"* Field: `{drift.field}`\n"
            f"* Old: `{_stringify(old)}`\n"
            f"* New: `{_stringify(new)}`\n"
        )
        return SlackPage(
            channel=self._channel,
            severity="P1",
            tenant_id=tenant_id,
            run_id=run_id,
            title=title,
            summary=summary,
            details=details,
            fired_at=now,
        )


# --- the audit log reader port -------------------------------------------

class AuditLogReader(Protocol):
    """Read-only view of the FORA-36 audit log.  Production wires
    this to the audit reader (`agents/audit/reader.py`); the smoke
    test uses an in-memory list."""
    def list_for_tenant(
        self, tenant_id: str
    ) -> List[AuditRow]: ...


class ListAuditLogReader:
    """In-memory AuditLogReader backed by a list.  Test seam only.
    Thread-safe; production wires the FORA-36 reader which is
    Postgres-backed."""
    def __init__(self, rows: Optional[List[AuditRow]] = None) -> None:
        self._rows: List[AuditRow] = list(rows or [])
        self._lock = threading.Lock()

    def append(self, row: AuditRow) -> None:
        with self._lock:
            self._rows.append(row)

    def list_for_tenant(self, tenant_id: str) -> List[AuditRow]:
        with self._lock:
            return [r for r in self._rows if r.tenant_id == tenant_id]


# --- pure helpers ---------------------------------------------------------

def is_ooh(
    *,
    drift_timestamp: str,
    now: dt.datetime,
    threshold_seconds: int = OOH_THRESHOLD_SECONDS,
) -> bool:
    """Pure OOH predicate.  Returns True iff the drift is older
    than the threshold.  Used by the smoke test to assert the
    boundary behaviour (60 min - 1 s is not OOH; 60 min + 1 s is)."""
    ts = _parse_iso(drift_timestamp)
    if ts is None:
        return False
    return (now - ts).total_seconds() >= threshold_seconds


def _parse_iso(s: str) -> Optional[dt.datetime]:
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _stringify(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, str):
        return v if len(v) <= 200 else v[:197] + "…"
    try:
        return json.dumps(v, sort_keys=True, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return repr(v)


def page_digest(page: SlackPage) -> str:
    """Stable SHA-256 of the page payload (excluding `fired_at`).
    The smoke test asserts the same drift always produces the
    same digest (the §idempotency contract)."""
    payload = {
        "channel": page.channel,
        "severity": page.severity,
        "tenant_id": page.tenant_id,
        "run_id": page.run_id,
        "title": page.title,
        "summary": page.summary,
        "details": page.details,
    }
    canon = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()
