/**
 * Hash chain integrity tests — FORA-484 AC #5.
 */

import { describe, it, expect } from 'vitest';
import {
  GENESIS_HASH,
  canonicalJson,
  digestOf,
  nextHash,
  stripEventHash,
  verifyChain,
  ChainIntegrityError,
} from '../src/chain.js';
import { InMemoryStore } from '../src/store.js';
import type { ConnectorEvent } from '../src/envelope.js';

describe('hash chain primitives', () => {
  it('canonicalJson sorts keys and strips whitespace', () => {
    const a = canonicalJson({ b: 2, a: 1 });
    const b = canonicalJson({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('digestOf is stable across orderings', () => {
    const d1 = digestOf({ b: 2, a: 1 });
    const d2 = digestOf({ a: 1, b: 2 });
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('nextHash throws on bad prevHash', () => {
    const ev = makeStubEvent();
    expect(() => nextHash(ev, 'short')).toThrow(ChainIntegrityError);
  });

  it('stripEventHash removes event_hash from audit_chain', () => {
    const ev = makeStubEvent();
    const stripped = stripEventHash(ev);
    expect(stripped.audit_chain.event_hash).toBeUndefined();
    expect(stripped.audit_chain.prev_event_hash).toBe(ev.audit_chain.prev_event_hash);
  });
});

describe('verifyChain', () => {
  it('walks a clean chain end-to-end', async () => {
    const store = new InMemoryStore();
    await emitChain(store, 10);
    const events = await store.read('tnt_8XQ', 'bind_42');
    const result = verifyChain(events);
    expect(result.ok).toBe(true);
    expect(result.breaks).toHaveLength(0);
  });

  it('flags prev_hash_mismatch when an event is dropped', async () => {
    const store = new InMemoryStore();
    await emitChain(store, 5);
    const events = await store.read('tnt_8XQ', 'bind_42');
    // Drop the third event.
    const tampered = events.filter((_, i) => i !== 2);
    const result = verifyChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.breaks.some((b) => b.reason === 'prev_hash_mismatch')).toBe(true);
  });

  it('flags self_hash_mismatch when an event body is mutated', async () => {
    const store = new InMemoryStore();
    await emitChain(store, 5);
    const events = await store.read('tnt_8XQ', 'bind_42');
    // Mutate the body of the third event but keep its hashes.
    const tampered = events.map((e, i) =>
      i === 2 ? { ...e, latency_ms: 9999 } : e,
    );
    const result = verifyChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.breaks.some((b) => b.reason === 'self_hash_mismatch')).toBe(true);
  });

  it('genesis head is GENESIS_HASH', () => {
    expect(GENESIS_HASH).toBe('0'.repeat(64));
  });
});

// --- helpers ---

function makeStubEvent(): ConnectorEvent {
  return {
    event_id: 'evt-aaaaaaaaaaaaaaaaaa',
    event_type: 'jira.issue.observed',
    schema_version: '1.0.0',
    occurred_at: '2026-06-20T00:00:00.000Z',
    tenant_id: 'tnt_8XQ',
    project_id: 'prj_FORA',
    connector_id: 'jira',
    binding_id: 'bind_42',
    actor: { type: 'agent', id: 'a', role: 'developer' },
    outcome: 'success',
    reason_code: '',
    latency_ms: 1,
    request: { op: 'issue.get', args_hash: '0'.repeat(64) },
    response: null,
    artifacts_emitted: [],
    audit_chain: { prev_event_hash: '0'.repeat(64), event_hash: '0'.repeat(64) },
  };
}

async function emitChain(store: InMemoryStore, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await store.append({
      event_id: `evt-${i.toString().padStart(16, '0')}`,
      event_type: 'jira.issue.observed',
      schema_version: '1.0.0',
      occurred_at: new Date(2026, 5, 20, 0, 0, i).toISOString(),
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      connector_id: 'jira',
      binding_id: 'bind_42',
      actor: { type: 'agent', id: `a-${i}`, role: 'developer' },
      outcome: 'success',
      reason_code: '',
      latency_ms: i,
      request: { op: 'issue.get', args_hash: digestOf({ i }) },
      response: { status: 200, body_hash: digestOf({ i }), size: 100 },
      artifacts_emitted: [],
    });
  }
}