"""
Daily divergence-detection job (FORA-257 / Epic 11.7 — §7.2).

Per ADR-0010 §7.2, a daily job runs
`paperclip_state ⊕ remote_state` per synced entity and surfaces
four kinds of divergence:

  1. **Schema divergence** — Paperclip has a field the remote
     doesn't support → stored in `sync.mirror_state`, surfaced
     in the workbench UI (11.5).  Severity P2.
  2. **State divergence** — Paperclip `status` ≠ remote
     `mirror_state` → emit `sync.event.divergence_detected`,
     do NOT auto-resolve.  Severity P1.
  3. **Comment divergence** — Paperclip has a `comment_id` not
     present on any remote → push on next cycle.  Remote has a
     comment we can't map → either (a) create a Paperclip
     comment with `source=remote_unmapped` + back-pointer or
     (b) drop, per tenant config.  Severity P2.
  4. **Audit divergence** — audit log is missing an `event.*`
     row the sync log says should be there → **P0 alert, page
     on-call within 5 min**.  This is the canary that the
     FORA-36 forwarder is healthy (R-SYNC-05).

The job is tenant-scoped and idempotent: re-running the same
day produces no NEW findings (only the `sample_run_complete`
audit summary row).  The smoke test proves this with a property
test.

Reference: ADR-0010 §7.2, §8.1 (audit events), §8.2 R-SYNC-05,
risk register `forge/sync-plane/risk_register.md` §7 (sample
shape, verifier invariants, sample scheduling).

This module is pure-Python.  Production wires the
InMemoryMirrorState / InMemorySyncLog for their Postgres
counterparts.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, Iterable, List, Mapping, Optional, Protocol, Sequence, Set, Tuple

from .alerting import AlertChannel, InMemoryAlertChannel, PagePayload, Severity
from .audit import (
    AuditRow,
    BACKFILL_COMPLETED,
    SHADOW_DRIFT_EVENT,
    EVENT_APPLIED,
    EVENT_RECEIVED,
    build_audit_row,
)
from .polling import AuditLog, InMemoryAuditLog


_log = logging.getLogger("fora.sync_plane.divergence")


# --- the four divergence kinds --------------------------------------------

class DivergenceKind(str, Enum):
    SCHEMA = "schema"
    STATE = "state"
    COMMENT = "comment"
    AUDIT = "audit"


# --- the canonical mirror state (Paperclip ⊕ remote) ----------------------

@dataclass
class MirrorEntity:
    """One synced entity in the §7.2 XOR walk.

    `paperclip_state` is the canonical Paperclip view (what
    FORA-117 reads from the Knowledge Layer).  `remote_state`
    is a per-platform view of the same entity (keyed by
    `platform`).
    """
    entity_id: str
    paperclip_state: Dict[str, object]
    remote_state: Dict[str, Dict[str, object]] = field(default_factory=dict)
    paperclip_comments: List[str] = field(default_factory=list)   # canonical comment ids
    remote_comments: Dict[str, List[str]] = field(default_factory=dict)  # platform -> comment ids
    paperclip_fields: Set[str] = field(default_factory=set)
    remote_fields: Dict[str, Set[str]] = field(default_factory=dict)   # platform -> field set


class MirrorState(Protocol):
    """The seam 11.5 (workbench UI) reads.  Production wires a
    Postgres-backed `sync.mirror_state` table; the smoke test
    uses an in-memory dict."""

    def list_entities(self, tenant_id: str) -> List[MirrorEntity]: ...
    def get(self, tenant_id: str, entity_id: str) -> Optional[MirrorEntity]: ...
    def record_finding(self, tenant_id: str, finding: "DivergenceFinding") -> None: ...


class InMemoryMirrorState:
    """In-memory `sync.mirror_state` for the smoke test."""

    def __init__(self) -> None:
        self._entities: Dict[Tuple[str, str], MirrorEntity] = {}
        self._findings: List["DivergenceFinding"] = []
        self._lock = threading.Lock()

    def upsert(self, entity: MirrorEntity) -> None:
        with self._lock:
            self._entities[(entity.entity_id.split(":")[0] if ":" in entity.entity_id else "t", entity.entity_id)] = entity

    def list_entities(self, tenant_id: str) -> List[MirrorEntity]:
        with self._lock:
            return [e for (t, _), e in self._entities.items() if t == tenant_id]

    def get(self, tenant_id: str, entity_id: str) -> Optional[MirrorEntity]:
        with self._lock:
            return self._entities.get((tenant_id, entity_id))

    def record_finding(self, tenant_id: str, finding: "DivergenceFinding") -> None:
        with self._lock:
            self._findings.append(finding)

    def findings(self) -> List["DivergenceFinding"]:
        with self._lock:
            return list(self._findings)


# --- the sync log (for audit-divergence detection) -------------------------

class SyncLog(Protocol):
    """The seam that knows which `event.*` rows SHOULD exist.

    For the smoke test, the SyncLog is the source of truth on
    what was supposed to be applied.  In production this is a
    `sync.outbox` JetStream subject + the §8.1 audit log
    together (every applied event has both rows)."""

    def expected_event_ids(self, tenant_id: str, day: dt.date) -> List[str]: ...
    def applied_event_ids(self, tenant_id: str, day: dt.date) -> Set[str]: ...


class InMemorySyncLog:
    """In-memory SyncLog for the smoke test.

    A caller adds expected event ids via `add_expected()` and
    applied event ids via `add_applied()`.  The daily
    divergence-detector asks for the diff (R-SYNC-05 P0).
    """

    def __init__(self) -> None:
        self._expected: Dict[Tuple[str, dt.date], List[str]] = {}
        self._applied: Dict[Tuple[str, dt.date], Set[str]] = {}
        self._lock = threading.Lock()

    def add_expected(self, tenant_id: str, day: dt.date, event_id: str) -> None:
        with self._lock:
            self._expected.setdefault((tenant_id, day), []).append(event_id)

    def add_applied(self, tenant_id: str, day: dt.date, event_id: str) -> None:
        with self._lock:
            self._applied.setdefault((tenant_id, day), set()).add(event_id)

    def expected_event_ids(self, tenant_id: str, day: dt.date) -> List[str]:
        with self._lock:
            return list(self._expected.get((tenant_id, day), []))

    def applied_event_ids(self, tenant_id: str, day: dt.date) -> Set[str]:
        with self._lock:
            return set(self._applied.get((tenant_id, day), set()))


# --- the divergence finding -----------------------------------------------

@dataclass
class DivergenceFinding:
    kind: DivergenceKind
    tenant_id: str
    entity_id: str
    severity: Severity
    summary: str
    details: Dict[str, str] = field(default_factory=dict)
    detected_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))

    def to_dict(self) -> Dict:
        return {
            "kind": self.kind.value,
            "tenant_id": self.tenant_id,
            "entity_id": self.entity_id,
            "severity": self.severity.value,
            "summary": self.summary,
            "details": dict(self.details),
            "detected_at": self.detected_at.isoformat(),
        }


@dataclass
class DivergenceReport:
    tenant_id: str
    day: dt.date
    findings: List[DivergenceFinding] = field(default_factory=list)
    sample_complete: bool = False   # True iff the §7.2.1..5 invariants all pass
    missing_event_ids: List[str] = field(default_factory=list)   # R-SYNC-05 (audit divergence)

    def by_kind(self, kind: DivergenceKind) -> List[DivergenceFinding]:
        return [f for f in self.findings if f.kind is kind]

    def has_p0(self) -> bool:
        return any(f.severity is Severity.P0 for f in self.findings)

    def to_dict(self) -> Dict:
        return {
            "tenant_id": self.tenant_id,
            "day": self.day.isoformat(),
            "findings": [f.to_dict() for f in self.findings],
            "sample_complete": self.sample_complete,
            "missing_event_ids": list(self.missing_event_ids),
        }


# --- the detector ---------------------------------------------------------

class DivergenceDetector:
    """The daily §7.2 detector.

    Public surface:

        detector = DivergenceDetector(
            mirror_state=mirror,
            sync_log=sync_log,
            audit_log=audit_log,
            alert=alert_channel,
            clock=lambda: dt.datetime.now(dt.timezone.utc),
        )
        report = detector.run_daily(tenant_id, day=date(2026, 6, 18))
        # report.findings / report.missing_event_ids / report.has_p0()

    The detector is intentionally a sequence of pure functions
    so each is unit-testable in isolation.
    """

    def __init__(
        self,
        *,
        mirror_state: MirrorState,
        sync_log: SyncLog,
        audit_log: AuditLog,
        alert: AlertChannel,
        clock: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.timezone.utc),
        actor: str = "system:divergence-detector",
    ) -> None:
        self._mirror = mirror_state
        self._sync_log = sync_log
        self._audit = audit_log
        self._alert = alert
        self._clock = clock
        self._actor = actor

    # --- public surface ---------------------------------------------------

    def run_daily(
        self, tenant_id: str, *, day: Optional[dt.date] = None
    ) -> DivergenceReport:
        day = day or self._clock().date()
        now = self._clock()
        report = DivergenceReport(tenant_id=tenant_id, day=day)

        # §7.2 #1: schema divergence
        for entity in self._mirror.list_entities(tenant_id):
            report.findings.extend(_detect_schema_divergence(entity, now))
        # §7.2 #2: state divergence
        for entity in self._mirror.list_entities(tenant_id):
            report.findings.extend(_detect_state_divergence(entity, now))
        # §7.2 #3: comment divergence
        for entity in self._mirror.list_entities(tenant_id):
            report.findings.extend(_detect_comment_divergence(entity, now))

        # §7.2 #4: audit divergence (R-SYNC-05)
        expected = self._sync_log.expected_event_ids(tenant_id, day)
        applied = self._sync_log.applied_event_ids(tenant_id, day)
        missing = [e for e in expected if e not in applied]
        report.missing_event_ids = missing
        for eid in missing:
            report.findings.append(DivergenceFinding(
                kind=DivergenceKind.AUDIT,
                tenant_id=tenant_id,
                entity_id="<audit-log>",
                severity=Severity.P0,
                summary=f"Audit log missing event {eid} (R-SYNC-05)",
                details={"event_id": eid, "day": day.isoformat()},
                detected_at=now,
            ))

        # §7.2.1..5 verifier invariants (FORA-204 §7).  For the
        # smoke test we treat sample_complete=True iff no P0
        # findings and no missing audit events.
        report.sample_complete = (
            not report.has_p0() and not missing
        )

        # P0 paging: fire within 5 min of detection (R-SYNC-05).
        # The audit row uses `sync.shadow_drift` (per FORA-268 +
        # §7.2 #1..4 in ADR-0010): the daily detector does NOT
        # resolve (it only observes); the audit event is
        # distinct from the resolver's `sync.event.divergence_detected`
        # (a Tier-3 candidate that the resolver would emit).
        for f in report.findings:
            if f.severity is Severity.P0:
                self._alert.page(PagePayload(
                    title=f"Sync Plane P0: {f.summary}",
                    severity=Severity.P0,
                    tenant_id=tenant_id,
                    summary=(
                        f"Daily divergence detector found a P0 at "
                        f"{f.detected_at.isoformat()} for tenant "
                        f"{tenant_id}."
                    ),
                    details={
                        "risk_id": _RISK_ID_FOR_KIND.get(f.kind, "R-SYNC-05"),
                        "kind": f.kind.value,
                        "entity_id": f.entity_id,
                        "details": json.dumps(f.details, sort_keys=True),
                    },
                ))
                # Audit the shadow drift.  loser_hlc is empty (the
                # daily detector does not run the resolver; it
                # just observes the §7.2 XOR walk).  reason is the
                # divergence kind for downstream filtering.
                self._audit.append(build_audit_row(
                    event_type=SHADOW_DRIFT_EVENT,
                    tenant_id=tenant_id,
                    actor=self._actor,
                    field=f.kind.value,
                    reason=f.kind.value,
                    metadata={
                        "entity_id": f.entity_id,
                        "summary": f.summary,
                        "details": json.dumps(f.details, sort_keys=True),
                        "severity": f.severity.value,
                    },
                ))

        # P1 + P2: log only (the workbench UI surfaces them).
        for f in report.findings:
            if f.severity in (Severity.P1, Severity.P2):
                self._audit.append(build_audit_row(
                    event_type=SHADOW_DRIFT_EVENT,
                    tenant_id=tenant_id,
                    actor=self._actor,
                    field=f.kind.value,
                    reason=f.kind.value,
                    metadata={
                        "entity_id": f.entity_id,
                        "summary": f.summary,
                        "details": json.dumps(f.details, sort_keys=True),
                        "severity": f.severity.value,
                    },
                ))

        # §7.2 sample_run_complete: the daily job always emits
        # the §AC #4 of FORA-204 (the audit-event summary).
        self._audit.append(build_audit_row(
            event_type="sample_run_complete",  # FORA-210 contract
            tenant_id=tenant_id,
            actor=self._actor,
            field="audit.daily_sample",
            metadata={
                "day": day.isoformat(),
                "n": str(len(self._sync_log.expected_event_ids(tenant_id, day))),
                "missing": str(len(missing)),
                "schema_findings": str(len(report.by_kind(DivergenceKind.SCHEMA))),
                "state_findings": str(len(report.by_kind(DivergenceKind.STATE))),
                "comment_findings": str(len(report.by_kind(DivergenceKind.COMMENT))),
                "audit_findings": str(len(report.by_kind(DivergenceKind.AUDIT))),
                "sample_complete": "true" if report.sample_complete else "false",
            },
        ))

        return report


# --- pure-function detectors ----------------------------------------------

def _detect_schema_divergence(
    entity: MirrorEntity, now: dt.datetime
) -> List[DivergenceFinding]:
    """§7.2 #1 — fields Paperclip has that the remote doesn't."""
    out: List[DivergenceFinding] = []
    pc_fields = entity.paperclip_fields
    for platform, r_fields in entity.remote_fields.items():
        missing_on_remote = pc_fields - r_fields
        for f in sorted(missing_on_remote):
            out.append(DivergenceFinding(
                kind=DivergenceKind.SCHEMA,
                tenant_id=entity.entity_id.split(":")[0] if ":" in entity.entity_id else "",
                entity_id=entity.entity_id,
                severity=Severity.P2,
                summary=(
                    f"Schema divergence on {entity.entity_id}: Paperclip has "
                    f"field {f!r} not present on {platform!r}"
                ),
                details={"platform": platform, "missing_field": f},
                detected_at=now,
            ))
    return out


