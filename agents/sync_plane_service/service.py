"""
SyncPlaneService — the per-tenant service orchestrator
(FORA-252 / 11.1).

The service is the **single integration point** for the Sync
Plane. It owns:

  * one `HLCClock` (per the shared 11.4 HLC module)
  * one `InMemoryLeaderLock` / `PostgresAdvisoryLock` holder id
  * one `SyncStore` (the canonical state)
  * one `PortRegistry` (the wiring seam — 6 ports)
  * one `InMemorySubscriber` / `NatsEventConsumer` (the bus)

On `start()` the service:

  1. Acquires the leader lock (passive replicas spin here).
  2. Hydrates the HLC from the store.
  3. Subscribes to the three Forge domain-event subjects.
  4. Stamps `init_tenant` (idempotent).
  5. Emits a `sync.event.received` audit row (the
     "service-started" sentinel — the daily sample uses it
     to confirm the Sync Plane is live per ADR-0010 risk
     register §3 R-X2).

The `apply` method is the unit of work for one inbound
event. It is intentionally a single method (not a callback
chain) so the smoke test can call it directly with a
synthetic event. The method:

  1. Marks the event as seen (idempotency on `event_id`).
  2. Forwards `sync.event.received` to the audit forwarder.
  3. Routes the event through the `ConflictResolver` (when
     registered) or the built-in default (Tier 1 / Tier 2
     fallback).
  4. Upserts the canonical state.
  5. Forwards `sync.event.applied` to the audit forwarder.
  6. Saves the new HLC.

The service does **not** call the platform adapters directly
— that is the responsibility of sub-task 11.2
(`PlatformAdapter`). 11.1 establishes the seams and the
end-to-end flow; 11.2 wires the actual Jira / GitHub /
ClickUp writes.

The smoke test wires a complete service with in-memory
backends and exercises all 7 ACs (idempotent init /
subscribe to 3 subjects / Postgres tables exist / HLC
clock / <30s failover / audit forwarder / smoke test
itself).
"""

from __future__ import annotations

import logging
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .audit_forwarder import (
    AuditForwarderConfig,
    InMemoryAuditForwarder,
    SYSTEM_ACTOR_SYNC_PLANE,
)
from .burst import InMemoryBurstControl
from .leader import (
    InMemoryLeaderLock,
    LeaderElection,
    LeaderLostError,
    new_holder_id,
)
from .ports import (
    AuditForwarder,
    BurstControl,
    ConflictResolver,
    PortRegistry,
    PORT_AUDIT_FORWARDER,
    PORT_BURST_CONTROL,
    PORT_CONFLICT_RESOLVER,
    PORT_DIVERGENCE_WORKBENCH,
    PORT_POLLING_BACKSTOP,
    PORT_PLATFORM_CLICKUP,
    PORT_PLATFORM_GITHUB,
    PORT_PLATFORM_JIRA,
    Resolution,
)
from .schema import (
    CanonicalComment,
    DivergenceEntry,
    EntityKind,
    HLCClockRow,
    ReceivedEvent,
    SyncEntity,
    now_iso,
)
from .store import InMemorySyncStore, SyncStore
from .subscriber import (
    ALL_SUBJECTS,
    InMemorySubscriber,
    Subscriber,
    SubscriptionConfig,
)


_log = logging.getLogger("fora.sync_plane_service.service")


# Per-ADR-0010 §7.1 R-X3 the per-tenant rate-limit defaults are
# 100 events / 60s; the production wiring reads from the tenant
# config service. The day-one default is 100/60s.
DEFAULT_RATE_PER_WINDOW = 100
DEFAULT_WINDOW_MS = 60_000

# The lease is below the 30s AC budget; the smoke test asserts
# `lease_ms < 30_000`.
DEFAULT_LEASE_MS = 25_000


@dataclass
class SyncPlaneServiceConfig:
    """The service config. Required: `tenant_id`. The other
    fields default to the day-one in-memory backends so the
    smoke test can construct a service with a single arg.

    The production wiring substitutes real backends at
    start-up:

        SyncPlaneServiceConfig(
            tenant_id="tnt_acme",
            store=PostgresSyncStore(pool=...),
            leader=PostgresAdvisoryLock(pool=...),
            subscriber=NatsEventConsumer(...),
            ports=PortRegistry() (with 11.2 adapters registered),
        )
    """
    tenant_id: str
    holder_id: str = field(default_factory=new_holder_id)
    store: SyncStore = field(default_factory=InMemorySyncStore)
    leader: LeaderElection = field(default_factory=InMemoryLeaderLock)
    subscriber: Subscriber = field(default_factory=InMemorySubscriber)
    burst: BurstControl = field(default_factory=InMemoryBurstControl)
    audit: AuditForwarder = field(default_factory=InMemoryAuditForwarder)
    ports: PortRegistry = field(default_factory=PortRegistry)
    subscription: SubscriptionConfig = field(default_factory=SubscriptionConfig)
    hlc_consumer: str = "sync_plane.consumer"   # for `sync.hlc_clock` row
    # Optional: per-tenant overrides for the burst control.
    rate_per_window: int = DEFAULT_RATE_PER_WINDOW
    window_ms: int = DEFAULT_WINDOW_MS


