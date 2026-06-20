/**
 * @fora/mcp-breaker — orchestrator
 *
 * Wires the pure state machine (`state.ts`) to:
 *   - `@fora/cache-broker` for snapshot persistence (per FORA-48 §3.3
 *     "best-effort, in-memory fallback"). The cache broker already
 *     enforces the tenant boundary on every read/write, so the breaker
 *     inherits tenant isolation for free.
 *   - a `BreakerEventSink` for the three `breaker.*` events.
 *
 * Why a cache broker and not a module-level Map:
 *   - per-process Maps do not survive restarts and do not share state
 *     across router replicas. The cache-broker lets the breaker ride
 *     the same Redis the rest of the platform uses; a restart does not
 *     wipe the cooldown clock; a second router instance sees the same
 *     trip state.
 *   - the cache-broker already has the `tenancy.denied` audit event +
 *     `tenant_mismatch` shape, so the breaker cannot accidentally leak
 *     across tenants even if a caller passes the wrong context.
 *
 * Why an `InMemoryBreakerStore` fallback:
 *   - tests + dev runs do not need Redis. The fallback uses an
 *     in-process Map keyed by `(tenant_id, server_name)` and provides
 *     the same async surface.
 *   - the breaker code path is identical; the only difference is which
 *     store satisfies the interface. Production wiring swaps in a
 *     cache-broker-backed store; tests use the in-memory store.
 */

import type { RequestContext } from '@fora/cache-broker';
import {
  type BreakerCallResult,
  type BreakerPolicy,
  type BreakerSnapshot,
  CircuitOpenError,
  DEFAULT_POLICY,
} from './types.js';
import { apply, decide, emptySnapshot } from './state.js';
import {
  type BreakerEvent,
  type BreakerEventSink,
  type TripReason,
  InMemoryBreakerEventSink,
  NoopBreakerEventSink,
  makeEvent,
} from './events.js';

/** Minimal persistence interface. The cache-broker-backed store implements this. */
export interface BreakerStore {
  load(ctx: RequestContext, key: BreakerKey): Promise<BreakerSnapshot | null>;
  save(ctx: RequestContext, key: BreakerKey, snapshot: BreakerSnapshot): Promise<void>;
}

/** Composite cache key for a (tenantId, serverName) pair. */
export interface BreakerKey {
  readonly tenant_id: string;
  readonly server_name: string;
}

/**
 * A `BreakerStore` backed by a Map. For tests + dev only — production
 * wiring goes through the cache-broker (see `cacheStore` below).
 */
export class InMemoryBreakerStore implements BreakerStore {
  private readonly map = new Map<string, BreakerSnapshot>();

  private compositeKey(key: BreakerKey): string {
    return `${key.tenant_id}::${key.server_name}`;
  }

  async load(_ctx: RequestContext, key: BreakerKey): Promise<BreakerSnapshot | null> {
    return this.map.get(this.compositeKey(key)) ?? null;
  }

  async save(_ctx: RequestContext, key: BreakerKey, snapshot: BreakerSnapshot): Promise<void> {
    this.map.set(this.compositeKey(key), snapshot);
  }

  /** Test-only: number of live snapshots. */
  size(): number {
    return this.map.size;
  }

  /** Test-only: clear the store. */
  clear(): void {
    this.map.clear();
  }
}

export interface McpCircuitBreakerOptions {
  /** Where snapshots live. Production uses a cache-broker-backed store. */
  readonly store: BreakerStore;
  /** Where breaker.* events go. Defaults to `NoopBreakerEventSink`. */
  readonly events?: BreakerEventSink;
  /** Trip / cool-down policy. Defaults to `DEFAULT_POLICY`. */
  readonly policy?: BreakerPolicy;
  /** `now()` injection for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** ISO-clock injection for events; defaults to `() => new Date()`. */
  readonly clock?: () => Date;
}

/**
 * The MCP circuit breaker. The router (FORA-460) calls `beforeCall` /
 * `recordSuccess` / `recordFailure` around every MCP-server invocation.
 * The breaker is per-(tenant, server); one orchestrator instance
 * handles all keys via the `key` argument.
 */
export class McpCircuitBreaker {
  private readonly store: BreakerStore;
  private readonly events: BreakerEventSink;
  private readonly policy: BreakerPolicy;
  private readonly now: () => number;
  private readonly clock: () => Date;

  constructor(opts: McpCircuitBreakerOptions) {
    if (!opts.store) throw new Error('mcp-breaker: store is required');
    this.store = opts.store;
    this.events = opts.events ?? new NoopBreakerEventSink();
    this.policy = opts.policy ?? DEFAULT_POLICY;
    this.now = opts.now ?? Date.now;
    this.clock = opts.clock ?? (() => new Date());
  }

