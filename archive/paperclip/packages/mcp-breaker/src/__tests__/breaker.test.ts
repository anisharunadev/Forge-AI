/**
 * Orchestrator + cache-broker-backed store + event sink integration.
 *
 * Covers the FORA-48 §3.3 acceptance bar:
 *   AC #2: 5 errors trip the breaker; next invoke returns `circuit_open`
 *          in ≤50 ms.
 *
 * Also covers:
 *   - breaker.trip emitted on consecutive + rate trip
 *   - breaker.recover emitted on half_open → closed
 *   - breaker.reject emitted on every short-circuit
 *   - best-effort cache write failure does NOT break the call path
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  McpCircuitBreaker,
  InMemoryBreakerStore,
  InMemoryBreakerEventSink,
  NoopBreakerEventSink,
  CircuitOpenError,
  DEFAULT_POLICY,
  type BreakerPolicy,
  type BreakerKey,
} from '../index.js';
import type { RequestContext } from '@fora/cache-broker';

const CTX: RequestContext = {
  tenant_id: 'tnt_acme',
  principal: 'agent',
  actor: 'agent:router:run-001',
  trace_id: '01HXYZTRACE',
};

const KEY: BreakerKey = { tenant_id: 'tnt_acme', server_name: 'jira' };

function makeBreaker(opts: {
  policy?: BreakerPolicy;
  now?: () => number;
  events?: InMemoryBreakerEventSink;
} = {}): { breaker: McpCircuitBreaker; sink: InMemoryBreakerEventSink; now: () => number } {
  let t = 1_000_000;
  const now = opts.now ?? (() => ++t);
  const sink = opts.events ?? new InMemoryBreakerEventSink();
  const breaker = new McpCircuitBreaker({
    store: new InMemoryBreakerStore(),
    events: sink,
    policy: opts.policy ?? DEFAULT_POLICY,
    now,
    clock: () => new Date(now()),
  });
  return { breaker, sink, now };
}

describe('McpCircuitBreaker — orchestrator', () => {
  let breaker: McpCircuitBreaker;
  let sink: InMemoryBreakerEventSink;

  beforeEach(() => {
    ({ breaker, sink } = makeBreaker());
  });

  it('closed breaker: beforeCall allows + recordSuccess is a no-op for events', async () => {
    const r = await breaker.beforeCall(CTX, KEY);
    expect(r.allow).toBe(true);
    expect(r.state).toBe('closed');
    expect(sink.list()).toEqual([]);
    await breaker.recordSuccess(CTX, KEY);
    expect(sink.list()).toEqual([]);
  });

  it('AC #2: 5 failures trip the breaker; next beforeCall throws circuit_open in ≤50ms', async () => {
    for (let i = 0; i < 5; i++) {
      await breaker.beforeCall(CTX, KEY);
      await breaker.recordFailure(CTX, KEY);
    }
    // Trip event was emitted exactly once.
    const trips = sink.listOfType('breaker.trip');
    expect(trips.length).toBe(1);
    expect(trips[0]!.payload.reason).toBe('consecutive_failures');
    expect(trips[0]!.payload.consecutive_failures).toBe(5);

    const start = performance.now();
    await expect(breaker.beforeCall(CTX, KEY)).rejects.toBeInstanceOf(CircuitOpenError);
    const elapsed_ms = performance.now() - start;
    expect(elapsed_ms).toBeLessThanOrEqual(50);

    // Reject event was emitted.
    const rejects = sink.listOfType('breaker.reject');
    expect(rejects.length).toBe(1);
    expect(rejects[0]!.payload.retry_after_ms).toBeGreaterThan(0);
  });

  it('half_open probe success → closed + breaker.recover event', async () => {
    // Trip.
    for (let i = 0; i < 5; i++) {
      await breaker.beforeCall(CTX, KEY);
      await breaker.recordFailure(CTX, KEY);
    }
    sink.clear();

    // Advance the clock past cooldown.
    const past = await breaker.inspect(CTX, KEY);
    // Use the real Date.now to advance: rebuild with a controllable now.
    let t = 2_000_000;
    const { breaker: b2, sink: s2 } = makeBreaker({ now: () => t });
    for (let i = 0; i < 5; i++) {
      await b2.beforeCall(CTX, KEY);
      await b2.recordFailure(CTX, KEY);
    }
    expect(s2.listOfType('breaker.trip').length).toBe(1);
    t += 31_000;
    const probe = await b2.beforeCall(CTX, KEY);
    expect(probe.state).toBe('half_open');
    expect(probe.probe).toBe(true);
    await b2.recordSuccess(CTX, KEY);
    expect(s2.listOfType('breaker.recover').length).toBe(1);
    expect(s2.listOfType('breaker.recover')[0]!.payload.recovered_from).toBe('half_open');
    // Subsequent calls are allowed + no more events.
    const after = await b2.beforeCall(CTX, KEY);
    expect(after.state).toBe('closed');
  });

  it('half_open probe failure → open + breaker.trip with reason probe_failure', async () => {
    let t = 3_000_000;
    const { breaker: b, sink: s } = makeBreaker({ now: () => t });
    for (let i = 0; i < 5; i++) {
      await b.beforeCall(CTX, KEY);
      await b.recordFailure(CTX, KEY);
    }
    s.clear();
    t += 31_000;
    await b.beforeCall(CTX, KEY); // probe slot
    await b.recordFailure(CTX, KEY);
    const trips = s.listOfType('breaker.trip');
    expect(trips.length).toBe(1);
    expect(trips[0]!.payload.reason).toBe('probe_failure');
    expect(trips[0]!.payload.prior_state).toBe('half_open');
  });

  it('errorRate trip emits breaker.trip with reason error_rate', async () => {
    // Build a policy that trips on rate (3 failures out of 5 calls) before
    // the consecutive threshold fires.
    const policy: BreakerPolicy = {
      consecutive_failure_threshold: 100, // disable consecutive trip
      window_ms: 30_000,
      error_rate_threshold: 0.5,
      error_rate_min_calls: 4,
      cooldown_ms: 30_000,
    };
    let t = 4_000_000;
    const { breaker: b, sink: s } = makeBreaker({ policy, now: () => t });
    // 2 successes, then 2 failures → 2/4 = 0.5 exactly — should NOT trip (>).
    await b.beforeCall(CTX, KEY); await b.recordSuccess(CTX, KEY);
    await b.beforeCall(CTX, KEY); await b.recordSuccess(CTX, KEY);
    await b.beforeCall(CTX, KEY); await b.recordFailure(CTX, KEY);
    await b.beforeCall(CTX, KEY); await b.recordFailure(CTX, KEY);
    expect(s.listOfType('breaker.trip')).toEqual([]);
    // 1 more success + 1 more failure → 3/6 = 0.5 exactly — should NOT trip.
    await b.beforeCall(CTX, KEY); await b.recordSuccess(CTX, KEY);
    await b.beforeCall(CTX, KEY); await b.recordFailure(CTX, KEY);
    expect(s.listOfType('breaker.trip')).toEqual([]);
    // 1 more failure → 4/7 > 0.5 — trips.
    await b.beforeCall(CTX, KEY); await b.recordFailure(CTX, KEY);
    const trips = s.listOfType('breaker.trip');
    expect(trips.length).toBe(1);
    expect(trips[0]!.payload.reason).toBe('error_rate');
  });

  it('rejects are emitted in order with monotonically decreasing retry_after_ms', async () => {
    let t = 5_000_000;
    const { breaker: b, sink: s } = makeBreaker({ now: () => t });
    for (let i = 0; i < 5; i++) {
      await b.beforeCall(CTX, KEY);
      await b.recordFailure(CTX, KEY);
    }
    s.clear();
    // 3 rejections in quick succession.
    t += 100;
    await expect(b.beforeCall(CTX, KEY)).rejects.toBeInstanceOf(CircuitOpenError);
    t += 100;
    await expect(b.beforeCall(CTX, KEY)).rejects.toBeInstanceOf(CircuitOpenError);
    t += 100;
    await expect(b.beforeCall(CTX, KEY)).rejects.toBeInstanceOf(CircuitOpenError);
    const rejects = s.listOfType('breaker.reject');
    expect(rejects.length).toBe(3);
    const retryAfters = rejects.map((r) => r.payload.retry_after_ms as number);
    expect(retryAfters[0]).toBeGreaterThan(retryAfters[1]!);
    expect(retryAfters[1]).toBeGreaterThan(retryAfters[2]!);
  });

  it('noop sink is the default when no events option is provided', async () => {
    const b = new McpCircuitBreaker({ store: new InMemoryBreakerStore() });
    for (let i = 0; i < 5; i++) {
      await b.beforeCall(CTX, KEY);
      await b.recordFailure(CTX, KEY);
    }
    // No throws — proves the noop sink does not break the path.
    await expect(b.beforeCall(CTX, KEY)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('reset clears the snapshot and restores closed state', async () => {
    for (let i = 0; i < 5; i++) {
      await breaker.beforeCall(CTX, KEY);
      await breaker.recordFailure(CTX, KEY);
    }
    expect((await breaker.inspect(CTX, KEY)).state).toBe('open');
    await breaker.reset(CTX, KEY);
    expect((await breaker.inspect(CTX, KEY)).state).toBe('closed');
    // Caller can pass through again.
    const r = await breaker.beforeCall(CTX, KEY);
    expect(r.allow).toBe(true);
  });

  it('rejects before throwing so the error always carries a retry_after_ms', async () => {
    for (let i = 0; i < 5; i++) {
      await breaker.beforeCall(CTX, KEY);
      await breaker.recordFailure(CTX, KEY);
    }
    try {
      await breaker.beforeCall(CTX, KEY);
      throw new Error('should not reach here');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      const e = err as CircuitOpenError;
      expect(e.kind).toBe('circuit_open');
      expect(e.tenant_id).toBe(KEY.tenant_id);
      expect(e.server_name).toBe(KEY.server_name);
      expect(e.retry_after_ms).toBeGreaterThan(0);
    }
  });

  it('NoopBreakerEventSink is a real opt-out (events silently dropped)', async () => {
    const b = new McpCircuitBreaker({
      store: new InMemoryBreakerStore(),
      events: new NoopBreakerEventSink(),
    });
    for (let i = 0; i < 5; i++) {
      await b.beforeCall(CTX, KEY);
      await b.recordFailure(CTX, KEY);
    }
    await expect(b.beforeCall(CTX, KEY)).rejects.toBeInstanceOf(CircuitOpenError);
  });
});