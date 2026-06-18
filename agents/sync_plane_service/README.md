# agents/sync_plane_service — FORA-252 / Epic 11.1

The **Sync Plane service skeleton**: a per-tenant logical hub that
owns canonical state for synced entities and brokers writes between
Paperclip, Jira, GitHub Issues, and ClickUp. This module is the
**day-one spine** of the Forge Integration Layer (Epic 11); the
other sub-tasks (11.2 platform adapters, 11.4 conflict resolver,
11.5 divergence workbench, 11.6 burst control, 11.7 polling
backstop, 11.8 audit forwarder) live behind the ports defined
here.

> **Why a separate `sync_plane_service` package?** The existing
> `agents/sync_plane/` is the 11.4 conflict-resolver sub-task
> (FORA-254). Keeping 11.1 in a parallel package preserves the
> sub-task boundaries — the CTO is reviewing each sub-task on
> its own timeline, and a single 50-file package would
> conflate the reviews. The two packages share the HLC module
> (re-exported from `agents.sync_plane.hlc`); the wire form
> is the same.

## Sub-task: FORA-252

Spec source: [ADR-0010 §3](../docs/architecture/adr-0010-cross-platform-sync-plane.md)
topology, [ADR-0010 §7.1](../docs/architecture/adr-0010-cross-platform-sync-plane.md)
failure modes, [ADR-0010 §8.1](../docs/architecture/adr-0010-cross-platform-sync-plane.md)
audit events, [FORA-117 storage-contract pattern](../docs/adr/0002-knowledge-layer-storage-contract.md),
[ADR-0006 event bus](../docs/architecture/adr-0006-event-bus-nats-jetstream.md).

## What ships in 11.1

| Deliverable | Where | Notes |
| --- | --- | --- |
| HLC clock | `hlc` (re-exported from `agents.sync_plane.hlc`) | The shared 11.4 HLC is the wire form; 11.1 does not re-implement it |
| Per-tenant service orchestrator | `service.SyncPlaneService` | One instance per `tenant_id`; start/stop, leader lock, audit emit |
| Leader election (active-passive failover) | `leader.InMemoryLeaderLock`, `leader.PostgresAdvisoryLock` | < 30s AC budget; smoke test uses in-memory; prod uses Postgres advisory lock |
| Canonical state store | `store.SyncStore` protocol + `store.InMemorySyncStore` | 4 tables; HLC-monotonic upsert; dedupe on `event_id` |
| Subscriber | `subscriber.Subscriber` protocol + `subscriber.InMemorySubscriber` | Subscribes to 3 Forge domain-event subjects; JetStream-style dedupe |
| 6 architectural-seam ports | `ports` | `PlatformAdapter` (11.2), `ConflictResolver` (11.4), `DivergenceWorkbench` (11.5), `BurstControl` (11.6), `PollingBackstop` (11.7), `AuditForwarder` (11.8) |
| Day-one `BurstControl` (11.6) | `burst.InMemoryBurstControl` | Per-tenant token bucket + per-platform circuit breaker; ADR-0010 §9 day-one coupling |
| Day-one `AuditForwarder` (11.8) | `audit_forwarder.InMemoryAuditForwarder` | Wires the 8 `sync.*` events to FORA-36 |
| Production Postgres schema | `migrations/0005_sync_plane.sql` | 4 `sync.*` tables, RLS per tenant, `(tenant_id, …)` PRIMARY KEY |
| Smoke test (FORA-117 pattern) | `smoke_test.py` | All 7 ACs; evidence to `evidence/smoke_<utc>.json` |

## Acceptance criteria (the 7 ACs)

The smoke test (`python3 -m agents.sync_plane_service.smoke_test`)
exercises every AC and writes the evidence JSON. The contract:

```
AC1 — Idempotent init. start()/stop() is a no-op on second
      call; init_tenant counts every call; the service can
      be restarted on the same tenant.
AC2 — Subscribes to all three Forge domain-event subjects:
      issue.updated.v1, run.status_changed.v1,
      interaction.created.v1. Closed set in v1; a new
      subject is a new constant.
AC3 — Postgres tables exist with per-tenant partitioning
      keys: sync.entity, sync.canonical_comment,
      sync.hlc_clock, sync.divergence_queue. (tenant_id,
      …) PRIMARY KEY on every table.
AC4 — HLC clock per ADR-0010 §3.2: physical_ms.laa-seq;
      tick() advances; observe() folds remote HLC into
      the laa.
AC5 — Active-passive failover in <30s; no double-publish
      (idempotent on event_id).
AC6 — sync.event.received and sync.event.applied wire to
      FORA-36; the audit row carries stage=sync_plane,
      tool=sync.<event_type>, and the metadata.sync.*
      keys per ADR-0010 risk register §6.
AC7 — Smoke test itself: `python3 -m
      agents.sync_plane_service.smoke_test` runs in
      < 1 s and writes evidence.
```

## Day-one coupling (ADR-0010 §9)

Per [ADR-0010 §9](../docs/architecture/adr-0010-cross-platform-sync-plane.md)
"Day-one (must ship together to support every_event)",
**sub-task 11.6 (burst control) MUST ship with 11.1**. This
module ships a working in-memory `BurstControl` default;
sub-task 11.6 (FORA-???) replaces it with a Redis-backed
implementation without changing the protocol. The same
`BurstControl` seam that ships today is what 11.6 will
implement against.