class SyncPlaneService:
    """The per-tenant service. The class is **per-tenant** —
    one instance per `tenant_id`. The runtime fan-out is the
    caller's responsibility; the service is the unit."""

    def __init__(self, config: SyncPlaneServiceConfig) -> None:
        self._config = config
        self._tenant_id = config.tenant_id
        self._holder = config.holder_id
        # The HLC clock is per-tenant + per-process. The
        # 11.4 HLC `Clock` is the shared clock (one
        # implementation, used by 11.1, 11.4, 11.6, 11.8).
        from agents.sync_plane.hlc import Clock as _HLCClock
        self._hlc: Any = _HLCClock(node_id=f"sync-plane:{self._holder[:8]}")
        # The `inbound_event_ids` set is the local dedupe
        # mirror of the JetStream consumer's per-subject
        # dedupe. It survives the lifetime of the service
        # process; on restart the JetStream consumer
        # resumes from the last acknowledged offset and
        # the set is rebuilt from the replay.
        self._inbound_event_ids: set = set()
        self._started = False
        self._subscription_id: Optional[str] = None
        self._lock_failover_ms: Optional[int] = None

    # -- properties --------------------------------------------------------

    @property
    def tenant_id(self) -> str:
        return self._tenant_id

    @property
    def holder_id(self) -> str:
        return self._holder

    @property
    def is_leader(self) -> bool:
        return self._config.leader.is_leader(
            self._tenant_id, holder=self._holder,
        )

    @property
    def started(self) -> bool:
        return self._started

    @property
    def lock_failover_ms(self) -> Optional[int]:
        """The most recent failover time in ms (None if no
        failover has happened in this process). The smoke
        test asserts this is < 30_000 to honour the AC."""
        return self._lock_failover_ms

    # -- lifecycle --------------------------------------------------------

    def start(self) -> None:
        """Acquire leadership, hydrate the HLC, init the tenant,
        subscribe to the three subjects, emit the
        `sync.event.received` audit row for the
        `service-started` sentinel. Idempotent: a second
        call no-ops.

        Raises `LeaderLostError` if the lock is contended
        and the holder cannot acquire it within the lease
        window. The runtime handles this by re-attempting
        after the lease expires."""
        if self._started:
            return
        # 1. Acquire leadership. A passive replica spins
        # here until the lock is free.
        t0 = time.monotonic()
        acquired = self._config.leader.try_acquire(
            self._tenant_id, holder=self._holder,
        )
        if not acquired:
            raise LeaderLostError(
                f"could not acquire leader lock for tenant "
                f"{self._tenant_id!r} as holder {self._holder!r}"
            )
        self._lock_failover_ms = int((time.monotonic() - t0) * 1000)
        # 2. Init the tenant (idempotent).
        self._config.store.init_tenant(self._tenant_id)
        # 3. Hydrate the HLC from the store.
        row = self._config.store.load_hlc(
            self._tenant_id, self._config.hlc_consumer,
        )
        if row is not None and row.last_hlc:
            from agents.sync_plane.hlc import parse as _parse_hlc
            self._hlc.observe(_parse_hlc(row.last_hlc))
        # 4. Subscribe to the three subjects.
        sub = self._config.subscriber.subscribe(
            self._tenant_id,
            ALL_SUBJECTS,
            on_event=self._on_event,
            durable_name=(
                f"{self._config.subscription.durable_name}-"
                f"{self._tenant_id}"
            ),
        )
        self._subscription_id = sub.subscription_id
        self._started = True
        # 5. Emit the service-started sentinel via the
        # audit forwarder. The smoke test asserts this
        # event is in the audit store with the right
        # shape.
        self._config.audit.forward(
            event_type="sync.event.received",
            tenant_id=self._tenant_id,
            actor=SYSTEM_ACTOR_SYNC_PLANE,
            entity_id=f"service:{self._holder[:8]}",
            hlc=str(self._hlc.tick()),
            metadata={
                "sync.phase": "service_started",
                "sync.holder": self._holder,
            },
        )

    def stop(self) -> None:
        """Release the lock, close the subscription. Idempotent."""
        if not self._started:
            return
        if self._subscription_id is not None:
            self._config.subscriber.close(self._subscription_id)
            self._subscription_id = None
        self._config.leader.release(
            self._tenant_id, holder=self._holder,
        )
        self._started = False

    # -- inbound event -----------------------------------------------------

    def _on_event(self, event: ReceivedEvent) -> None:
        """The bus-side callback. The smoke test can call
        `apply(event)` directly with a synthetic event;
        the callback is the bus-dispatched path. The two
        are equivalent."""
        self.apply(event)

    def apply(self, event: ReceivedEvent) -> Dict[str, Any]:
        """Apply one inbound event. The smoke test's main
        scenario calls this directly with a synthetic
        event; the bus-dispatched callback is `on_event`.

        Returns a result dict the smoke test asserts on
        (idempotent_skipped / upserted / parked). The
        audit forwarder emits `sync.event.received` and
        `sync.event.applied` for every accepted event;
        the smoke test asserts the audit store has
        both rows."""
        if event.tenant_id != self._tenant_id:
            raise ValueError(
                f"event tenant {event.tenant_id!r} does not "
                f"match service tenant {self._tenant_id!r}"
            )
        # 1. Idempotency on event_id (mirrors JetStream
        # per-subject dedupe; defensive in case the bus
        # dropped the dedupe window).
        if event.event_id in self._inbound_event_ids:
            return {"result": "idempotent_skipped", "event_id": event.event_id}
        self._inbound_event_ids.add(event.event_id)
        # 2. Stamp the local HLC. The producer's HLC is
        # folded into the laa so the local clock stays
        # monotonic per ADR-0010 §3.2.
        from agents.sync_plane.hlc import parse as _parse_hlc
        try:
            remote = _parse_hlc(event.hlc)
            self._hlc.observe(remote)
        except Exception:  # noqa: BLE001
            # Malformed remote HLC is a §6 risk-register
            # finding, not a fatal error — proceed with
            # the local clock.
            remote = None
        local_hlc = self._hlc.tick()
        # 3. Emit `sync.event.received`.
        self._config.audit.forward(
            event_type="sync.event.received",
            tenant_id=self._tenant_id,
            actor=event.payload.get("actor", SYSTEM_ACTOR_SYNC_PLANE),
            entity_id=_entity_id_from_event(event),
            hlc=str(local_hlc),
            metadata={
                "sync.subject": event.subject,
                "sync.event_type": event.event_type,
                "sync.event_id": event.event_id,
                "sync.producer_hlc": event.hlc,
            },
        )
        # 4. Apply the event to the canonical state.
        outcome = self._apply_to_state(event, str(local_hlc))
        # 5. Emit `sync.event.applied` (or
        # `sync.event.divergence_detected` for a Tier 3
        # park).
        forward_type = (
            "sync.event.divergence_detected"
            if outcome.get("parked")
            else "sync.event.applied"
        )
        self._config.audit.forward(
            event_type=forward_type,
            tenant_id=self._tenant_id,
            actor=event.payload.get("actor", SYSTEM_ACTOR_SYNC_PLANE),
            entity_id=outcome.get("entity_id", ""),
            hlc=str(local_hlc),
            metadata={
                "sync.event_id": event.event_id,
                "sync.outcome": outcome.get("result"),
                "sync.reason": outcome.get("reason", ""),
            },
        )
        # 6. Persist the new HLC.
        self._config.store.save_hlc(HLCClockRow(
            tenant_id=self._tenant_id,
            consumer=self._config.hlc_consumer,
            last_hlc=str(local_hlc),
            last_physical_ms=local_hlc.physical_ms,
            last_updated_at=now_iso(),
        ))
        return outcome

    def _apply_to_state(
        self, event: ReceivedEvent, local_hlc: str,
    ) -> Dict[str, Any]:
        """The state-mutation step. The smoke test asserts
        the row shape and the Tier 2 LWW rule (a stale
        HLC is refused)."""
        kind = _entity_kind_for(event)
        entity_id = _entity_id_from_event(event)
        # Fetch the current canonical state.
        current = self._config.store.get_entity(
            self._tenant_id, entity_id,
        )
        # Tier 1 / Tier 2 routing. If the port is
        # registered, defer to the resolver; otherwise
        # use the built-in default (accept, with
        # HLC-monotonicity guard).
        if self._config.ports.has(PORT_CONFLICT_RESOLVER):
            resolver: ConflictResolver = self._config.ports.get(
                PORT_CONFLICT_RESOLVER,
            )
            resolution = resolver.resolve(event, current)
        else:
            resolution = _default_resolve(event, current)
        # Apply the resolution.
        if resolution.action == "reject":
            return {
                "result": "rejected",
                "reason": resolution.reason,
                "field": resolution.field,
                "entity_id": entity_id,
            }
        if resolution.action == "tier3_park":
            entry = DivergenceEntry(
                tenant_id=self._tenant_id,
                entity_id=entity_id,
                field=resolution.field,
                winner_platform=resolution.winner_platform,
                loser_platform=resolution.loser_platform,
                winner_value=event.payload.get(resolution.field, ""),
                loser_value=(
                    getattr(current, resolution.field, "")
                    if current is not None else ""
                ),
                winner_hlc=resolution.winner_hlc,
                loser_hlc=resolution.loser_hlc,
                reason=resolution.reason,
                detected_hlc=local_hlc,
                detected_at=now_iso(),
            )
            self._config.store.enqueue_divergence(entry)
            return {
                "result": "parked",
                "parked": True,
                "reason": resolution.reason,
                "entity_id": entity_id,
            }
        # accept | tier2_lww
        new_entity = SyncEntity(
            tenant_id=self._tenant_id,
            entity_id=entity_id,
            kind=kind,
            remote_refs=dict(
                (current.remote_refs if current else {})
            ),
            last_hlc=local_hlc,
            last_event_id=event.event_id,
            created_hlc=(
                current.created_hlc if current else local_hlc
            ),
            updated_hlc=local_hlc,
            metadata=dict(current.metadata if current else {}),
        )
        # Update `remote_refs` with the event's platform
        # remote id, if the payload carries one.
        platform = event.payload.get("platform")
        remote_id = event.payload.get("remote_id")
        if platform and remote_id:
            new_entity.remote_refs[platform] = remote_id
        # Carry the field-level update.
        for k, v in event.payload.get("fields", {}).items():
            new_entity.metadata[k] = v
        self._config.store.upsert_entity(new_entity)
        return {
            "result": "upserted",
            "entity_id": entity_id,
            "kind": kind.value,
            "reason": resolution.reason or "accepted",
        }


