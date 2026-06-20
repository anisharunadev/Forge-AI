/**
 * @fora/cache-broker — acceptance tests
 *
 * Covers the scenarios named in FORA-165 and FORA-124 acceptance bar #4:
 *   1. A warm cache cannot serve cross-tenant data: a tenant-B get for a key
 *      written by tenant A returns `tenant_mismatch` and the audit event is
 *      queryable in FORA-36 (here: the InMemoryAuditSink).
 *   2. A `set` with a tenant_id that does not match the bound context throws
 *      TenantMismatchError and emits the audit event.
 *   3. A same-tenant round trip returns `hit` with the original value.
 *   4. Two tenants writing to the same `(resource, id)` pair: last-writer
 *      wins on the value, the loser reads `tenant_mismatch` next.
 *   5. Two tenants writing to the same `(resource, id)` with DIFFERENT ids
 *      do not collide on the hashed key (the hash is keyed on the id).
 *   6. The audit event shape is the canonical `tenancy.denied` field set.
 */

import { describe, it, expect } from 'vitest';
import {
  CacheBroker,
  InMemoryAuditSink,
  InMemoryCacheStore,
  TenantMismatchError,
  deriveKey,
  type RequestContext,
} from '../src/index.js';

const ctxA: RequestContext = {
  tenant_id: 'tnt_A',
  principal: 'agent',
  actor: 'agent:developer:run-001',
  trace_id: '01HXYZTRACE_A',
};

const ctxB: RequestContext = {
  tenant_id: 'tnt_B',
  principal: 'agent',
  actor: 'agent:developer:run-002',
  trace_id: '01HXYZTRACE_B',
};

function makeBroker() {
  const store = new InMemoryCacheStore();
  const audit = new InMemoryAuditSink();
  const broker = new CacheBroker({ store, audit });
  return { store, audit, broker };
}

describe('cache-broker · keys', () => {
  it('hashes the same resource+id under different tenants to the SAME key (shared namespace)', () => {
    const k1 = deriveKey({ resource: 'project', id: 'p1' });
    const k2 = deriveKey({ resource: 'project', id: 'p1' });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashes different ids under the same resource to different keys', () => {
    const k1 = deriveKey({ resource: 'project', id: 'p1' });
    const k2 = deriveKey({ resource: 'project', id: 'p2' });
    expect(k1).not.toBe(k2);
  });

  it('throws when resource or id is missing', () => {
    expect(() => deriveKey({ resource: '' as never, id: 'p1' })).toThrow();
    expect(() => deriveKey({ resource: 'project', id: '' })).toThrow();
  });
});

describe('cache-broker · get/set round trip (same tenant)', () => {
  it('returns hit for a key the same tenant wrote', async () => {
    const { broker } = makeBroker();
    const key = await broker.set(ctxA, { tenant_id: ctxA.tenant_id, resource: 'project', id: 'p1' }, { name: 'Acme' });
    expect(key).toMatch(/^[a-f0-9]{64}$/);

    const result = await broker.get<{ name: string }>(ctxA, { resource: 'project', id: 'p1' });
    expect(result.status).toBe('hit');
    if (result.status === 'hit') expect(result.value).toEqual({ name: 'Acme' });
  });

  it('returns miss for a key that was never written', async () => {
    const { broker } = makeBroker();
    const result = await broker.get<unknown>(ctxA, { resource: 'project', id: 'nope' });
    expect(result.status).toBe('miss');
  });
});