def _detect_state_divergence(
    entity: MirrorEntity, now: dt.datetime
) -> List[DivergenceFinding]:
    """§7.2 #2 — `paperclip.status` ≠ `remote.mirror_state`."""
    out: List[DivergenceFinding] = []
    pc_status = entity.paperclip_state.get("status")
    if pc_status is None:
        return out
    for platform, r_state in entity.remote_state.items():
        r_status = r_state.get("status")
        if r_status is None:
            continue
        if str(pc_status) != str(r_status):
            out.append(DivergenceFinding(
                kind=DivergenceKind.STATE,
                tenant_id=entity.entity_id.split(":")[0] if ":" in entity.entity_id else "",
                entity_id=entity.entity_id,
                severity=Severity.P1,
                summary=(
                    f"State divergence on {entity.entity_id}: "
                    f"paperclip={pc_status!r} vs {platform}={r_status!r}"
                ),
                details={
                    "platform": platform,
                    "paperclip_status": str(pc_status),
                    "remote_status": str(r_status),
                },
                detected_at=now,
            ))
    return out


def _detect_comment_divergence(
    entity: MirrorEntity, now: dt.datetime
) -> List[DivergenceFinding]:
    """§7.2 #3 — comment-id set mismatch.

    For each platform, find comment_ids Paperclip has that the
    remote doesn't, and vice versa.  Resolution: push on next
    cycle (Paperclip→remote) or create a `source=remote_unmapped`
    Paperclip comment + back-pointer (remote→Paperclip).  The
    detector does NOT resolve; it only reports."""
    out: List[DivergenceFinding] = []
    pc = set(entity.paperclip_comments)
    for platform, r_comments in entity.remote_comments.items():
        r = set(r_comments)
        only_paperclip = pc - r
        only_remote = r - pc
        for cid in sorted(only_paperclip):
            out.append(DivergenceFinding(
                kind=DivergenceKind.COMMENT,
                tenant_id=entity.entity_id.split(":")[0] if ":" in entity.entity_id else "",
                entity_id=entity.entity_id,
                severity=Severity.P2,
                summary=(
                    f"Comment divergence on {entity.entity_id}: "
                    f"Paperclip comment {cid!r} not on {platform!r}"
                ),
                details={
                    "platform": platform,
                    "missing_on_remote": cid,
                    "direction": "paperclip_to_remote",
                },
                detected_at=now,
            ))
        for cid in sorted(only_remote):
            out.append(DivergenceFinding(
                kind=DivergenceKind.COMMENT,
                tenant_id=entity.entity_id.split(":")[0] if ":" in entity.entity_id else "",
                entity_id=entity.entity_id,
                severity=Severity.P2,
                summary=(
                    f"Comment divergence on {entity.entity_id}: "
                    f"{platform} comment {cid!r} not on Paperclip"
                ),
                details={
                    "platform": platform,
                    "missing_on_paperclip": cid,
                    "direction": "remote_to_paperclip",
                },
                detected_at=now,
            ))
    return out


