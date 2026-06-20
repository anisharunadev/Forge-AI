/**
 * BackoffScheduler tests — orchestrator + TenantWeightedFifo (FORA-487.3 / FORA-517).
 *
 * AC coverage:
 *   - execute() retries idempotent calls up to 5 attempts
 *   - execute() does NOT retry non-idempotent POST (max=1)
 *   - sync_op dedupe: pre-call check returns cached result, post-call write persists
 *   - Audit events: `connector.backoff.retried` on each successful retry,
 *     `connector.backoff.exhausted` when budget is hit
 *   - Per-attempt `backoff_ms` is recorded in the audit payload
 *   - Tenant-weighted FIFO: round-robin pulls across tenants; quiet tenant is not starved
 *   - Injectable `sleep` and `now` make the suite deterministic and fast
 */

import { describe, it, expect, vi } from 'vitest';
import {
  BackoffScheduler,
  TenantWeightedFifo,
  InMemoryAuditSink,
  InMemorySyncOpStore,
  BackoffPolicy,
  type SchedulerCall,
  type PlatformCallResultForBackoff,
  type HttpVerb,
} from '../index.js';

function ok(status = 200, body: unknown = null, headers: Record<string, string> = {}): PlatformCallResultForBackoff {
  return { status, headers, body };
}

function call(opts: {
  tenant_id?: string;
  platform?: SchedulerCall['platform'];
  connector_id?: string;
  verb?: HttpVerb;
  execute: SchedulerCall['execute'];
  idempotency_key?: string;
  max_attempts?: number;
  is_retryable?: SchedulerCall['is_retryable'];
}): SchedulerCall {
  return {
    tenant_id: opts.tenant_id ?? 'tenant-A',
    platform: opts.platform ?? 'jira',
    connector_id: opts.connector_id ?? 'conn-1',
    verb: opts.verb ?? 'GET',
    execute: opts.execute,
    ...(opts.idempotency_key !== undefined ? { idempotency_key: opts.idempotency_key } : {}),
    ...(opts.max_attempts !== undefined ? { max_attempts: opts.max_attempts } : {}),
    ...(opts.is_retryable !== undefined ? { is_retryable: opts.is_retryable } : {}),
  };
}