describe('cache-broker · cross-tenant read (acceptance bar #4)', () => {
  it('returns tenant_mismatch when tenant B reads a key tenant A wrote, and emits the audit event', async () => {
    const { broker, audit } = makeBroker();
    await broker.set(ctxA, { tenant_id: ctxA.tenant_id, resource: 'project', id: 'shared-id' }, { secret: 'A' });

    const result = await broker.get<unknown>(ctxB, { resource: 'project', id: 'shared-id' });
    expect(result.status).toBe('tenant_mismatch');
    if (result.status === 'tenant_mismatch') {
      expect(result.reason).toBe('key_tenant_mismatch');
    }

    // The audit event must be queryable in the same shape the JSONL sink writes.
    expect(audit.events).toHaveLength(1);
    const ev = audit.events[0]!;
    expect(ev.event_type).toBe('tenancy.denied');
    expect(ev.attempted_tenant_id).toBe('tnt_B');
    expect(ev.actual_tenant_id).toBe('tnt_A');
    expect(ev.resource).toBe('cache');
    expect(ev.actor).toBe('agent:developer:run-002');
    expect(ev.trace_id).toBe('01HXYZTRACE_B');
    expect(typeof ev.timestamp).toBe('string');
    expect(ev.metadata).toBeTypeOf('object');
    expect(ev.metadata.key_prefix).toMatch(/^[a-f0-9]{12}$/);
    expect(ev.metadata.resource).toBe('project');
  });

  it('two tenants writing the same (resource, id) result in last-writer-wins; the loser reads tenant_mismatch', async () => {
    const { broker, store } = makeBroker();
    await broker.set(ctxA, { tenant_id: ctxA.tenant_id, resource: 'project', id: 'p1' }, 'A');
    await broker.set(ctxB, { tenant_id: ctxB.tenant_id, resource: 'project', id: 'p1' }, 'B');

    // Shared key (one entry in the store).
    expect(store.size()).toBe(1);

    // B reads its own value.
    const b = await broker.get<string>(ctxB, { resource: 'project', id: 'p1' });
    expect(b).toMatchObject({ status: 'hit', value: 'B' });

    // A reads and finds B's value tagged for B → tenant_mismatch.
    const a = await broker.get<string>(ctxA, { resource: 'project', id: 'p1' });
    expect(a.status).toBe('tenant_mismatch');
  });

  it('two tenants writing different ids do not collide on the hashed key', async () => {
    const { broker, store } = makeBroker();
    const kA = await broker.set(ctxA, { tenant_id: ctxA.tenant_id, resource: 'project', id: 'p1' }, 'A');
    const kB = await broker.set(ctxB, { tenant_id: ctxB.tenant_id, resource: 'project', id: 'p2' }, 'B');
    expect(kA).not.toBe(kB);
    expect(store.size()).toBe(2);
  });
});

describe('cache-broker · set with mismatched tenant', () => {
  it('throws TenantMismatchError and emits the audit event', async () => {
    const { broker, audit } = makeBroker();
    await expect(
      broker.set(ctxA, { tenant_id: 'tnt_B', resource: 'project', id: 'p1' }, { x: 1 }),
    ).rejects.toBeInstanceOf(TenantMismatchError);

    expect(audit.events).toHaveLength(1);
    const ev = audit.events[0]!;
    expect(ev.event_type).toBe('tenancy.denied');
    expect(ev.attempted_tenant_id).toBe('tnt_B');
    expect(ev.actual_tenant_id).toBe('tnt_A');
    expect(ev.resource).toBe('cache');
  });
});

describe('cache-broker · audit event shape (canonical tenancy.denied)', () => {
  it('emits the same field set for every resource the broker handles', async () => {
    const { broker, audit } = makeBroker();
    await broker.set(ctxA, { tenant_id: ctxA.tenant_id, resource: 'project', id: 'p1' }, 1);
    await broker.get(ctxB, { resource: 'project', id: 'p1' });
    expect(audit.events).toHaveLength(1);

    const ev = audit.events[0]!;
    // The canonical shape — same as db-pool (0.7.2b) and object-store (0.7.2c).
    expect(Object.keys(ev).sort()).toEqual(
      ['actor', 'attempted_tenant_id', 'actual_tenant_id', 'event_type', 'metadata', 'resource', 'timestamp', 'trace_id'].sort(),
    );
  });
});