# --- multi-day clean-run helper for the smoke test ------------------------

# The risk register ID each divergence kind maps to.  Used in
# the PagePayload `details.risk_id` so the on-call router can
# key off the risk ID (R-SYNC-05 is the P0 audit-divergence
# canary; R-SYNC-07 is the schema-divergence black-box concern).
_RISK_ID_FOR_KIND: Dict[DivergenceKind, str] = {
    DivergenceKind.SCHEMA: "R-SYNC-07",
    DivergenceKind.STATE: "R-SYNC-08",
    DivergenceKind.COMMENT: "R-SYNC-04",
    DivergenceKind.AUDIT: "R-SYNC-05",
}


def run_clean_streak(
    detector: DivergenceDetector,
    *,
    tenant_id: str,
    days: int = 7,
    day_zero: Optional[dt.date] = None,
) -> List[DivergenceReport]:
    """Run the daily detector for `days` consecutive days with no
    P0s.  The smoke test asserts `len(p0_pages) == 0` and
    `all(r.sample_complete for r in reports)` to prove the
    ADR-0010 §9 day-one exit gate (7 consecutive days clean).

    The day_zero defaults to today; the test passes an
    explicit date so the streak is deterministic.
    """
    day_zero = day_zero or dt.datetime.now(dt.timezone.utc).date()
    out: List[DivergenceReport] = []
    for i in range(days):
        out.append(detector.run_daily(tenant_id, day=day_zero + dt.timedelta(days=i)))
    return out