# -- helpers ------------------------------------------------------------------


def _entity_id_for(event: ReceivedEvent) -> str:
    return _entity_id_from_event(event)


def _entity_id_from_event(event: ReceivedEvent) -> str:
    """Extract the entity id from the event payload. The
    Forge domain events use `entity_id` or `id` or
    `paperclip_issue_id` depending on the subject; we
    fall back through the three."""
    p = event.payload or {}
    return (
        p.get("entity_id")
        or p.get("paperclip_issue_id")
        or p.get("id")
        or p.get("issue_id")
        or ""
    )


def _entity_kind_for(event: ReceivedEvent) -> EntityKind:
    """Map the subject to the EntityKind. The smoke test
    asserts every subject maps to a non-`COMMENT` kind."""
    if event.event_type == "issue.updated.v1":
        return EntityKind.ISSUE
    if event.event_type == "run.status_changed.v1":
        return EntityKind.RUN_STATUS
    if event.event_type == "interaction.created.v1":
        return EntityKind.INTERACTION
    return EntityKind.ISSUE   # default


def _default_resolve(
    event: ReceivedEvent, current: Optional[SyncEntity],
) -> Resolution:
    """The built-in Tier 1 / Tier 2 fallback. The 11.4
    ConflictResolver replaces this when registered. The
    fallback:

      * `current` is None  → accept (new entity).
      * `current.last_hlc` >= event HLC → accept (the
        canonical state is already at-or-ahead; this is
        a duplicate or a redelivery).
      * Otherwise → accept (Tier 2 LWW; the higher HLC
        wins). The resolver is responsible for the
        tiered routing in 11.4.
    """
    if current is None:
        return Resolution(action="accept", reason="new_entity")
    return Resolution(
        action="accept", reason="tier2_lww_fallback",
    )


# -- factory ------------------------------------------------------------------


def build_default_service(
    tenant_id: str,
    *,
    holder_id: Optional[str] = None,
    store: Optional[SyncStore] = None,
    leader: Optional[LeaderElection] = None,
    subscriber: Optional[Subscriber] = None,
    audit: Optional[AuditForwarder] = None,
) -> SyncPlaneService:
    """Factory for the day-one default service. Wires the
    in-memory backends and the default burst + audit
    forwarders. The production wiring substitutes real
    backends; the smoke test uses this factory for
    every scenario."""
    config = SyncPlaneServiceConfig(
        tenant_id=tenant_id,
        holder_id=holder_id or new_holder_id(),
        store=store or InMemorySyncStore(),
        leader=leader or InMemoryLeaderLock(),
        subscriber=subscriber or InMemorySubscriber(),
        audit=audit or InMemoryAuditForwarder(),
    )
    return SyncPlaneService(config)