describe('BackoffScheduler', () => {
  it('returns the first success without retrying', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const s = new BackoffScheduler({ audit, sync_op, sleep: async () => undefined });
    const exec = vi.fn(async () => ok(200, { ok: true }));
    const r = await s.execute(call({ execute: exec }));
    expect(r.attempts).toBe(1);
    expect(r.retried).toBe(false);
    expect(r.exhausted).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(audit.list()).toHaveLength(0); // no retry → no audit
  });

  it('retries an idempotent GET on 5xx and emits retried + final exhausted if budget hit', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    // Zero-jitter RNG so the backoff is exactly min(ceiling, base*2^n).
    const policy = new BackoffPolicy({ rng: () => 0 });
    const sleep = vi.fn(async () => undefined);
    const s = new BackoffScheduler({ audit, sync_op, policy, sleep });
    const exec = vi
      .fn<SchedulerCall['execute']>()
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(503));
    const r = await s.execute(call({ verb: 'GET', execute: exec, max_attempts: 5 }));
    expect(r.attempts).toBe(5);
    expect(r.retried).toBe(true);
    expect(r.exhausted).toBe(true);
    expect(r.backoff_ms).toEqual([500, 1000, 2000, 4000]);
    // 4 retries → 4 retried events. 1 exhausted event. 0 success events.
    expect(audit.listOfType('connector.backoff.retried')).toHaveLength(4);
    expect(audit.listOfType('connector.backoff.exhausted')).toHaveLength(1);
    const exhausted = audit.listOfType('connector.backoff.exhausted')[0]!;
    expect(exhausted.payload.attempts).toBe(5);
    expect(exhausted.payload.final_status).toBe(503);
  });

  it('emits `connector.backoff.retried` then resolves on a successful retry', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const policy = new BackoffPolicy({ rng: () => 0 });
    const s = new BackoffScheduler({ audit, sync_op, policy, sleep: async () => undefined });
    const exec = vi
      .fn<SchedulerCall['execute']>()
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(200, { ok: true }));
    const r = await s.execute(call({ verb: 'GET', execute: exec, max_attempts: 5 }));
    expect(r.attempts).toBe(2);
    expect(r.retried).toBe(true);
    expect(r.exhausted).toBe(false);
    expect(audit.listOfType('connector.backoff.retried')).toHaveLength(1);
    expect(audit.listOfType('connector.backoff.exhausted')).toHaveLength(0);
    const retried = audit.listOfType('connector.backoff.retried')[0]!;
    expect(retried.payload.backoff_ms).toBe(500);
    expect(retried.payload.attempt).toBe(1);
    expect(retried.payload.next_attempt).toBe(2);
  });

  it('does NOT retry a POST (non-idempotent, max=1)', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const s = new BackoffScheduler({ audit, sync_op, sleep: async () => undefined });
    const exec = vi.fn(async () => ok(503));
    const r = await s.execute(call({ verb: 'POST', execute: exec }));
    expect(r.attempts).toBe(1);
    expect(r.exhausted).toBe(false); // max=1 → never exhausts, just returns 503
    expect(audit.list()).toHaveLength(0);
  });

  it('honors `Retry-After: 0` as the floor (1ms) and still completes', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const policy = new BackoffPolicy({ rng: () => 0 });
    const sleep = vi.fn(async () => undefined);
    const s = new BackoffScheduler({ audit, sync_op, policy, sleep });
    const exec = vi
      .fn<SchedulerCall['execute']>()
      .mockResolvedValueOnce(ok(429, null, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(ok(200, { ok: true }));
    const r = await s.execute(call({ verb: 'GET', execute: exec }));
    expect(r.attempts).toBe(2);
    // floor=1, not 0
    expect(r.backoff_ms[0]).toBe(1);
  });

  it('dedupes via sync_op: second call with same Idempotency-Key short-circuits', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const s = new BackoffScheduler({ audit, sync_op, sleep: async () => undefined });
    const exec1 = vi.fn(async () => ok(200, { id: 42 }));
    const exec2 = vi.fn(async () => ok(200, { id: 999 })); // would return different body
    const idem = uuidV7Fixed('fixed-idem-1');
    const r1 = await s.execute(call({ execute: exec1, idempotency_key: idem }));
    const r2 = await s.execute(call({ execute: exec2, idempotency_key: idem }));
    expect(r1.cached).toBe(false);
    expect(r1.attempts).toBe(1);
    expect(r2.cached).toBe(true);
    expect(r2.attempts).toBe(0);
    expect((r2.result.body as { id: number }).id).toBe(42);
    // exec2 must NOT have been called — the cache returned the prior result.
    expect(exec2).not.toHaveBeenCalled();
    expect(sync_op.size()).toBe(1);
  });

  it('emits `connector.backoff.exhausted` only on a non-2xx final outcome', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const policy = new BackoffPolicy({ rng: () => 0 });
    const s = new BackoffScheduler({ audit, sync_op, policy, sleep: async () => undefined });
    // GET with max_attempts=2 and 503 → 503: should emit 1 retried + 1 exhausted.
    const exec = vi
      .fn<SchedulerCall['execute']>()
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(503));
    const r = await s.execute(call({ verb: 'GET', execute: exec, max_attempts: 2 }));
    expect(r.attempts).toBe(2);
    expect(r.exhausted).toBe(true);
    expect(audit.listOfType('connector.backoff.retried')).toHaveLength(1);
    expect(audit.listOfType('connector.backoff.exhausted')).toHaveLength(1);
  });

  it('persists the final outcome to sync_op on success', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const s = new BackoffScheduler({ audit, sync_op, sleep: async () => undefined });
    const idem = uuidV7Fixed('idem-success');
    const r = await s.execute(call({ execute: async () => ok(200, { id: 7 }), idempotency_key: idem }));
    expect(r.cached).toBe(false);
    const cached = await sync_op.getIfPresent('conn-1', idem);
    expect(cached).not.toBeNull();
    expect(cached!.status).toBe(200);
    expect(cached!.result).toEqual({ id: 7 });
  });

  it('persists even a non-2xx final outcome (so replays return the same status)', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const s = new BackoffScheduler({ audit, sync_op, sleep: async () => undefined });
    const idem = uuidV7Fixed('idem-400');
    const r = await s.execute(call({ verb: 'POST', execute: async () => ok(400, { err: 'bad' }), idempotency_key: idem }));
    expect(r.attempts).toBe(1);
    const cached = await sync_op.getIfPresent('conn-1', idem);
    expect(cached!.status).toBe(400);
  });

  it('default max_attempts is 5 for GET and 1 for POST/PUT/PATCH/DELETE', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const policy = new BackoffPolicy({ rng: () => 0 });
    const s = new BackoffScheduler({ audit, sync_op, policy, sleep: async () => undefined });
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const exec = vi.fn(async () => ok(503));
      const r = await s.execute(call({ verb, execute: exec }));
      expect(r.attempts).toBe(verb === 'GET' ? 5 : 1);
    }
  });

  it('honors an explicit `is_retryable` override', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const s = new BackoffScheduler({ audit, sync_op, sleep: async () => undefined });
    const exec = vi.fn(async () => ok(400, { err: 'bad' }));
    // Even on a GET, declare 400 as non-retryable.
    const r = await s.execute(
      call({
        verb: 'GET',
        execute: exec,
        is_retryable: (res) => res.status >= 500,
      }),
    );
    expect(r.attempts).toBe(1);
    expect(r.retried).toBe(false);
  });
});

