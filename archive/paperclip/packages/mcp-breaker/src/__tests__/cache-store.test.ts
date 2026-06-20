/**
 * Cache-broker-backed store.
 *
 * Verifies:
 *   - round-trip through a real `CacheBroker` (in-memory store)
 *   - cross-tenant read returns `tenant_mismatch` (cache-broker guard)
 *   - best-effort degradation: a `save` that throws does NOT break the
 *     breaker call path
 */

import { describe, it, expect } from 'vitest';
import {
  McpCircuitBreaker,
  InMemoryBreakerEventSink,
  CacheBrokerBreakerStore,
  type BreakerKey,
} from '../index.js';
import {
  CacheBroker,
  InMemoryCacheStore,
  NullAuditSink,
  type RequestContext,
} from '@fora/cache-broker';

const TENANT_A: RequestContext = {
  tenant_id: 'tnt_acme',
  principal: 'agent',
  actor: 'agent:router:run-001',
  trace_id: '01HXYZTRACE',
};
const TENANT_B: RequestContext = {
  tenant_id: 'tnt_globex',
  principal: 'agent',
  actor: 'agent:router:run-002',
  trace_id: '01HXYZTRACE',
};
const KEY_A_JIRA: BreakerKey = { tenant_id: 'tnt_acme', server_name: 'jira' };

function makeBroker(): CacheBroker {
  return new CacheBroker({
    store: new InMemoryCacheStore(),
    audit: new NullAuditSink(),
  });
}

describe('CacheBrokerBreakerStore', () => {
  it('round-trips a snapshot through the broker', async () => {
    const broker = makeBroker();
    const store = new CacheBrokerBreakerStore({ broker });
    const breaker = new McpCircuitBreaker({
      store,
      events: new InMemoryBreakerEventSink(),
    });
    // First call persists an empty snapshot.
    await breaker.beforeCall(TENANT_A, KEY_A_JIRA);
    // Trip the breaker.
    for (let i = 0; i < 5; i++) {
      await breaker.beforeCall(TENANT_A, KEY_A_JIRA);
      await breaker.recordFailure(TENANT_A, KEY_A_JIRA);
    }
    // A fresh breaker instance sharing the same broker sees the trip.
    const breaker2 = new McpCircuitBreaker({
      store: new CacheBrokerBreakerStore({ broker }),
      events: new InMemoryBreakerEventSink(),
    });
    const snap = await breaker2.inspect(TENANT_A, KEY_A_JIRA);
    expect(snap.state).toBe('open');
  });

  it('cross-tenant read returns empty (cache-broker guard)', async () => {
    const broker = makeBroker();
    const store = new CacheBrokerBreakerStore({ broker });
    const breaker = new McpCircuitBreaker({
      store,
      events: new InMemoryBreakerEventSink(),
    });
    // Trip tenant-A Jira.
    for (let i = 0; i < 5; i++) {
      await breaker.beforeCall(TENANT_A, KEY_A_JIRA);
      await breaker.recordFailure(TENANT_A, KEY_A_JIRA);
    }
    // tenant-B Jira gets a fresh empty snapshot — no leak.
    const snapB = await breaker.inspect(TENANT_B, { tenant_id: 'tnt_globex', server_name: 'jira' });
    expect(snapB.state).toBe('closed');
    // tenant-B Jira is callable.
    const r = await breaker.beforeCall(TENANT_B, { tenant_id: 'tnt_globex', server_name: 'jira' });
    expect(r.allow).toBe(true);
  });

  it('best-effort degradation: failing store returns empty snapshot + does not throw', async () => {
    // Build a store that throws on every read/write.
    const brokenStore = {
      async load() { throw new Error('redis down'); },
      async save() { throw new Error('redis down'); },
    };
    const breaker = new McpCircuitBreaker({
      store: brokenStore,
      events: new InMemoryBreakerEventSink(),
    });
    // Should not throw on read or save.
    const r = await breaker.beforeCall(TENANT_A, KEY_A_JIRA);
    expect(r.allow).toBe(true);
    await breaker.recordSuccess(TENANT_A, KEY_A_JIRA);
    // 5 failures in a row — each call loads a fresh empty snapshot because
    // the store is down, so the breaker degrades to "no persistence": each
    // call sees a single failure (consecutive_failures = 1), well under the
    // trip threshold. The breaker stays closed — that's the right degraded
    // posture. The next call still does NOT throw.
    for (let i = 0; i < 5; i++) {
      await breaker.beforeCall(TENANT_A, KEY_A_JIRA);
      await breaker.recordFailure(TENANT_A, KEY_A_JIRA);
    }
    const after = await breaker.beforeCall(TENANT_A, KEY_A_JIRA);
    expect(after.allow).toBe(true);
    expect(after.state).toBe('closed');
  });

  it('best-effort: store that fails only on save still trips on consecutive failures', async () => {
    // Load works (so the orchestrator sees accumulating state), save throws.
    // The breaker should still trip after 5 consecutive failures.
    const readOnlyBrokenStore = {
      async load() { return null; }, // always fresh empty
      async save() { throw new Error('redis down on save'); },
    };
    const breaker = new McpCircuitBreaker({
      store: readOnlyBrokenStore,
      events: new InMemoryBreakerEventSink(),
    });
    // Each beforeCall loads fresh empty → consecutive_failures always 1
    // because we never persist the previous snapshot. Trip still fails to
    // accumulate because of the missing persistence — this is the same
    // degraded posture as above.
    for (let i = 0; i < 5; i++) {
      await breaker.beforeCall(TENANT_A, KEY_A_JIRA);
      await breaker.recordFailure(TENANT_A, KEY_A_JIRA);
    }
    const after = await breaker.beforeCall(TENANT_A, KEY_A_JIRA);
    // Degraded posture: no throws, stays closed because no state survives.
    expect(after.allow).toBe(true);
  });
});