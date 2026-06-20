/**
 * Emit pipeline tests — FORA-484 AC #1 + AC #2.
 */

import { describe, it, expect } from 'vitest';
import { emitConnectorEvent, emitStartedAndFinished } from '../src/emit.js';
import { InMemoryStore } from '../src/store.js';
import { verifyChain } from '../src/chain.js';

describe('emitConnectorEvent', () => {
  it('persists with chain head populated', async () => {
    const store = new InMemoryStore();
    const ev = await emitConnectorEvent({
      store,
      event_type: 'jira.issue.observed',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      connector_id: 'jira',
      binding_id: 'bind_42',
      actor: { type: 'agent', id: 'agent:developer', role: 'developer' },
      outcome: 'success',
      op: 'issue.get',
      args: { issueIdOrKey: 'FORA-1' },
      latency_ms: 12,
      response: { status: 200, body: { id: 'FORA-1' } },
    });
    expect(ev.audit_chain.prev_event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.audit_chain.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.request.args_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.response?.status).toBe(200);
    expect(ev.response?.body_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('emits a Code Patch artifact when actor is developer + github.pr.opened', async () => {
    const store = new InMemoryStore();
    const ev = await emitConnectorEvent({
      store,
      event_type: 'github.pr.opened',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      connector_id: 'github',
      binding_id: 'bind_42',
      actor: { type: 'agent', id: 'agent:developer', role: 'developer' },
      outcome: 'success',
      op: 'pr.open',
      args: { repo: 'fora-platform/fora' },
      latency_ms: 200,
      response: { status: 201, body: { number: 7 } },
    });
    expect(ev.artifacts_emitted.length).toBe(1);
    expect(ev.artifacts_emitted[0]).toMatch(/^art-[0-9a-f]{16}$/);
  });

  it('emits no artifact when actor is denied (architect → adr but actor is developer)', async () => {
    const store = new InMemoryStore();
    const ev = await emitConnectorEvent({
      store,
      event_type: 'confluence.page.published',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      connector_id: 'confluence',
      binding_id: 'bind_42',
      actor: { type: 'agent', id: 'agent:developer', role: 'developer' },
      outcome: 'success',
      op: 'page.publish',
      args: { id: 'C-1' },
      latency_ms: 50,
      response: { status: 200, body: { id: 'C-1' } },
    });
    expect(ev.artifacts_emitted).toHaveLength(0);
  });
});

describe('emitStartedAndFinished', () => {
  it('emits two events on success: started + finished', async () => {
    const store = new InMemoryStore();
    const r = await emitStartedAndFinished({
      store,
      event_type: 'jira.issue.observed',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      connector_id: 'jira',
      binding_id: 'bind_42',
      actor: { type: 'agent', id: 'a', role: 'developer' },
      op: 'issue.get',
      args: { issueIdOrKey: 'FORA-1' },
      invoke: async () => ({ status: 200, body: { id: 'FORA-1' } }),
    });
    expect(r.started_event_id).toMatch(/^evt-/);
    expect(r.finished_event_id).toMatch(/^evt-/);
    const events = await store.read('tnt_8XQ', 'bind_42');
    expect(events).toHaveLength(2);
    expect(events[0]!.event_type).toBe('connector.call.started');
    expect(events[1]!.event_type).toBe('jira.issue.observed');
  });

  it('records failure outcome on rejected invoke', async () => {
    const store = new InMemoryStore();
    const r = await emitStartedAndFinished({
      store,
      event_type: 'jira.issue.observed',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      connector_id: 'jira',
      binding_id: 'bind_42',
      actor: { type: 'agent', id: 'a', role: 'developer' },
      op: 'issue.get',
      args: { issueIdOrKey: 'FORA-1' },
      invoke: async () => {
        throw new Error('jira 500');
      },
      onError: () => ({ reason_code: 'jira_500', outcome: 'failure' }),
    });
    expect(r.started_event_id).toMatch(/^evt-/);
    expect(r.finished_event_id).toMatch(/^evt-/);
    const events = await store.read('tnt_8XQ', 'bind_42');
    expect(events).toHaveLength(2);
    expect(events[1]!.outcome).toBe('failure');
    expect(events[1]!.reason_code).toBe('jira_500');
  });

  it('the full chain verifies end-to-end', async () => {
    const store = new InMemoryStore();
    for (let i = 0; i < 5; i += 1) {
      await emitStartedAndFinished({
        store,
        event_type: 'jira.issue.observed',
        tenant_id: 'tnt_8XQ',
        project_id: 'prj_FORA',
        connector_id: 'jira',
        binding_id: 'bind_42',
        actor: { type: 'agent', id: `a-${i}`, role: 'developer' },
        op: 'issue.get',
        args: { issueIdOrKey: `FORA-${i}` },
        invoke: async () => ({ status: 200, body: { id: `FORA-${i}` } }),
      });
    }
    const events = await store.read('tnt_8XQ', 'bind_42');
    expect(events).toHaveLength(10);
    expect(verifyChain(events).ok).toBe(true);
  });
});