## Architecture seams (the 6 ports)

| Port | Owning sub-task | Day-one default? |
| --- | --- | --- |
| `PlatformAdapter` (jira / github / clickup) | 11.2 | No — sub-task 11.2 |
| `ConflictResolver` | 11.4 (FORA-254) | No — sub-task 11.4 |
| `DivergenceWorkbench` | 11.5 | No — sub-task 11.5 |
| `BurstControl` | 11.6 | **Yes** — `InMemoryBurstControl` |
| `PollingBackstop` | 11.7 | No — sub-task 11.7 |
| `AuditForwarder` | 11.8 | **Yes** — `InMemoryAuditForwarder` |

The `PortRegistry` is the wiring seam; the service looks up
the port by name. Missing ports raise `KeyError` at
service-start — a missing port is a config bug, not a silent
fallback.

## Public surface

```python
from agents.sync_plane_service import (
    # HLC (re-exported from agents.sync_plane.hlc)
    HLC, Clock, parse as hlc_parse, GENESIS_HLC,
    # schema
    SyncEntity, CanonicalComment, DivergenceEntry,
    HLCClockRow, ReceivedEvent, EntityKind,
    # ports
    PlatformAdapter, ConflictResolver, DivergenceWorkbench,
    BurstControl, PollingBackstop, AuditForwarder, PortRegistry,
    # burst (day-one)
    PerTenantTokenBucket, PerPlatformCircuitBreaker,
    InMemoryBurstControl,
    # audit forwarder (day-one)
    InMemoryAuditForwarder, AuditForwarderConfig,
    # leader
    PostgresAdvisoryLock, InMemoryLeaderLock,
    LeaderElection, LeaderLostError,
    # store
    SyncStore, InMemorySyncStore, SyncStoreError,
    # subscriber
    Subscriber, InMemorySubscriber, SubscriptionConfig,
    # service
    SyncPlaneService, SyncPlaneServiceConfig,
    build_default_service,
    # subjects
    ALL_SUBJECTS, SUBJECT_ISSUE_UPDATED,
    SUBJECT_RUN_STATUS_CHANGED, SUBJECT_INTERACTION_CREATED,
)
```

## Running the smoke test

```sh
python3 -m agents.sync_plane_service.smoke_test
```

Output:

```
========================================================================
Sync Plane service skeleton — smoke test (FORA-252 / 11.1)
========================================================================

[AC1 idempotent init]
  OK  (1 ms)

[AC2 subscribes to all three subjects]
  OK  (2 ms)

[AC3 postgres tables + per-tenant partitioning]
  OK  (1 ms)

[AC4 HLC clock per ADR-0010 §3.2]
  OK  (0 ms)

[AC5 active-passive failover <30s + dedupe]
  OK  (1 ms)

[AC6 sync.event.received/applied wire to FORA-36]
  OK  (0 ms)

[Day-one BurstControl port (11.6 day-one coupling)]
  OK  (0 ms)

Evidence: .../evidence/smoke_<utc>.json
========================================================================
OK: Sync Plane 11.1 service skeleton meets all 7 ACs
```

## Production wiring

The smoke test wires the in-memory backends. The production
wiring substitutes real backends at start-up:

```python
from agents.sync_plane_service import (
    SyncPlaneService, SyncPlaneServiceConfig,
    InMemorySubscriber,    # replace with NatsEventConsumer
    InMemorySyncStore,     # replace with PostgresSyncStore
    InMemoryLeaderLock,    # replace with PostgresAdvisoryLock
    InMemoryAuditForwarder,  # replace with SqsAuditForwarder
    InMemoryBurstControl,  # 11.6 replaces with RedisBurstControl
    PortRegistry,
)
# Register 11.2 / 11.4 / 11.5 / 11.7 ports when they ship.
ports = PortRegistry()
# ports.register(PORT_PLATFORM_JIRA, JiraAdapter(...))
# ports.register(PORT_CONFLICT_RESOLVER, TierResolver())

config = SyncPlaneServiceConfig(
    tenant_id="tnt_acme",
    store=PostgresSyncStore(pool=pool),
    leader=PostgresAdvisoryLock(pool=pool),
    subscriber=NatsEventConsumer(...),
    audit=SqsAuditForwarder(...),
    burst=RedisBurstControl(...),
    ports=ports,
)
service = SyncPlaneService(config)
service.start()
```

## What's not in this module

- **Platform adapters** (Jira, GitHub, ClickUp) — sub-task 11.2
- **Tier 1 / Tier 2 / Tier 3 conflict resolver** — sub-task 11.4
  (the existing `agents.sync_plane` module is the 11.4 work)
- **Divergence workbench UI** — sub-task 11.5
- **Redis-backed burst control** — sub-task 11.6 (replaces the
  in-memory default without changing the protocol)
- **Polling backstop + daily divergence job** — sub-task 11.7
- **Cross-account SQS audit forwarder** — sub-task 11.8
  (replaces the in-memory default without changing the
  protocol)

## Known issues (forwarded to 11.4)

The 11.4 HLC `parse()` function asserts `len(s) == 22` (a
3-digit laa segment), but the `str()` output can produce 32
chars (a 13-digit laa). The smoke test works around it by
reading the `HLC` dataclass fields directly; the production
wiring does the same. The fix lives in the 11.4 module
(FORA-254). Recorded as a finding in the smoke test
evidence JSON.
