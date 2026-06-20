"""
Sync Plane service skeleton — FORA-252 / Epic 11.1.

Per ADR-0010 §3: a logical hub-and-spoke per-tenant service that owns
canonical state for synced entities and brokers writes between
Paperclip, Jira, GitHub Issues, and ClickUp. The service is the
**day-one spine** of the Forge Integration Layer; the other
sub-tasks (11.2 platform adapters, 11.4 conflict resolver, 11.5
divergence workbench, 11.6 burst control, 11.7 polling backstop,
11.8 audit forwarder) live behind the ports this module defines.

This module is the 11.1 **service skeleton** only — the ports are
the seams the other sub-tasks fill in. Two ports ship with a default
implementation in this heartbeat because they are **day-one P0**:

  * `BurstControl` (11.6 day-one coupling per ADR-0010 §9) — the
    `every_event` write-back default makes the per-tenant token
    bucket + per-platform circuit breaker a day-one requirement.
    `agents/sync_plane_service/burst.py` ships a working in-memory
    default so 11.6 can replace it without API churn.
  * `AuditForwarder` — the 8 `sync.*` event types must wire into the
    FORA-36 forwarder on day one (ADR-0010 §8.1). Default impl
    delegates to `agents/audit/emit.emit_tool_call`.

The other four ports (`PlatformAdapter`, `ConflictResolver`,
`DivergenceWorkbench`, `PollingBackstop`) ship as `Protocol` types
with a `NotImplementedError` default. They are owned by sub-tasks
11.2 / 11.4 / 11.5 / 11.7 respectively and are not in 11.1's scope.

Public surface (the importable names):

  hlc                 — Hybrid Logical Clock (re-exported from
                        `agents/sync_plane.hlc` — the 11.4 HLC is the
                        shared HLC; the wire form is fixed)
  schema              — dataclasses for canonical state rows
  ports               — the 6 architectural-seam protocols
  burst               — BurstControl default impl + per-tenant /
                        per-platform state
  audit_forwarder     — AuditForwarder default impl
  leader              — advisory-lock leader election
                        (Postgres-backed prod, in-memory dev)
  store               — SyncStore protocol + InMemorySyncStore
  subscriber          — JetStream consumer that applies domain
                        events to the canonical state
  service             — `SyncPlaneService` orchestrator (per-tenant)
  SyncPlaneServiceConfig
                      — service config (tenant_id, store, leader,
                        ports, audit_store, hlc_clock)

Sub-task: FORA-252 / Epic 11.1. Spec source: ADR-0010 §3, §7.1, §8.1.
Reference: FORA-117 storage-contract pattern, ADR-0006 event-bus.
"""

from . import (
    audit_forwarder,
    burst,
    leader,
    ports,
    schema,
    service,
    store,
    subscriber,
)

# Re-export the 11.4 HLC under the 11.1 namespace so callers don't
# have to know about the sub-task split. The HLC is shared across
# 11.1 / 11.4 / 11.6 / 11.8; a separate copy would create wire-form
# drift, which ADR-0010 §3.2 explicitly forbids.
from agents.sync_plane.hlc import (  # noqa: F401
    GENESIS_HLC,
    Clock,
    HLC,
    MIN_PHYSICAL_MS,
    MAX_PHYSICAL_MS,
    parse as hlc_parse,
    wall_ms,
)

from .service import (
    SyncPlaneService,
    SyncPlaneServiceConfig,
    build_default_service,
)
from .ports import (
    AuditForwarder,
    BurstControl,
    ConflictResolver,
    DivergenceWorkbench,
    PlatformAdapter,
    PollingBackstop,
    PortRegistry,
)
from .burst import (
    InMemoryBurstControl,
    PerPlatformCircuitBreaker,
    PerTenantTokenBucket,
    burst_decision,
)
from .audit_forwarder import (
    AuditForwarderConfig,
    InMemoryAuditForwarder,
)
from .leader import (
    InMemoryLeaderLock,
    LeaderElection,
    LeaderLostError,
    PostgresAdvisoryLock,
)
from .store import (
    InMemorySyncStore,
    SyncStore,
    SyncStoreError,
)
from .subscriber import (
    ALL_SUBJECTS,
    InMemorySubscriber,
    Subscriber,
    SUBJECT_INTERACTION_CREATED,
    SUBJECT_ISSUE_UPDATED,
    SUBJECT_RUN_STATUS_CHANGED,
    SUBJECT_PREFIX,
    SubscriptionConfig,
)
from .schema import (
    CanonicalComment,
    DivergenceEntry,
    EntityKind,
    HLCClockRow,
    ReceivedEvent,
    SyncEntity,
)


__all__ = [
    # hlc re-exports
    "GENESIS_HLC",
    "Clock",
    "HLC",
    "MIN_PHYSICAL_MS",
    "MAX_PHYSICAL_MS",
    "hlc_parse",
    "wall_ms",
    # schema
    "SyncEntity",
    "CanonicalComment",
    "DivergenceEntry",
    "EntityKind",
    "HLCClockRow",
    "ReceivedEvent",
    # ports
    "PlatformAdapter",
    "ConflictResolver",
    "DivergenceWorkbench",
    "BurstControl",
    "PollingBackstop",
    "AuditForwarder",
    "PortRegistry",
    # burst (day-one)
    "PerTenantTokenBucket",
    "PerPlatformCircuitBreaker",
    "InMemoryBurstControl",
    "burst_decision",
    # audit forwarder (day-one)
    "InMemoryAuditForwarder",
    "AuditForwarderConfig",
    # leader
    "PostgresAdvisoryLock",
    "InMemoryLeaderLock",
    "LeaderElection",
    "LeaderLostError",
    # store
    "SyncStore",
    "InMemorySyncStore",
    "SyncStoreError",
    # subscriber
    "Subscriber",
    "InMemorySubscriber",
    "SubscriptionConfig",
    "ALL_SUBJECTS",
    "SUBJECT_INTERACTION_CREATED",
    "SUBJECT_ISSUE_UPDATED",
    "SUBJECT_RUN_STATUS_CHANGED",
    "SUBJECT_PREFIX",
    # service
    "SyncPlaneService",
    "SyncPlaneServiceConfig",
    "build_default_service",
]
