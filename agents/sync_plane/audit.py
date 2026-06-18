"""
Audit row shape for the conflict resolver (ADR-0010 §8.1).

The audit forwarder (FORA-36) is the only writer of audit events;
the resolver builds the row shape and the runtime calls
`audit.emit_*()` to write it.  The shape here is the *event
payload* the forwarder consumes — the FORA-36 boundary that
hash-chains the event and routes it to the SOC 2 export is
unconcerned with the resolver's domain.

Per ADR-0010 §4 and §8.1:

  * `event.divergence_resolved` carries `winner_hlc`, `loser_hlc`,
    `reason`.  For Tier 2 LWW the reason is `hlc_lww`; for Tier 1
    the reason is `field_owner`.  For Tier 3 the reason is
    `clock_skew` and we also emit `event.clock_skew` separately.

The shapes are pure dataclasses (no I/O) so the smoke test can
assert the payload without spinning up a store.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict, dataclass
from dataclasses import field as dc_field
from typing import Any, Dict, Optional


# Event-type strings — match the §8.1 table verbatim.  Tests assert
# on the literal so a typo in either place fails fast.
DIVERGENCE_RESOLVED_EVENT = "sync.event.divergence_resolved"
# FORA-255 (Epic 11.5) — the human-resolution path emits this
# distinct from DIVERGENCE_RESOLVED_EVENT (the auto-resolved
# Tier-1 / Tier-2 / clock-skew path).  Carries reason=human_pick
# or reason=human_bulk and the metadata.queue_id FK back to
# sync.divergence_queue.
DIVERGENCE_RESOLVED_BY_HUMAN_EVENT = "sync.event.divergence_resolved_by_human"
CLOCK_SKEW_EVENT = "sync.event.clock_skew"
EVENT_RECEIVED = "sync.event.received"
EVENT_APPLIED = "sync.event.applied"
DIVERGENCE_DETECTED = "sync.event.divergence_detected"
PLATFORM_DEGRADED = "sync.platform.degraded"
BACKFILL_COMPLETED = "sync.backfill.completed"
COMMENT_ATTRIBUTION_WRITTEN = "sync.comment.attribution_written"
# Epic 11.7 (FORA-268) — the polling backstop emits this when the
# platform-side state disagrees with the Paperclip shadow log.
# Distinct from DIVERGENCE_DETECTED (a Tier-3 candidate from the
# resolver); shadow_drift is the QA-friendly "everything else
# caught" surface per Epic 11.7 §AC #2.  The 60-min unprocessed rule
# (FORA-36 alert wiring) keys off this event.
SHADOW_DRIFT_EVENT = "sync.shadow_drift"
# Epic 11.7 (FORA-257 + FORA-210) — the daily divergence detector
# (FORA-257 §7.2) emits this once per tenant per day, matching the
# FORA-204 AC #4 contract (daily audit sample, n=10 random runs,
# 100% completeness).  Distinct from the §8.1 sync.* events: this
# is a "sample_run_complete" summary emitted by the divergence
# detector (11.7), with `tool = "audit.daily_sample"` and a
# `metadata.sync.*` block summarising n, completeness, and any P0s.
# The P0 raised by the detector (R-SYNC-05) pages on-call within
# 5 min via the FORA-36 forwarder.
SAMPLE_RUN_COMPLETE_EVENT = "sample_run_complete"


@dataclass
class AuditRow:
    """The payload for one audit event, in the §8.1 shape.

    The production runtime stamps `event_id`, `prev_hash`, and
    `record_hash` via the FORA-36 audit forwarder; the resolver
    only fills in the §8.1 fields and the metadata blob.
    """
    event_type: str
    tenant_id: str
    actor: str                       # "agent:<id>" / "user:<id>" / "system:clock-monitor"
    timestamp: str = ""              # ISO 8601 UTC, stamped by emit if empty
    # Divergence fields (only populated for divergence_resolved)
    field: str = ""
    winner_platform: str = ""        # "paperclip" / "jira" / "github" / "clickup"
    loser_platform: str = ""
    winner_hlc: str = ""             # the canonical-form HLC string
    loser_hlc: str = ""
    reason: str = ""                 # "hlc_lww" / "field_owner" / "clock_skew"
    # Optional metadata (the resolver's domain)
    metadata: Dict[str, Any] = dc_field(default_factory=dict)
    # Filled by the FORA-36 forwarder, not the resolver
    event_id: str = ""
    prev_hash: str = ""
    record_hash: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def build_audit_row(
    *,
    event_type: str,
    tenant_id: str,
    actor: str,
    field: str = "",
    winner_platform: str = "",
    loser_platform: str = "",
    winner_hlc: str = "",
    loser_hlc: str = "",
    reason: str = "",
    metadata: Optional[Dict[str, Any]] = None,
) -> AuditRow:
    """Build a §8.1 audit row.  Pure factory; no I/O."""
    if event_type not in {
        DIVERGENCE_RESOLVED_EVENT,
        DIVERGENCE_RESOLVED_BY_HUMAN_EVENT,
        CLOCK_SKEW_EVENT,
        EVENT_RECEIVED,
        EVENT_APPLIED,
        DIVERGENCE_DETECTED,
        PLATFORM_DEGRADED,
        BACKFILL_COMPLETED,
        COMMENT_ATTRIBUTION_WRITTEN,
        SHADOW_DRIFT_EVENT,
        SAMPLE_RUN_COMPLETE_EVENT,
    }:
        raise ValueError(f"unknown event_type: {event_type!r}")
    if not tenant_id:
        raise ValueError("tenant_id is required")
    if not actor:
        raise ValueError("actor is required")
    if event_type == DIVERGENCE_RESOLVED_EVENT:
        if not (winner_hlc and reason):
            raise ValueError(
                "divergence_resolved requires winner_hlc and reason; "
                "loser_hlc is empty for the first-write (no prior canonical) "
                "case"
            )
    if event_type == DIVERGENCE_DETECTED:
        # Tier 3 detected a divergence but did not resolve it; winner_hlc
        # is empty (no winner chosen by the resolver).  loser_hlc and
        # reason are required to explain what triggered the diverge.
        if not (loser_hlc and reason):
            raise ValueError(
                "divergence_detected requires loser_hlc and reason"
            )
    if event_type == CLOCK_SKEW_EVENT and "skew_ms" not in (metadata or {}):
        raise ValueError("clock_skew requires metadata.skew_ms")
    return AuditRow(
        event_type=event_type,
        tenant_id=tenant_id,
        actor=actor,
        field=field,
        winner_platform=winner_platform,
        loser_platform=loser_platform,
        winner_hlc=winner_hlc,
        loser_hlc=loser_hlc,
        reason=reason,
        metadata=dict(metadata or {}),
    )


def digest_payload(row: AuditRow) -> str:
    """Stable SHA-256 of the §8.1 payload (excluding the chain head
    fields).  The FORA-36 audit forwarder uses this to build the
    `record_hash`; the resolver uses it for the §AC #6 smoke test
    that asserts the audit row exists and is reproducible."""
    payload = {
        "event_type": row.event_type,
        "tenant_id": row.tenant_id,
        "actor": row.actor,
        "field": row.field,
        "winner_platform": row.winner_platform,
        "loser_platform": row.loser_platform,
        "winner_hlc": row.winner_hlc,
        "loser_hlc": row.loser_hlc,
        "reason": row.reason,
        "metadata": row.metadata,
    }
    canon = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()
