/**
 * Store tests — InMemoryStore + JsonlStore round-trip + idempotent append.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStore, JsonlStore } from '../src/store.js';
import { GENESIS_HASH, verifyChain } from '../src/chain.js';

function draft(i: number, tenant = 'tnt_8XQ', binding = 'bind_42') {
  return {
    event_id: `evt-${i.toString(16).padStart(16, '0')}`,
    event_type: 'jira.issue.observed' as const,
    schema_version: '1.0.0' as const,
    occurred_at: new Date(2026, 5, 20, 0, 0, i).toISOString(),
    tenant_id: tenant,
    project_id: 'prj_FORA',
    connector_id: 'jira' as const,
    binding_id: binding,
    actor: { type: 'agent' as const, id: `a-${i}`, role: 'developer' },
    outcome: 'success' as const,
    reason_code: '',
    latency_ms: i,
    request: { op: 'issue.get', args_hash: '0'.repeat(64) },
    response: { status: 200, body_hash: '0'.repeat(64), size: 1 },
    artifacts_emitted: [],
  };
}

describe('InMemoryStore', () => {
  it('first event chains to GENESIS_HASH', async () => {
    const s = new InMemoryStore();
    const e = await s.append(draft(1));
    expect(e.audit_chain.prev_event_hash).toBe(GENESIS_HASH);
    expect(e.audit_chain.event_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('second event chains to first', async () => {
    const s = new InMemoryStore();
    const a = await s.append(draft(1));
    const b = await s.append(draft(2));
    expect(b.audit_chain.prev_event_hash).toBe(a.audit_chain.event_hash);
  });

  it('append is idempotent on event_id', async () => {
    const s = new InMemoryStore();
    const a = await s.append(draft(1));
    const b = await s.append(draft(1));
    expect(b.event_id).toBe(a.event_id);
    expect(await s.count('tnt_8XQ', 'bind_42')).toBe(1);
  });

  it('partitions by (tenant, binding)', async () => {
    const s = new InMemoryStore();
    await s.append(draft(1, 'tnt_A', 'bind_1'));
    await s.append(draft(2, 'tnt_A', 'bind_1'));
    await s.append(draft(3, 'tnt_A', 'bind_2'));
    await s.append(draft(4, 'tnt_B', 'bind_1'));
    expect(await s.count('tnt_A', 'bind_1')).toBe(2);
    expect(await s.count('tnt_A', 'bind_2')).toBe(1);
    expect(await s.count('tnt_B', 'bind_1')).toBe(1);
  });

  it('full chain verifies', async () => {
    const s = new InMemoryStore();
    for (let i = 1; i <= 20; i += 1) await s.append(draft(i));
    const events = await s.read('tnt_8XQ', 'bind_42');
    expect(events).toHaveLength(20);
    expect(verifyChain(events).ok).toBe(true);
  });
});

describe('JsonlStore', () => {
  let tmp: string;
  let path: string;

  function setup() {
    tmp = mkdtempSync(join(tmpdir(), 'connector-events-'));
    path = join(tmp, 'chain.jsonl');
  }
  function teardown() {
    rmSync(tmp, { recursive: true, force: true });
  }

  it('persists to disk and reloads', async () => {
    setup();
    try {
      const s = new JsonlStore(path);
      await s.append(draft(1));
      await s.append(draft(2));
      await s.append(draft(3));
      expect(existsSync(path)).toBe(true);
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(3);

      // Fresh store reads back the same chain.
      const s2 = new JsonlStore(path);
      const events = await s2.read('tnt_8XQ', 'bind_42');
      expect(events).toHaveLength(3);
      expect(verifyChain(events).ok).toBe(true);
    } finally {
      teardown();
    }
  });

  it('returns empty list for a missing file', async () => {
    setup();
    try {
      const s = new JsonlStore(path);
      const events = await s.read('tnt_8XQ', 'bind_42');
      expect(events).toHaveLength(0);
    } finally {
      teardown();
    }
  });

  it('replay-with-different-event-id appends a new event', async () => {
    setup();
    try {
      const s = new JsonlStore(path);
      await s.append(draft(1));
      await s.append(draft(2));
      const events = await s.read('tnt_8XQ', 'bind_42');
      expect(events).toHaveLength(2);
      expect(events[0]!.event_id).toBe('evt-0000000000000001');
      expect(events[1]!.event_id).toBe('evt-0000000000000002');
    } finally {
      teardown();
    }
  });
});