describe('TenantWeightedFifo', () => {
  it('enqueues and pulls FIFO within a tenant', () => {
    const q = new TenantWeightedFifo<string>();
    q.enqueue('A', 'a1');
    q.enqueue('A', 'a2');
    q.enqueue('A', 'a3');
    expect(q.pull()).toEqual({ tenant_id: 'A', item: 'a1' });
    expect(q.pull()).toEqual({ tenant_id: 'A', item: 'a2' });
    expect(q.pull()).toEqual({ tenant_id: 'A', item: 'a3' });
    expect(q.pull()).toBeNull();
  });

  it('round-robins across tenants — quiet tenant is not starved', () => {
    const q = new TenantWeightedFifo<string>();
    q.enqueue('A', 'a1');
    q.enqueue('A', 'a2');
    q.enqueue('A', 'a3');
    q.enqueue('A', 'a4');
    q.enqueue('A', 'a5');
    q.enqueue('A', 'a6');
    q.enqueue('B', 'b1');
    // Cursor starts at 0 (tenant A). After pulling from A, the next
    // pull must visit B even though A still has items.
    expect(q.pull()).toEqual({ tenant_id: 'A', item: 'a1' });
    expect(q.pull()).toEqual({ tenant_id: 'B', item: 'b1' });
    expect(q.pull()).toEqual({ tenant_id: 'A', item: 'a2' });
  });

  it('removes a tenant from the schedule when its queue empties', () => {
    const q = new TenantWeightedFifo<string>();
    q.enqueue('A', 'a1');
    q.enqueue('B', 'b1');
    q.enqueue('B', 'b2');
    q.pull(); // A:a1 — A is now empty
    q.pull(); // B:b1
    q.pull(); // B:b2
    expect(q.tenantCount()).toBe(0);
    expect(q.pull()).toBeNull();
  });

  it('size() sums across all tenants; pendingByTenant() reports per-tenant', () => {
    const q = new TenantWeightedFifo<string>();
    q.enqueue('A', 'a1');
    q.enqueue('A', 'a2');
    q.enqueue('B', 'b1');
    expect(q.size()).toBe(3);
    expect(q.pendingByTenant()).toEqual({ A: 2, B: 1 });
  });

  it('clear() resets all state', () => {
    const q = new TenantWeightedFifo<string>();
    q.enqueue('A', 'a1');
    q.enqueue('B', 'b1');
    q.clear();
    expect(q.size()).toBe(0);
    expect(q.pull()).toBeNull();
  });

  // ----- FORA-518: weighted round-robin (headroom-aware) ------------------

  it('weighted mode: pulls the tenant with the highest headroom first', () => {
    const weights: Record<string, number> = { A: 10, B: 50, C: 30 };
    const q = new TenantWeightedFifo<string>({ weight_source: (t) => weights[t] ?? 0 });
    q.enqueue('A', 'a1');
    q.enqueue('B', 'b1');
    q.enqueue('C', 'c1');
    // B has the highest weight (50) → first pull.
    expect(q.pull()!.tenant_id).toBe('B');
    // C is now highest of the remaining (30 vs 10).
    expect(q.pull()!.tenant_id).toBe('C');
    // A last.
    expect(q.pull()!.tenant_id).toBe('A');
    expect(q.pull()).toBeNull();
  });

  it('weighted mode: tie-break is cursor-stable (no bouncing when weights are equal)', () => {
    const q = new TenantWeightedFifo<string>({ weight_source: () => 10 });
    q.enqueue('A', 'a1');
    q.enqueue('B', 'b1');
    q.enqueue('C', 'c1');
    // All weights equal → cursor wins (insertion order).
    expect(q.pull()!.tenant_id).toBe('A');
    expect(q.pull()!.tenant_id).toBe('B');
    expect(q.pull()!.tenant_id).toBe('C');
  });

  it('weighted mode: weight-0 tenant still gets pulled (the "quiet tenant gets its turn" guarantee)', () => {
    const weights: Record<string, number> = { A: 100, B: 0 };
    const q = new TenantWeightedFifo<string>({ weight_source: (t) => weights[t] ?? 0 });
    q.enqueue('A', 'a1');
    q.enqueue('A', 'a2');
    q.enqueue('B', 'b1');
    // A is drained first (highest weight).
    expect(q.pull()!.tenant_id).toBe('A');
    expect(q.pull()!.tenant_id).toBe('A');
    // B is the only remaining tenant → pulled even with weight 0.
    expect(q.pull()!.tenant_id).toBe('B');
  });

  it('weighted mode: weight_source is consulted per pull (headroom can shift)', () => {
    let A_weight = 100;
    let B_weight = 10;
    const q = new TenantWeightedFifo<string>({
      weight_source: (t) => (t === 'A' ? A_weight : B_weight),
    });
    q.enqueue('A', 'a1');
    q.enqueue('B', 'b1');
    // A first (high weight).
    expect(q.pull()!.tenant_id).toBe('A');
    // B is the only remaining tenant → pulled regardless of weight.
    // But before B pulls, simulate headroom shifting: drain B then
    // re-enqueue B with weight higher than A's. With the cursor
    // advanced past B, A would normally be picked. Verify weighted
    // mode picks B because the weight_source now says B > A.
    q.enqueue('B', 'b2');
    A_weight = 1;
    B_weight = 50;
    expect(q.pull()!.tenant_id).toBe('B');
  });
});