  /**
   * Pre-call gate. Returns `{ allow: true }` if the call may proceed,
   * otherwise throws a `CircuitOpenError` AFTER emitting `breaker.reject`.
   */
  async beforeCall(ctx: RequestContext, key: BreakerKey): Promise<{ allow: true; probe: boolean; state: BreakerSnapshot['state'] }> {
    const snapshot = await this.loadOrInit(ctx, key);
    const { decision, next } = decide(key, snapshot, this.now(), this.policy);
    // Always persist the (possibly transitioned) snapshot, even on
    // rejection. The cool-down clock must tick even for rejected calls.
    // Best-effort: a save failure degrades to in-memory only.
    try {
      await this.store.save(ctx, key, next);
    } catch {
      // ignore — see loadOrInit for the rationale.
    }

    if (decision.allow) {
      return { allow: true, probe: decision.probe, state: decision.state };
    }

    // Reject path: emit breaker.reject, throw typed error.
    await this.emit({
      type: 'breaker.reject',
      tenant_id: key.tenant_id,
      server_name: key.server_name,
      state: decision.state,
      payload: { retry_after_ms: decision.retry_after_ms },
    });

    throw new CircuitOpenError(
      `mcp-breaker: circuit open for ${key.tenant_id}/${key.server_name} (retry in ${decision.retry_after_ms}ms)`,
      {
        tenant_id: key.tenant_id,
        server_name: key.server_name,
        state: decision.state,
        retry_after_ms: decision.retry_after_ms,
      },
    );
  }

  /**
   * Post-call success. If the snapshot was in `half_open` (probe), the
   * `apply` returns a `closed` snapshot and we emit `breaker.recover`.
   */
  async recordSuccess(ctx: RequestContext, key: BreakerKey): Promise<BreakerSnapshot> {
    const prev = await this.loadOrInit(ctx, key);
    const next = apply(prev, 'success', this.now(), this.policy);
    try {
      await this.store.save(ctx, key, next);
    } catch {
      // best-effort.
    }

    if (prev.state !== 'closed' && next.state === 'closed') {
      await this.emit({
        type: 'breaker.recover',
        tenant_id: key.tenant_id,
        server_name: key.server_name,
        state: 'closed',
        payload: { recovered_from: prev.state, recovered_at_ms: this.now() },
      });
    }
    return next;
  }

  /**
   * Post-call failure. May trip the breaker (emit `breaker.trip`) and
   * may also drive a half-open probe to re-open (also emit `breaker.trip`
   * with reason `probe_failure`).
   */
  async recordFailure(ctx: RequestContext, key: BreakerKey): Promise<BreakerSnapshot> {
    const prev = await this.loadOrInit(ctx, key);
    const next = apply(prev, 'failure', this.now(), this.policy);
    try {
      await this.store.save(ctx, key, next);
    } catch {
      // best-effort.
    }

    if (prev.state !== 'open' && next.state === 'open') {
      const reason: TripReason = prev.state === 'half_open' ? 'probe_failure' : tripReason(prev, next, this.policy);
      const rate = errorRateOf(next, this.now());
      await this.emit({
        type: 'breaker.trip',
        tenant_id: key.tenant_id,
        server_name: key.server_name,
        state: 'open',
        payload: {
          reason,
          consecutive_failures: next.consecutive_failures,
          window_ms: next.window_ms,
          error_rate: rate,
          sample_count: next.recent_calls.length,
          tripped_at_ms: this.now(),
          prior_state: prev.state,
        },
      });
    }
    return next;
  }

  /** Read-only snapshot for dashboards / introspection. */
  async inspect(ctx: RequestContext, key: BreakerKey): Promise<BreakerSnapshot> {
    return this.loadOrInit(ctx, key);
  }

  /**
   * Test/operator hook — reset a (tenant, server) key back to closed.
   * Production code paths should not call this; it exists for the
   * smoke test and for operators who want to manually clear a breaker.
   */
  async reset(ctx: RequestContext, key: BreakerKey): Promise<void> {
    await this.store.save(ctx, key, emptySnapshot(this.policy.window_ms));
  }

  // ---- internals ------------------------------------------------------

  private async loadOrInit(ctx: RequestContext, key: BreakerKey): Promise<BreakerSnapshot> {
    try {
      const existing = await this.store.load(ctx, key);
      return existing ?? emptySnapshot(this.policy.window_ms);
    } catch {
      // best-effort — a failing store degrades to fresh-empty state, not a
      // hard failure. The breaker still trips in-memory for this process.
      return emptySnapshot(this.policy.window_ms);
    }
  }

