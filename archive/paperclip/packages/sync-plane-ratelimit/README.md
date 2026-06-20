# `@fora/sync-plane-ratelimit`

Outbound reliability layer for the Forge AI Sync Plane service. Composable
primitives in one `enqueue` API:

1. **Per-tenant token bucket** — one tenant's burst can't drain every other
   tenant's quota (Forge AI-256 AC #1a).
2. **Per-(tenant, platform) token bucket** — platform-specific quotas on top
   of the tenant bucket (Forge AI-256 AC #1b).
3. **Per-platform circuit breaker** — 5xx storm isolation per platform
   (ADR-0010 §7.1). Trips on N consecutive 5xx in a sliding window,
   half-opens after a cooldown, recovers via a single probe.
4. **Composite-edit coalescer** — N edits on the same remote issue within
   W seconds collapse to one outbound call (R-SYNC-03).

Plus, added in v0.4 (Forge AI-487.3 / Forge AI-517):

5. **Backoff scheduler** — retries failed calls with `Retry-After` /
   exponential-with-jitter, idempotency-keyed via the Forge AI-401 `sync_op`
   spine, with a tenant-weighted FIFO to keep fairness during retry storms.
6. **UUID v7 Idempotency-Keys** — time-ordered, B-tree-friendly, dedupeable
   against the Forge AI-401 `sync_op` table.

On top of these, the package emits the published Plan 3 §6
`connector.*` audit-event taxonomy (Forge AI-487.1, Forge AI-391), and now
`connector.backoff.retried` / `connector.backoff.exhausted` for the
backoff layer (Forge AI-487.3).

## Install

```sh
pnpm add @fora/sync-plane-ratelimit
```

## Quick start

```ts
import { OutboundReliability, InMemoryAuditSink } from '@fora/sync-plane-ratelimit';

const audit = new InMemoryAuditSink();

const outbound = new OutboundReliability(
  {
    audit,
    tenant_bucket:    { capacity: 10, refill_per_sec: 1 },
    platform_bucket:  { capacity: 10, refill_per_sec: 1 },
    breaker:          { failure_threshold: 5, failure_window_ms: 60_000, cooldown_ms: 5 * 60_000 },
    coalesce_window_ms: 30_000,
  },
  async (ctx) => {
    return await jiraAdapter.call(ctx);
  },
);

const disposition = outbound.enqueue({
  event_id: 'evt-1',
  tenant_id: 'tenant-A',
  platform: 'jira',
  remote_issue_id: 'JIRA-100',
  edit_kind: 'comment',
  body: 'looks good to me',
  enqueued_at_ms: Date.now(),
});
```

## Backoff scheduler (v0.4 — Forge AI-487.3)

```ts
import {
  BackoffScheduler,
  BackoffPolicy,
  InMemorySyncOpStore,
  uuidV7,
  type SchedulerCall,
} from '@fora/sync-plane-ratelimit';

const scheduler = new BackoffScheduler({
  policy: new BackoffPolicy({ rng: Math.random }), // default config
  sync_op: new InMemorySyncOpStore(),
  audit: new InMemoryAuditSink(),
});

const result = await scheduler.execute({
  tenant_id: 'tenant-A',
  platform: 'jira',
  connector_id: 'jira',
  verb: 'GET',
  execute: async (idempotency_key) => {
    return await jiraAdapter.getIssue('JIRA-100', { idempotency_key });
  },
});

console.log(result.attempts, result.retried, result.exhausted);
```

`BackoffScheduler` is the Forge AI-401 `sync_op` dedupe spine + a retry
loop. The `SyncOpStore` interface is the dependency-inversion seam:
production wires a `PgSyncOpStore` adapter against
`migrations/0008_jira_adapter.sql`'s `sync_op` table; tests use
`InMemorySyncOpStore`.

## Audit event taxonomy

The package emits a typed `SyncAuditEvent` whose `type` is one of:

| `type`                              | Trigger                                  | Payload                                                                 |
|-------------------------------------|------------------------------------------|-------------------------------------------------------------------------|
| `connector.rate_limit.throttled`    | A bucket refused the call                | `{ layer: 'tenant' \| 'platform', … }`                                  |
| `connector.coalesce.applied`        | An edit was merged into an existing buffer | `{ key, event_id }`                                                   |
| `connector.circuit.opened`          | The per-platform breaker tripped OR a request was rejected by the breaker | `{ state?: 'open', at_ms }` (transition) or `{}` (request) |
| `connector.circuit.closed`          | The breaker recovered to closed          | `{ state: 'closed', at_ms }`                                            |
| `connector.backoff.retried`         | A platform call was retried after backoff (Forge AI-487.3) | `{ idempotency_key, attempt, next_attempt, backoff_ms, status, … }` |
| `connector.backoff.exhausted`       | The retry budget was exhausted (Forge AI-487.3) | `{ idempotency_key, attempts, final_status, backoff_ms, … }`         |

The v0.1 `sync.outbound.*` / `sync.platform.*` namespace was renamed to
`connector.*` per **Forge AI-391 Plan 3 §6** in Forge AI-487.1.

## Architecture

- ADR-0010 §7.1 (breaker policy), §8.1 (event types), §8.2 (R-SYNC-03).
- Pattern reused from `@fora/customer-cloud-broker/src/adapters/aws.ts`
  (Forge AI-126.5).
- The Sync Plane service (Forge AI-252 / 11.1) wires the platform adapter at
  construction time. The smoke test injects a mock.
- The backoff scheduler's `SyncOpStore` is the Forge AI-401 dedupe spine
  (production: `PgSyncOpStore` against `migrations/0008_jira_adapter.sql`;
  tests: `InMemorySyncOpStore`).

## Test tiers

- **Unit** — `src/__tests__/circuit_breaker.test.ts` (state-machine),
  `src/__tests__/backoff_policy.test.ts` (retry math),
  `src/__tests__/idempotency_key.test.ts` (UUID v7).
- **Integration** — `src/__tests__/outbound.test.ts` (Forge AI-256 5 ACs end-to-end),
  `src/__tests__/backoff_scheduler.test.ts` (orchestrator + FIFO + audit).
- **Contract** — covered by `@fora/sync-plane-service` tests (Forge AI-252).
- **E2E** — covered by the smoke test in `agents/sync_plane_service/__pycache__/smoke_test.cpython-312.pyc` (Forge AI-252 acceptance gate).

## Versioning

This package follows semver. The v0.1 → v0.2 bump (Forge AI-487.1) was a
**typed-enum rename** (no runtime behaviour change). The v0.3 → v0.4
bump (Forge AI-487.3) is **additive** — two new audit event types and a
new `BackoffScheduler` module. Consumers that do not filter on
`connector.backoff.*` are unaffected.