describe('BackoffScheduler drain (queue + execute combined)', () => {
  it('drains the queue round-robin and executes each call', async () => {
    const audit = new InMemoryAuditSink();
    const sync_op = new InMemorySyncOpStore();
    const s = new BackoffScheduler({ audit, sync_op, sleep: async () => undefined });
    s.enqueue(call({ tenant_id: 'A', execute: async () => ok(200, { who: 'A' }) }));
    s.enqueue(call({ tenant_id: 'A', execute: async () => ok(200, { who: 'A2' }) }));
    s.enqueue(call({ tenant_id: 'B', execute: async () => ok(200, { who: 'B' }) }));
    const { drained, results } = await s.drain();
    expect(drained).toBe(3);
    expect(results.map((r) => (r.result.body as { who: string }).who)).toEqual(['A', 'B', 'A2']);
  });

  it('enqueue returns the tenant_id and the 1-based position within the tenant queue', () => {
    const s = new BackoffScheduler({ audit: new InMemoryAuditSink(), sync_op: new InMemorySyncOpStore() });
    const p1 = s.enqueue(call({ tenant_id: 'A', execute: async () => ok(200) }));
    const p2 = s.enqueue(call({ tenant_id: 'A', execute: async () => ok(200) }));
    const p3 = s.enqueue(call({ tenant_id: 'B', execute: async () => ok(200) }));
    expect(p1).toEqual({ tenant_id: 'A', position: 1 });
    expect(p2).toEqual({ tenant_id: 'A', position: 2 });
    expect(p3).toEqual({ tenant_id: 'B', position: 1 });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic UUID v7 that just returns the input as a valid v7 string
 *  for the dedupe test. We don't need a real UUID — just a stable key. */
function uuidV7Fixed(s: string): string {
  // Pad/truncate to 32 hex chars and stamp the v7 marker.
  const hex = s.padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
