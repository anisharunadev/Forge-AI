# `@fora/mcp-breaker`

Per-tenant + per-MCP-server circuit breaker. State machine `closed → open → half_open → closed` with cache-broker-backed persistence and `breaker.trip / recover / reject` events on the existing event bus.

Implements **[FORA-48](/FORA/issues/FORA-48) §3.3** (Epic 0.3.3 router sub-goal) per **ADR-0013**.

## Quick start

```ts
import {
  McpCircuitBreaker,
  CacheBrokerBreakerStore,
  InMemoryBreakerEventSink,
  CircuitOpenError,
  type BreakerEventSink,
} from '@fora/mcp-breaker';

// Production wiring (cache-broker + event-bus adapter):
//   1. Construct / inject the CacheBroker.
//   2. Wrap it in CacheBrokerBreakerStore.
//   3. Wrap the event-bus producer in a BreakerEventSink (one-liner).
const breaker = new McpCircuitBreaker({
  store: new CacheBrokerBreakerStore({ broker }),
  events: myEventBusSink, // optional; defaults to NoopBreakerEventSink
});

// Router (FORA-460) calls this around every MCP-server invocation:
async function callMcp(ctx, serverName, fn) {
  const key = { tenant_id: ctx.tenant_id, server_name: serverName };
  try {
    await breaker.beforeCall(ctx, key);
    const result = await fn();
    await breaker.recordSuccess(ctx, key);
    return result;
  } catch (err) {
    if (!(err instanceof CircuitOpenError)) {
      await breaker.recordFailure(ctx, key);
    }
    throw err;
  }
}
```

## Contract

- **Key**: `(tenantId, serverName)` — a tenant-A Jira outage does NOT trip tenant-B Jira.
- **Trip rules** (both honored; first to fire wins):
  - **5 consecutive failures** (anywhere in the sliding window).
  - **`errorRate > 0.5` over a 30s sliding window** with `min_calls = 10` (the min-calls guard keeps a single failure from tripping an empty window).
- **Cooldown**: 30s. After cooldown elapses, the first caller wins a half-open probe slot; concurrent callers are rejected with `circuit_open`.
- **Half-open → closed** on probe success → emits `breaker.recover`.
- **Half-open → open** on probe failure → emits `breaker.trip` with `reason: probe_failure`.
- **Persisted via `@fora/cache-broker`**: tenant boundary is enforced by the broker (`tenancy.denied` on cross-tenant reads). Best-effort: a Redis outage degrades to fresh-empty state per key, NOT a hard fail.
- **Typed error**: `CircuitOpenError` with `kind: 'circuit_open'`, `tenant_id`, `server_name`, `state`, `retry_after_ms`. Maps to `mcp_unavailable` at the router seam in FORA-48 §3.4.

## Trip rules — why both?

The MCP server failure modes are bimodal:

- A bad auth call **fails identically every time** — consecutive failures.
- A flaky network **fails intermittently** — only the error rate catches it.

A single rule would miss one or the other.

## Event sink — production wiring

The breaker ships `BreakerEventSink` as a one-method interface (`emit(event)`). For tests use `InMemoryBreakerEventSink`; for prod, write a one-line adapter that forwards to `@fora/event-bus`:

```ts
import { NatsEventProducer } from '@fora/event-bus';
import type { BreakerEventSink, BreakerEvent } from '@fora/mcp-breaker';

export function toEventBusSink(producer: NatsEventProducer): BreakerEventSink {
  return {
    async emit(event: BreakerEvent) {
      // Map breaker.{trip,recover,reject} to typed events on the bus.
      // v0.1 of @fora/event-bus ships 19 typed events; the 3 breaker
      // events live on the audit-out-of-band channel (FORA-36 forwarder).
      // Future: add 3 typed events to EVENT_SCHEMAS (minor bump) so the
      // bus consumers can dedupe + schema-validate directly.
      await producer.publish('error', event as unknown as Record<string, unknown>);
    },
  };
}
```

This is the same `AuditSink` pattern used by `@fora/sync-plane-ratelimit` (FORA-256, ADR-0010 §8.1). The breaker never opens a NATS socket itself; the router (which already owns the connection) injects the sink.

## Performance

The state machine is synchronous and pure; the only IO is one cache-broker `get` + one `set` per call, both O(1) hash lookups. AC #2 from FORA-48: **5 errors trip the breaker, and the next invoke returns `circuit_open` in ≤50ms** (the trip path itself is sub-millisecond; the budget covers cache RTT + warm-up).

## Tests

```bash
pnpm --filter @fora/mcp-breaker test
```

Coverage:

| File | Covers |
| --- | --- |
| `state.test.ts` | Pure state machine: consecutive-failure trip, error-rate trip (with min-calls guard), cooldown transition, half-open probe slot, success/failure from half-open |
| `breaker.test.ts` | Orchestrator + store + sink integration; events emitted on trip / recover / reject; AC #2 ≤50ms rejection |
| `tenant-isolation.test.ts` | Per-(tenant, server) keying; tenant A trip does NOT trip tenant B |
| `cache-store.test.ts` | Cache-broker-backed store: cross-tenant refusal via cache-broker `tenancy.denied`; best-effort degradation when broker throws |

## Conventions

- ESM (`"type": "module"`), strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- The state machine is **pure** (no IO) — `state.ts` has no imports beyond `./types.js`. Tests can drive it directly.
- The orchestrator (`breaker.ts`) is the only file that touches IO (cache-broker) or external side effects (event sink).
- Public surface re-exported from `src/index.ts`; internal modules are not deep-imported across package boundaries.

## What's not in this package

- **The MCP router** (per-tenant scope, schema registry, retry/idempotency). Lives in `packages/mcp-router/` (FORA-460, parallel to this one).
- **The `mcp_unavailable` rename**. The router seam in FORA-48 §3.4 wraps `CircuitOpenError` into the canonical MCP error.
- **The Redis store adapter**. v0.1 ships `CacheBrokerBreakerStore`; v0.2 may add a typed `redisCacheStore` shortcut if the cache-broker overhead shows up in profiling.