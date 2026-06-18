"""
Per-tenant retention policy (FORA-36 deliverable, security baseline).

Defaults: 13 months hot, 7 years cold -- the SOC 2 expectation called
out in `memory/security.md §7`.  Per-tenant overrides come from
`audit.retention_policy` in the production store; in dev the policy
is a constant.

The sweep is a hook, not a hard delete.  `apply_retention(policy,
now)` walks the store and *appends* a synthetic `event_redacted`
event for any event that falls outside the policy; the event
body itself is retained until cold storage sweeps it.  This is
the "deletion is itself an audit record" acceptance criterion.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from dataclasses import dataclass
from typing import List, Optional

from .schema import AuditEvent, AuditEventType
from .store import AuditStore


_log = logging.getLogger("fora.audit.retention")


@dataclass(frozen=True)
class RetentionPolicy:
    """How long events live in hot storage.  The cold tier is the
    SOC 2 floor; the hot tier is the operational floor."""
    hot_days: int = 395        # 13 months
    cold_days: int = 2555      # 7 years

    def redact_before(self, now: dt.datetime) -> dt.datetime:
        """Return the cutoff timestamp: events strictly older than
        this are eligible for redaction (in dev) or for cold-tier
        archival (in production)."""
        return now - dt.timedelta(days=self.hot_days)


DEFAULT_RETENTION = RetentionPolicy()


def _build_redaction_synthetic(ev: AuditEvent, *, now: dt.datetime,
                               reason: str) -> AuditEvent:
    """Build the synthetic `event_redacted` event for `ev`.  The
    synthetic chains onto the same (tenant, run) pair so the head
    always advances.  Field names mirror the event it redacts
    except for `event_type` and `metadata`."""
    return AuditEvent(
        event_id=f"evt-redact-{uuid.uuid4().hex[:12]}",
        event_type=AuditEventType.EVENT_REDACTED,
        run_id=ev.run_id,
        agent_id=ev.agent_id,
        tenant_id=ev.tenant_id,
        stage=ev.stage,
        tool=ev.tool,
        input_digest=ev.input_digest,
        output_digest=ev.output_digest,
        cost_cents=ev.cost_cents,
        prompt_tokens=ev.prompt_tokens,
        completion_tokens=ev.completion_tokens,
        wall_ms=ev.wall_ms,
        call_id=ev.call_id,
        step_id=ev.step_id,
        idempotency_key=ev.idempotency_key,
        actor="system:retention",
        timestamp=now.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        metadata={
            "redactedEventId": ev.event_id,
            "redactionReason": reason,
        },
    )


def apply_retention(store: AuditStore,
                    policy: RetentionPolicy = DEFAULT_RETENTION,
                    *,
                    now: Optional[dt.datetime] = None,
                    reason: str = "retention_policy_expired") -> List[AuditEvent]:
    """Walk every event in `store` and apply the retention policy.
    Returns the list of synthetic `event_redacted` events that
    were appended.  Idempotent: re-running with the same `now`
    is a no-op once the synthetic events are in place because
    the sweep skips events it has already redacted.

    In dev (InMemoryStore) this is the only retention mechanism.
    In production this is the trigger that the PostgresStore +
    SQS layer subscribes to; the actual cold-tier archive is
    handled by the audit account's storage lifecycle, not by
    this code."""
    now = now or dt.datetime.now(dt.timezone.utc)
    cutoff = policy.redact_before(now)
    redacted: List[AuditEvent] = []
    for ev in store.all():
        # Skip events that are themselves retention actions or
        # admin overrides; redacting them would create a chain
        # of redacting-the-redaction.
        if ev.event_type in (AuditEventType.EVENT_REDACTED,
                             AuditEventType.ADMIN_OVERRIDE):
            continue
        try:
            ts = dt.datetime.strptime(ev.timestamp, "%Y-%m-%dT%H:%M:%S.%fZ")
        except ValueError:
            continue
        # The wire format is UTC; re-anchor to a tz-aware datetime
        # so we can compare against the tz-aware `cutoff`.
        ts = ts.replace(tzinfo=dt.timezone.utc)
        if ts >= cutoff:
            continue
        # Skip events that were already redacted by an earlier
        # sweep: their `redactedEventId` metadata will point to a
        # sibling that is already in the synthetic list, but the
        # simpler check is "does the store already carry an
        # event_redacted with this id as its target?"  Without a
        # fast index we walk; this is the dev path.
        already = any(
            other.event_type == AuditEventType.EVENT_REDACTED
            and other.metadata.get("redactedEventId") == ev.event_id
            for other in store.all()
        )
        if already:
            continue
        synth = _build_redaction_synthetic(ev, now=now, reason=reason)
        store.append(synth)
        redacted.append(synth)
    _log.info("retention_sweep redacted=%d cutoff=%s", len(redacted), cutoff.isoformat())
    return redacted

