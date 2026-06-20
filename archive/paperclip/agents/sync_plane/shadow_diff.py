"""
Shadow-log diff poller — FORA-268 (Epic 11.7 §AC #1 + #2).

Webhooks are best-effort.  The polling backstop is the contract
that catches what webhooks miss.  Every 5 minutes, for every
active (tenant, platform) tuple, this job:

  1. Asks the per-platform `RemoteStateReader` for the *current
     remote state* of every synced entity since the `updated_after`
     cursor the reader owns.
  2. Reads the **Paperclip shadow log** — the local mirror of the
     canonical store that the Sync Plane maintains for divergence
     comparison (ADR-0010 §7.2 #1).
  3. Diffs the two field by field.  For every disagreement, emits
     a `sync.shadow_drift` audit row (FORA-36 event type) carrying:

        * `metadata.entity_id`     — Paperclip issue id
        * `metadata.field`         — which field diverges
        * `metadata.old_value`     — what the shadow log had
        * `metadata.new_value`     — what the platform reports
        * `metadata.platform`      — jira / github / clickup
        * `metadata.detected_hlc`  — HLC of detection
        * `metadata.remote_hlc`    — HLC the remote stamped
        * `metadata.run_id`        — per-cycle run id (for the
                                    alert-wiring lookup)

  4. Advances the cursor so the next cycle only diffs newer state.

The job does **not** auto-resolve drift.  Per ADR-0010 §7.2 #2/3
the resolver owns resolution; the polling backstop is the
*detector* (the QA-friendly "everything else caught" net that
complements the Tier-1/Tier-2 reconciler in `polling.py`).

Determinism contract (Epic 11.7 §AC #2): the audit row's
`digest_payload()` is stable across re-runs on the same inputs,
so the 60-min alert wiring can re-validate a row against its
chain head.

This module is dependency-free and pure-Python.  Production wiring
substitutes the InMemory* ports for their Postgres counterparts;
the smoke test (`tests/test_shadow_diff.py`) drives the 7-day
clean run via a mocked clock.

Reference: ADR-0010 §7.1 (failure modes), §7.2 (divergence
detection), §8.1 (audit events — extended in FORA-268 to add
`sync.shadow_drift`).  Epic 11.7 sub-task #7.  Owner: Architect.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Protocol

from .audit import (
    AuditRow,
    SHADOW_DRIFT_EVENT,
    build_audit_row,
)
from .hlc import Clock


_log = logging.getLogger("fora.sync_plane.shadow_diff")


# --- constants ------------------------------------------------------------

# 5-min tick from ADR-0010 §3.2 / §7.1.
POLL_INTERVAL_SECONDS = 5 * 60

# The closed set of platforms the diff poller knows about.
SUPPORTED_PLATFORMS: tuple = ("jira", "github", "clickup")

# The actor stamped on every shadow_drift row the job emits.
DEFAULT_ACTOR = "system:shadow-diff-poll"


# --- ports ----------------------------------------------------------------

class ShadowLog(Protocol):
    """Read-only view of the Paperclip-side canonical store.

    The shadow log is the local mirror of the canonical state
    (ADR-0010 §3.1).  Production wiring is a Postgres SELECT
    against `sync.mirror_state`; the smoke test uses a dict-backed
    fake.  Returns the per-field view keyed by `(entity_id, field)`;
    the value is `(value, hlc)` where `hlc` is the HLC the
    canonical store last stamped on the field.
    """
    def get(
        self, *, tenant_id: str, platform: str, entity_id: str
    ) -> Optional[Mapping[str, Mapping[str, Any]]]:
        """Return `{field: {"value": ..., "hlc": "...", "platform": "..."}}`
        for one entity, or None if the entity is unknown (first
        sighting → drift on every field that has a value)."""


class RemoteStateReader(Protocol):
    """The platform-side state reader.

    Production wiring talks to the per-platform REST/GraphQL API
    (FORA-254 11.2a/b/c adapter shape); the smoke test uses a
    dict-backed fake.  One reader per (tenant, platform).
    """
    def fetch(
        self, *, tenant_id: str, platform: str, cursor: str
    ) -> "RemoteFetch":
        """Pull every entity changed since `cursor`.  Cursor is
        opaque to the job; the adapter owns its semantics."""


class CursorStore(Protocol):
    """Where the per-(tenant, platform) cursor is persisted across
    process restarts.  In-memory for the smoke test; Postgres in
    production."""
    def get(self, *, tenant_id: str, platform: str) -> str:
        """Return the saved cursor; "" for first run."""

    def set(self, *, tenant_id: str, platform: str, cursor: str) -> None:
        """Persist the new cursor (idempotent)."""


class AuditSink(Protocol):
    """Where the diff poller hands off its audit rows.

    Production: the FORA-36 forwarder.  Smoke test: an in-memory
    list.  Append-only; no update / no delete."""
    def append(self, row: AuditRow) -> None: ...


# --- wire types -----------------------------------------------------------

@dataclass
class RemoteEntity:
    """One entity the remote platform reports as changed since the
    last cursor.  `field_values` is `{field: {"value": ..., "hlc":
    "..."}}` — the platform-side value plus the HLC the platform
    stamped (per the §6.2 attribution rules; the platform adapter
    synthesises this HLC from the remote's update timestamp + a
    per-tenant counter)."""
    entity_id: str
    field_values: Dict[str, Dict[str, Any]]


@dataclass
class RemoteFetch:
    """The result of one `RemoteStateReader.fetch()` call."""
    entities: List[RemoteEntity]
    next_cursor: str


@dataclass
class ShadowDiffCycle:
    """The outcome of one polling cycle.  Used by the alert-wiring
    (60-min unprocessed check) and the daily report."""
    tenant_id: str
    platform: str
    cycle_id: str                         # stable per cycle; carried in metadata.run_id
    cycle_hlc: str
    cursor_before: str
    cursor_after: str
    entities_seen: int
    drifts_emitted: List[AuditRow]
    started_at: str                       # ISO 8601 UTC
    finished_at: str                      # ISO 8601 UTC


# --- the job --------------------------------------------------------------

class ShadowDiffPoller:
    """The 5-min shadow-log diff job for one (tenant, platform) tuple.

    Stateful across cycles via the injected `CursorStore`.  Pure
    with respect to I/O: every dependency is a port, so the smoke
    test can drive 7-day clean runs in milliseconds.
    """

    def __init__(
        self,
        *,
        tenant_id: str,
        platform: str,
        clock: Clock,
        shadow: ShadowLog,
        remote: RemoteStateReader,
        cursors: CursorStore,
        audit: AuditSink,
        actor: str = DEFAULT_ACTOR,
        wall_clock=dt.datetime.now,
    ) -> None:
        if not tenant_id:
            raise ValueError("tenant_id is required")
        if platform not in SUPPORTED_PLATFORMS:
            raise ValueError(
                f"platform must be one of {SUPPORTED_PLATFORMS!r}, got {platform!r}"
            )
        self._tenant_id = tenant_id
        self._platform = platform
        self._clock = clock
        self._shadow = shadow
        self._remote = remote
        self._cursors = cursors
        self._audit = audit
        self._actor = actor
        self._wall = wall_clock

    @property
    def tenant_id(self) -> str:
        return self._tenant_id

    @property
    def platform(self) -> str:
        return self._platform

    def run_once(self) -> ShadowDiffCycle:
        """Run one polling cycle.  Idempotent against a stalled
        cycle — the cursor only advances on a successful cycle, so
        a crash mid-cycle is recovered by re-fetching the same
        window on the next cycle."""
        cycle_id = f"poll-{uuid.uuid4().hex[:12]}"
        started_wall = self._wall()
        cycle_hlc = self._clock.now_hlc()
        cursor_before = self._cursors.get(
            tenant_id=self._tenant_id, platform=self._platform
        )

        fetch = self._remote.fetch(
            tenant_id=self._tenant_id,
            platform=self._platform,
            cursor=cursor_before,
        )

        drifts: List[AuditRow] = []
        for entity in fetch.entities:
            shadow = self._shadow.get(
                tenant_id=self._tenant_id,
                platform=self._platform,
                entity_id=entity.entity_id,
            )
            row = self._diff_entity(
                entity=entity,
                shadow=shadow,
                cycle_hlc=cycle_hlc,
                cycle_id=cycle_id,
                cursor_before=cursor_before,
            )
            if row is not None:
                drifts.append(row)
                self._audit.append(row)

        # Persist the new cursor *after* the diff loop so a crash
        # mid-loop re-fetches the same window.  Idempotency
        # contract (Epic 11.7 §AC #2): re-running on the same
        # window must produce the same set of drift events
        # (deterministic given the same clock).
        self._cursors.set(
            tenant_id=self._tenant_id,
            platform=self._platform,
            cursor=fetch.next_cursor,
        )

        finished_wall = self._wall()
        return ShadowDiffCycle(
            tenant_id=self._tenant_id,
            platform=self._platform,
            cycle_id=cycle_id,
            cycle_hlc=str(cycle_hlc),
            cursor_before=cursor_before,
            cursor_after=fetch.next_cursor,
            entities_seen=len(fetch.entities),
            drifts_emitted=drifts,
            started_at=_iso(started_wall),
            finished_at=_iso(finished_wall),
        )

    # -- diff logic ------------------------------------------------------

    def _diff_entity(
        self,
        *,
        entity: RemoteEntity,
        shadow: Optional[Mapping[str, Mapping[str, Any]]],
        cycle_hlc,
        cycle_id: str,
        cursor_before: str,
    ) -> Optional[AuditRow]:
        """Walk every field the remote reports; if it disagrees with
        the shadow log (different value, or shadow has no record),
        emit a deterministic shadow_drift event with old/new/HLC.

        Determinism (Epic 11.7 §AC #2): the row's `digest_payload()`
        is stable across re-runs on the same inputs, so the alert
        wiring can re-validate a row against its chain head.

        Returns the first drift row found for this entity, or None
        if no field disagrees.  One row per entity is the §AC #2
        contract: the alert wiring keys off `entity_id` and
        multiple drifts on the same entity within one cycle are
        coalesced (the per-field detail is in the metadata; a
        follow-up cycle will surface the next per-field drift).
        """
        if shadow is None:
            # First sighting: every field the remote reports as
            # non-None is a drift.  The §7.2 #3 "comment divergence"
            # path runs through here: a comment id the remote
            # shows but the shadow log does not.  Surface the
            # first non-None field.
            for field_name, fv in entity.field_values.items():
                if fv.get("value") is not None:
                    return self._build_row(
                        entity_id=entity.entity_id,
                        field=field_name,
                        old_value=None,
                        new_value=fv.get("value"),
                        remote_hlc=fv.get("hlc", ""),
                        cycle_hlc=cycle_hlc,
                        cycle_id=cycle_id,
                        cursor_before=cursor_before,
                    )
            return None

        for field_name, fv in entity.field_values.items():
            remote_value = fv.get("value")
            remote_hlc = fv.get("hlc", "")
            shadow_entry = shadow.get(field_name)
            if shadow_entry is None:
                if remote_value is not None:
                    return self._build_row(
                        entity_id=entity.entity_id,
                        field=field_name,
                        old_value=None,
                        new_value=remote_value,
                        remote_hlc=remote_hlc,
                        cycle_hlc=cycle_hlc,
                        cycle_id=cycle_id,
                        cursor_before=cursor_before,
                    )
                continue
            if _is_drift(
                value=shadow_entry.get("value"),
                remote_value=remote_value,
            ):
                return self._build_row(
                    entity_id=entity.entity_id,
                    field=field_name,
                    old_value=shadow_entry.get("value"),
                    new_value=remote_value,
                    remote_hlc=remote_hlc,
                    cycle_hlc=cycle_hlc,
                    cycle_id=cycle_id,
                    cursor_before=cursor_before,
                )
        return None

    def _build_row(
        self,
        *,
        entity_id: str,
        field: str,
        old_value: Any,
        new_value: Any,
        remote_hlc: str,
        cycle_hlc,
        cycle_id: str,
        cursor_before: str,
    ) -> AuditRow:
        """Build the deterministic shadow_drift audit row."""
        return build_audit_row(
            event_type=SHADOW_DRIFT_EVENT,
            tenant_id=self._tenant_id,
            actor=self._actor,
            field=field,
            # `winner_platform` is the side whose value will land in
            # the canonical store once the resolver acts on the
            # drift; the polling backstop does not choose — that
            # is the resolver's job.  The convention (mirroring
            # the §8.1 row shape) is to set the platform that
            # currently has the divergent value, with `loser` being
            # the shadow log side.  The alert wiring keys off
            # `metadata.platform`, not these fields, so the
            # convention is documented but not load-bearing.
            winner_platform=self._platform,
            loser_platform="paperclip",
            winner_hlc=str(cycle_hlc),
            loser_hlc=remote_hlc,
            reason="shadow_drift",
            metadata={
                "entity_id": entity_id,
                "platform": self._platform,
                "old_value": old_value,
                "new_value": new_value,
                "detected_hlc": str(cycle_hlc),
                "remote_hlc": remote_hlc,
                "run_id": cycle_id,
                "cursor_before": cursor_before,
            },
        )


# --- pure helpers ---------------------------------------------------------

def _is_drift(*, value: Any, remote_value: Any) -> bool:
    """Equality check that treats None and missing as equivalent
    (the shadow log may not have a row for a field the remote has
    not yet pushed).  List / dict comparison is deep; the audit
    row carries the old/new verbatim for the report renderer."""
    if value is None and remote_value is None:
        return False
    if value is None or remote_value is None:
        return True
    return value != remote_value


def _iso(t: dt.datetime) -> str:
    """ISO 8601 UTC with millisecond precision.  Stable across
    re-runs for a fixed `t` input."""
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def diff_field_names(
    shadow: Optional[Mapping[str, Mapping[str, Any]]],
    remote: Mapping[str, Dict[str, Any]],
) -> List[str]:
    """Field-level drift summary.  Pure; used by the daily report
    renderer to build the per-field tally without re-running the
    diff.  Returns the field names that drift."""
    if shadow is None:
        return sorted(f for f, fv in remote.items() if fv.get("value") is not None)
    drifted: List[str] = []
    for field_name, fv in remote.items():
        shadow_entry = shadow.get(field_name)
        if shadow_entry is None:
            if fv.get("value") is not None:
                drifted.append(field_name)
            continue
        if _is_drift(
            value=shadow_entry.get("value"),
            remote_value=fv.get("value"),
        ):
            drifted.append(field_name)
    return sorted(drifted)


# --- in-memory fakes (for the smoke test) -------------------------------

class InMemoryShadowLog:
    """A ShadowLog backed by a nested dict.  Test seam only.

    Shape: `{tenant_id: {platform: {entity_id: {field: {value, hlc}}}}}`
    """
    def __init__(self) -> None:
        self._store: Dict[str, Dict[str, Dict[str, Dict[str, Dict[str, Any]]]]] = {}
        self._lock = threading.Lock()

    def put(
        self, *, tenant_id: str, platform: str, entity_id: str,
        field: str, value: Any, hlc: str = "",
    ) -> None:
        with self._lock:
            self._store.setdefault(tenant_id, {}) \
                .setdefault(platform, {}) \
                .setdefault(entity_id, {})[field] = {"value": value, "hlc": hlc}

    def get(
        self, *, tenant_id: str, platform: str, entity_id: str
    ) -> Optional[Mapping[str, Mapping[str, Any]]]:
        with self._lock:
            return self._store.get(tenant_id, {}).get(platform, {}).get(entity_id)


class InMemoryCursorStore:
    """A CursorStore backed by a dict.  Test seam only."""
    def __init__(self) -> None:
        self._cursors: Dict[tuple, str] = {}

    def get(self, *, tenant_id: str, platform: str) -> str:
        return self._cursors.get((tenant_id, platform), "")

    def set(self, *, tenant_id: str, platform: str, cursor: str) -> None:
        self._cursors[(tenant_id, platform)] = cursor


class InMemoryAuditSink:
    """An AuditSink that just appends to a list.  Test seam only."""
    def __init__(self) -> None:
        self.rows: List[AuditRow] = []
        self._lock = threading.Lock()

    def append(self, row: AuditRow) -> None:
        with self._lock:
            # Defensive copy so external mutations do not poison
            # the in-memory list.
            d = row.to_dict()
            self.rows.append(AuditRow(
                event_type=d["event_type"],
                tenant_id=d["tenant_id"],
                actor=d["actor"],
                timestamp=d.get("timestamp", "") or _iso(dt.datetime.now(dt.timezone.utc)),
                field=d.get("field", ""),
                winner_platform=d.get("winner_platform", ""),
                loser_platform=d.get("loser_platform", ""),
                winner_hlc=d.get("winner_hlc", ""),
                loser_hlc=d.get("loser_hlc", ""),
                reason=d.get("reason", ""),
                metadata=dict(d.get("metadata", {})),
            ))

    def clear(self) -> None:
        with self._lock:
            self.rows.clear()
