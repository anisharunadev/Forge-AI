# @fora/event-bus

Forge AI's typed event bus — 19 event types, NATS JetStream producer/consumer with per-tenant subject isolation, SQS+SNS bridge contract, and replay from `agent_run_events`.

**Implements:** [Forge AI-136](/Forge AI/issues/Forge AI-136) · **Sub-goal 0.1.3 of** [Forge AI-50](/Forge AI/issues/Forge AI-50) · **Substrate:** [ADR-0006](/Forge AI/docs/architecture/adr-0006-event-bus-nats-jetstream.md) · **Spec:** [Forge AI-50 spec §5](/Forge AI/issues/Forge AI-50)

## Public surface

```ts
import {
  // 19 typed event schemas + the EventType union + ALL_EVENT_TYPES
  EVENT_SCHEMAS, CURRENT_EVENT_VERSION, CURRENT_EVENT_MAJOR,
  buildEnvelope, parseEnvelope,
  type EventType, type TypedEvent,

  // (state-change → event_type) mapping for the Orchestrator
  STATE_CHANGE_TO_EVENT, eventTypeFor, assertExhaustiveCoverage,

  // Subject + tenant guard
  buildSubject, parseSubject, assertSubjectTenant, tenantSubjectPrefix,

  // Producer + Consumer
  NatsEventProducer, InMemoryEventProducer,   // test fake included
  NatsEventConsumer, InMemoryDedupeStore, TokenBucketRateLimiter,
  processOneEvent,                            // bridge / inline use

  // Replay contract (from agent_run_events rows back to the bus)
  replayRun, subjectForRow, type ReplaySource,

  // Typed errors
  EventBusError, TenantMismatchError, SchemaValidationError,
  SchemaVersionUnsupportedError, TransportError, InvalidInputError, ClosedError,
} from '@fora/event-bus';
```

## The 19 typed events

Per [Forge AI-50 spec §5.1](/Forge AI/issues/Forge AI-50):

```
run_created · run_started · stage_started · stage_completed · stage_approved
stage_rejected · stage_returned · approval_requested · approval_decided · approval_expired
gate_passed · cost_reported · budget_exceeded · run_aborted · run_paused
run_resumed · run_finished · error · invalid_transition
```

Each event has a Zod schema for its `payload`, a `v: "1.0.0"` semver envelope, and an entry in `EVENT_SCHEMAS`. The 19th event is `error` (an unrecoverable error event) — bringing the total to 19.

## Subject model

```
fora.events.<tenant_id>.<event_type>.v<major>
```

- `<tenant_id>` — opaque, from the JWT claim. NATS subject ACLs enforce per-tenant isolation at the broker; `assertSubjectTenant` enforces it in-process on the producer side.
- `<event_type>` — one of the 19 typed events (snake_case, 1..64 chars).
- `<major>` — major schema version. Bumped on breaking changes; the v1 subject continues to emit for 30 days.

## Producer (the Orchestrator's only writer)

```ts
import { connect } from 'nats';
import { NatsEventProducer } from '@fora/event-bus';

const nc = await connect({ servers: process.env.Forge AI_NATS_URL! });
const js = nc.jetstream();
const producer = new NatsEventProducer({ nc, js, tenantId: 'tnt_acme' });

await producer.publish('run_created', {
  run_id: 'run-1234',
  tenant_id: 'tnt_acme',
  goal_id: 'goal-1',
  trigger: { type: 'manual', actor: 'user:cto', payload_ref: null },
});
await producer.flush(); // durable ack before returning
```

Durability contract: `producer.publish` awaits the JetStream publish ack before returning (at-least-once). On any error, throws a typed `EventBusError`. `InMemoryEventProducer` is a fake with the same contract for tests.

## Consumer (Audit, Cost, Memory)

```ts
import { NatsEventConsumer } from '@fora/event-bus';

const consumer = new NatsEventConsumer({
  tenantId: 'tnt_acme',
  durableName: 'audit-writer',
  maxMajorVersion: 1,
});

consumer.on('run_created', async (env) => {
  await db.insertAuditRow(env);
});
consumer.on('stage_completed', async (env) => {
  await memory.index(env);
});

await consumer.start();
```

The consumer pipeline:

1. Subject-level tenant ACL — refuses messages whose tenant segment ≠ `tenantId`.
2. Token-bucket rate limit (default 100 rps, burst 200).
3. Envelope + per-event schema parse.
4. Schema-version guard — drops events whose major > `maxMajorVersion` (v1 consumer keeps reading v1 events for the 30-day window).
5. Dedupe by `event_id` — redeliveries are no-ops.
6. Handler invocation; throw → message is nacked upstream.

## Replay (the crash-recovery path)

```ts
import { replayRun, type ReplaySource } from '@fora/event-bus';

const source: ReplaySource = async (runId) => {
  const { rows } = await pg.query(
    'SELECT * FROM agent_run_events WHERE run_id = $1 ORDER BY occurred_at, id',
    [runId],
  );
  return rows;
};

const summary = await replayRun({ source, producer, runId: 'run-1234' });
// { run_id, tenant_id, row_count, published_count, deduped_count, error_count, duration_ms }
```

Each row is re-published with its original `event_id` (preserving dedupe), in `occurred_at` order. The summary is the audit-friendly record of what was replayed.

## Tests

```sh
pnpm test
```

Test tiers and what's covered:

| File | Covers |
| --- | --- |
| `subject.test.ts` | Subject construction, parse, `assertSubjectTenant` (producer guard) |
| `envelope.test.ts` | Envelope schema, semver helpers |
| `events.test.ts` | All 19 event schemas + (state-change → event_type) pair coverage |
| `schema-version.test.ts` | v1 consumer reads v1; skips v2; v2 consumer reads both |
| `tenant-isolation.test.ts` | Consumer refuses cross-tenant subjects |
| `dedupe.test.ts` | Same `event_id` delivered twice = one handler invocation |
| `producer.test.ts` | `InMemoryEventProducer` contract, validation, tenant guard |
| `replay.test.ts` | `replayRun` re-publishes in order with original `event_id` |

## Conventions

- ESM (`"type": "module"`), strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Zod schemas are the source of truth; TypeScript types are inferred.
- The producer is single-tenant by construction — `tenantId` is a required field on `NatsProducerConfig`.
- Public surface re-exported from `src/index.ts`; internal modules are not deep-imported across package boundaries.

## What's not in this package

- **The SQS+SNS bridge service** lives in `apps/event-bus-bridge/`.
- **The audit writer** (consumer in the audit account) lives in `apps/audit-writer/` (not in this repo yet; built on this package).
- **The Postgres / Redis dedupe stores** — the package ships `InMemoryDedupeStore`; production stores are wired by the consumer owner.