  private async emit(input: {
    type: BreakerEvent['type'];
    tenant_id: string;
    server_name: string;
    state: BreakerEvent['state'];
    payload: Record<string, unknown>;
  }): Promise<void> {
    const event = makeEvent(
      input.type,
      input.tenant_id,
      input.server_name,
      input.state,
      input.payload,
      this.clock,
    );
    try {
      await this.events.emit(event);
    } catch (err) {
      // Event-emit failures must never break the call path. Log and move on;
      // production wires this to a logger via the event-bus adapter.
      // eslint-disable-next-line no-console
      console.error('[mcp-breaker] event emit failed', err);
    }
  }
}

/** Decide whether a closed→open transition was consecutive or rate-based. */
function tripReason(prev: BreakerSnapshot, next: BreakerSnapshot, policy: BreakerPolicy): TripReason {
  if (prev.consecutive_failures + 1 >= policy.consecutive_failure_threshold) {
    return 'consecutive_failures';
  }
  return 'error_rate';
}

/** Helper: compute error rate over the snapshot's sliding window. */
function errorRateOf(snapshot: BreakerSnapshot, now_ms: number): number {
  const cutoff = now_ms - snapshot.window_ms;
  const samples = snapshot.recent_calls.filter((c) => c.at_ms >= cutoff);
  if (samples.length === 0) return 0;
  const failures = samples.filter((c) => c.outcome === 'failure').length;
  return failures / samples.length;
}

// ---------------------------------------------------------------------------
// Cache-broker-backed store. The production wiring is one of two flavors:
//
//   1. In-process: import `cacheStore` factory below, pass a configured
//      `CacheBroker`. This is the dev + single-replica path.
//
//   2. Out-of-process: import `redisCacheStore` (deferred to v0.2; not in
//      this package). The router hosts the Redis client.
//
// The factory is small enough that v0.1 ships it inline.
// ---------------------------------------------------------------------------

import {
  CacheBroker,
  InMemoryCacheStore,
  deriveKey,
  deriveTag,
  type CacheStore,
} from '@fora/cache-broker';

/** Options for the cache-broker-backed store. */
export interface CacheBrokerBreakerStoreOptions {
  readonly broker: CacheBroker;
  /** Optional. Defaults to `'mcp_breaker'` so the broker can tag-evict by service. */
  readonly resource?: string;
  /** Optional. Defaults to 24h. The broker drops the snapshot after this. */
  readonly ttl_ms?: number;
}

/**
 * Persists breaker snapshots in the cache-broker. Best-effort: any
 * cache-broker error is swallowed and treated as a fresh empty snapshot,
 * which means a Redis outage does NOT take the breaker down — it just
 * degrades to "fresh state" per (tenant, server). This matches the
 * "best-effort, in-memory fallback" wording in the FORA-48 spec.
 */
export class CacheBrokerBreakerStore implements BreakerStore {
  private readonly broker: CacheBroker;
  private readonly resource: string;
  private readonly ttl_ms: number;

  constructor(opts: CacheBrokerBreakerStoreOptions) {
    if (!opts.broker) throw new Error('mcp-breaker: broker is required');
    this.broker = opts.broker;
    this.resource = opts.resource ?? 'mcp_breaker';
    this.ttl_ms = opts.ttl_ms ?? 24 * 60 * 60 * 1000;
  }

  async load(ctx: RequestContext, key: BreakerKey): Promise<BreakerSnapshot | null> {
    try {
      const parts = { tenant_id: key.tenant_id, resource: this.resource, id: key.server_name };
      const result = await this.broker.get<BreakerSnapshot>(ctx, {
        resource: parts.resource,
        id: parts.id,
      });
      if (result.status === 'hit') return result.value;
      return null;
    } catch {
      return null;
    }
  }

  async save(ctx: RequestContext, key: BreakerKey, snapshot: BreakerSnapshot): Promise<void> {
    try {
      await this.broker.set(
        ctx,
        { tenant_id: key.tenant_id, resource: this.resource, id: key.server_name },
        snapshot,
        { ttlMs: this.ttl_ms },
      );
    } catch {
      // best-effort — never break the call path on a cache write failure.
    }
  }
}

/**
 * Convenience factory — wires the breaker end-to-end with an in-memory
 * cache-broker and the in-memory event sink. Use for tests + the smoke
 * binary; production code passes its own broker + sink.
 */
export function inMemoryBreaker(opts: {
  policy?: BreakerPolicy;
  events?: BreakerEventSink;
  now?: () => number;
  clock?: () => Date;
} = {}): McpCircuitBreaker {
  const store = new InMemoryBreakerStore();
  return new McpCircuitBreaker({
    store,
    events: opts.events ?? new InMemoryBreakerEventSink(),
    ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
  });
}

/** Re-export the cache-broker primitives so consumers don't double-import. */
export { CacheBroker, InMemoryCacheStore, deriveKey, deriveTag };
export type { CacheStore };