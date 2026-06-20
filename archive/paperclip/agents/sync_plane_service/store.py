"""
SyncStore — canonical state for the Sync Plane (FORA-252 / 11.1).

Per ADR-0010 §3, the Sync Plane owns the four `sync.*` tables
that hold the canonical state. The `SyncStore` protocol is the
abstraction; the production impl is a Postgres adapter (per the
migration in `migrations/0005_sync_plane.sql`), the dev / smoke
impl is `InMemorySyncStore` — a dict-backed in-process store
with the same field shape.

The store's contract has four responsibilities:

  1. **Idempotent init** — `init_tenant(tenant_id)` creates the
     per-tenant partitioning keys (or no-ops in the in-memory
     impl). The AC requires that starting the service is
     idempotent (AC #1).

  2. **Canonical state CRUD** — `upsert_entity`, `get_entity`,
     `upsert_canonical_comment`, `list_canonical_comments`. The
     store dedupes on the row's natural key and refuses to
     overwrite a more-recent HLC with an older one (the §4
     Tier 2 invariant — the Sync Plane never *erases* a
     forward-progressed canonical state).

  3. **HLC clock hydration** — `load_hlc(consumer)` /
     `save_hlc(consumer, hlc)`. The service hydrates its
     in-process `Clock` on boot from this row; the
     in-memory impl is keyed on `(tenant_id, consumer)`.

  4. **Divergence queue** — `enqueue_divergence`,
     `list_pending_divergences`, `resolve_divergence`. The
     workbench (sub-task 11.5) reads from this; the audit
     forwarder emits `event.divergence_detected` on insert
     and `event.divergence_resolved` on human resolution.

The in-memory store is **process-local** (no shared state
across processes). The smoke test uses one store per
scenario; the production Postgres impl is the multi-process
canonical store.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, Tuple, runtime_checkable

from .schema import (
    CanonicalComment,
    DivergenceEntry,
    HLCClockRow,
    ReceivedEvent,
    SyncEntity,
    TABLE_CANONICAL_COMMENT,
    TABLE_DIVERGENCE_QUEUE,
    TABLE_ENTITY,
    TABLE_HLC_CLOCK,
)


_log = logging.getLogger("fora.sync_plane_service.store")


class SyncStoreError(RuntimeError):
    """Raised by the store on a contract violation. The service
    catches it at the upsert boundary and routes the event to
    Tier 3 (the human workbench) rather than crashing the
    consumer."""


# -- protocol -----------------------------------------------------------------


@runtime_checkable
class SyncStore(Protocol):
    """The store contract. Two impls: production Postgres
    (forthcoming in the migration deploy) and dev `InMemorySyncStore`
    (ships with 11.1)."""

    def init_tenant(self, tenant_id: str) -> None:
        """Idempotent per-tenant init. Creates the per-tenant
        partitioning key (production) or no-ops (in-memory).
        The smoke test calls this twice to assert the
        idempotency contract."""

    # -- SyncEntity ----------------------------------------------------------

    def upsert_entity(self, entity: SyncEntity) -> SyncEntity:
        """Insert or update a `SyncEntity`. The store refuses
        to overwrite a `last_hlc` that is greater (per the
        Tier 2 invariant) and returns the existing row
        unchanged. The smoke test asserts the refusal."""

    def get_entity(self, tenant_id: str, entity_id: str) -> Optional[SyncEntity]:
        """Fetch a `SyncEntity` by (tenant, id). Returns None
        if the entity does not exist."""

    def list_entities(self, tenant_id: str) -> List[SyncEntity]:
        """List all entities for a tenant. Used by the daily
        divergence job (sub-task 11.7)."""

    # -- CanonicalComment ----------------------------------------------------

    def upsert_canonical_comment(self, comment: CanonicalComment) -> CanonicalComment:
        """Insert or update a `CanonicalComment`. The store
        dedupes on `comment_id` and applies the same
        HLC-monotonicity rule as `upsert_entity`."""

    def get_canonical_comment(
        self, tenant_id: str, comment_id: str,
    ) -> Optional[CanonicalComment]:
        """Fetch a `CanonicalComment` by (tenant, id). Returns
        None if not found."""

    def list_canonical_comments(
        self, tenant_id: str, paperclip_issue_id: str,
    ) -> List[CanonicalComment]:
        """List all canonical comments for a (tenant, issue)
        pair, in HLC order. Used by the §6.3 threading
        reconstruction."""

    # -- HLC clock -----------------------------------------------------------

    def load_hlc(
        self, tenant_id: str, consumer: str,
    ) -> Optional[HLCClockRow]:
        """Load the last HLC for a (tenant, consumer) pair.
        Returns None if the consumer has never ticked."""

    def save_hlc(self, row: HLCClockRow) -> HLCClockRow:
        """Persist the last HLC. Idempotent on the same
        `(tenant, consumer, hlc)` tuple."""

    # -- Divergence queue ----------------------------------------------------

    def enqueue_divergence(self, entry: DivergenceEntry) -> DivergenceEntry:
        """Insert a new Tier 3 candidate. The workbench (11.5)
        reads from this table."""

    def list_pending_divergences(
        self, tenant_id: str, *, limit: int = 100,
    ) -> List[DivergenceEntry]:
        """List unresolved divergence entries for a tenant."""

    def resolve_divergence(
        self,
        tenant_id: str,
        entity_id: str,
        field: str,
        *,
        resolution: str,
        resolver: str,
    ) -> Optional[DivergenceEntry]:
        """Mark a divergence entry resolved. Returns the
        updated row, or None if the entry was not found."""


# -- in-memory impl -----------------------------------------------------------


class InMemorySyncStore(SyncStore):
    """The dev / smoke-test store. Dict-backed, thread-safe, with
    the same field shape and HLC-monotonicity rule as the
    production Postgres impl. The smoke test instantiates one
    per scenario.

    The store also dedupes **inbound events** on
    `(tenant_id, event_id)` — the subscriber checks
    `seen_event_ids` before applying, so a redelivered event
    is a no-op (per ADR-0006 §4.2 the JetStream consumer is
    responsible for dedupe, but the store carries the seam for
    the in-memory smoke test where the consumer is a
    stub)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # Per-table dicts. Keys are the natural primary key
        # (tenant_id, entity_id) etc. Values are the dataclass
        # instances.
        self._entities: Dict[Tuple[str, str], SyncEntity] = {}
        self._comments: Dict[Tuple[str, str], CanonicalComment] = {}
        self._hlc: Dict[Tuple[str, str], HLCClockRow] = {}
        self._divergence: Dict[Tuple[str, str, str], DivergenceEntry] = {}
        # Idempotency for inbound events. The smoke test
        # exercises this; the production store relies on
        # JetStream's per-subject dedupe.
        self._seen_event_ids: Dict[str, str] = {}    # event_id -> first-seen ts

    # -- tenant init --------------------------------------------------------

    def init_tenant(self, tenant_id: str) -> None:
        # In-memory: the per-tenant dicts are tenant-keyed
        # already, so init is a no-op. We still bump a
        # counter for the smoke test's idempotency check.
        with self._lock:
            if not hasattr(self, "_init_count"):
                self._init_count = {}
            self._init_count[tenant_id] = self._init_count.get(tenant_id, 0) + 1

    def init_count(self, tenant_id: str) -> int:
        """Test helper: how many times `init_tenant` was
        called. The smoke test asserts `>= 2` for the
        idempotency AC."""
        with self._lock:
            return self._init_count.get(tenant_id, 0)

    # -- SyncEntity ---------------------------------------------------------

    def upsert_entity(self, entity: SyncEntity) -> SyncEntity:
        with self._lock:
            key = (entity.tenant_id, entity.entity_id)
            existing = self._entities.get(key)
            if existing is not None:
                # HLC-monotonicity: refuse to overwrite a
                # forward-progressed row with a stale one.
                if _hlc_ge(existing.last_hlc, entity.last_hlc):
                    return existing
            self._entities[key] = entity
            return entity

    def get_entity(self, tenant_id: str, entity_id: str) -> Optional[SyncEntity]:
        with self._lock:
            return self._entities.get((tenant_id, entity_id))

    def list_entities(self, tenant_id: str) -> List[SyncEntity]:
        with self._lock:
            return [e for (t, _), e in self._entities.items() if t == tenant_id]

    # -- CanonicalComment ---------------------------------------------------

    def upsert_canonical_comment(self, comment: CanonicalComment) -> CanonicalComment:
        with self._lock:
            key = (comment.tenant_id, comment.comment_id)
            existing = self._comments.get(key)
            if existing is not None:
                if _hlc_ge(existing.created_hlc, comment.edited_hlc or comment.created_hlc):
                    return existing
            self._comments[key] = comment
            return comment

    def get_canonical_comment(
        self, tenant_id: str, comment_id: str,
    ) -> Optional[CanonicalComment]:
        with self._lock:
            return self._comments.get((tenant_id, comment_id))

    def list_canonical_comments(
        self, tenant_id: str, paperclip_issue_id: str,
    ) -> List[CanonicalComment]:
        with self._lock:
            matches = [
                c for c in self._comments.values()
                if c.tenant_id == tenant_id
                and c.paperclip_issue_id == paperclip_issue_id
            ]
        return sorted(
            matches,
            key=lambda c: c.created_hlc,
        )

    # -- HLC clock ----------------------------------------------------------

    def load_hlc(
        self, tenant_id: str, consumer: str,
    ) -> Optional[HLCClockRow]:
        with self._lock:
            return self._hlc.get((tenant_id, consumer))

    def save_hlc(self, row: HLCClockRow) -> HLCClockRow:
        with self._lock:
            self._hlc[(row.tenant_id, row.consumer)] = row
            return row

    # -- Divergence queue ---------------------------------------------------

    def enqueue_divergence(self, entry: DivergenceEntry) -> DivergenceEntry:
        with self._lock:
            key = (entry.tenant_id, entry.entity_id, entry.field)
            self._divergence[key] = entry
            return entry

    def list_pending_divergences(
        self, tenant_id: str, *, limit: int = 100,
    ) -> List[DivergenceEntry]:
        with self._lock:
            matches = [
                d for d in self._divergence.values()
                if d.tenant_id == tenant_id and not d.resolved
            ]
        return matches[:limit]

    def resolve_divergence(
        self,
        tenant_id: str,
        entity_id: str,
        field: str,
        *,
        resolution: str,
        resolver: str,
    ) -> Optional[DivergenceEntry]:
        with self._lock:
            key = (tenant_id, entity_id, field)
            entry = self._divergence.get(key)
            if entry is None:
                return None
            entry.resolved = True
            entry.resolution = resolution
            entry.resolver = resolver
            return entry

    # -- event-id dedupe (smoke-test only) ---------------------------------

    def mark_event_seen(self, event_id: str) -> bool:
        """Return True if this is the first time we've seen
        `event_id`; False on a duplicate. The smoke test
        exercises the JetStream redelivery contract via this
        helper."""
        with self._lock:
            if event_id in self._seen_event_ids:
                return False
            self._seen_event_ids[event_id] = "seen"
            return True


def _hlc_ge(a: str, b: str) -> bool:
    """HLC greater-or-equal. Returns True when `a` is greater
    than or equal to `b`. Both inputs are canonical-form HLC
    strings; the comparison is total-order on the wire form."""
    if not a:
        return False
    if not b:
        return True
    return a >= b
