/**
 * End-to-end audit chain verification — FORA-484 AC #5.
 *
 * Scenario:
 *   1. Emit a binding.created lifecycle event (system actor).
 *   2. Emit a jira.issue.observed family event (developer actor, RBAC grants Requirement emission).
 *   3. Emit a github.pr.merged family event (developer actor, RBAC grants Code Patch + Task Breakdown).
 *   4. Emit a circuit.opened lifecycle event (system actor).
 *   5. Verify the entire (tenant, binding) chain — every event hashes to its predecessor,
 *      the artifact ids appear on the right events, and the final chain head is well-formed.
 *
 * This is the smoke gate for FORA-484 AC #5 (E2E hash linkage) and the
 * four-test-tier CI baseline per FORA-5 §2.1 (Unit + Integration +
 * Contract + E2E).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emitConnectorEvent,
  emitStartedAndFinished,
} from '../src/emit.js';
import {
  emitBindingLifecycle,
  emitCircuitTransition,
} from '../src/lifecycle.js';
import { InMemoryStore, JsonlStore } from '../src/store.js';
import { GENESIS_HASH, verifyChain } from '../src/chain.js';

describe('E2E audit chain', () => {
  it('InMemoryStore: full lifecycle + families chain verifies', async () => {
    const store = new InMemoryStore();

    // 1. binding.created
    await emitBindingLifecycle({
      store,
      verb: 'created',
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
    });

    // 2. jira.issue.ingested (developer, RBAC grants Requirement)
    await emitStartedAndFinished({
      store,
      event_type: 'jira.issue.ingested',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      connector_id: 'jira',
      binding_id: 'bind_42',
      actor: { type: 'agent', id: 'agent:developer', role: 'developer' },
      op: 'issue.get',
      args: { issueIdOrKey: 'FORA-1' },
      invoke: async () => ({ status: 200, body: { id: 'FORA-1', status: 'Open' } }),
    });

    // 3. github.pr.merged (developer, RBAC grants Code Patch + Task Breakdown)
    await emitStartedAndFinished({
      store,
      event_type: 'github.pr.merged',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      connector_id: 'github',
      binding_id: 'bind_42',
      actor: { type: 'agent', id: 'agent:developer', role: 'developer' },
      op: 'pr.merge',
      args: { owner: 'fora-platform', repo: 'fora', number: 7 },
      invoke: async () => ({ status: 200, body: { merged: true } }),
    });

    // 4. circuit.opened
    await emitCircuitTransition({
      store,
      state: 'opened',
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
      reason_code: '5_consecutive_failures',
    });

    const events = await store.read('tnt_8XQ', 'bind_42');
    // binding.created + call.started + jira.issue.observed + call.started + github.pr.merged + circuit.opened = 6
    expect(events).toHaveLength(6);

    // Head-1 must be GENESIS.
    expect(events[0]!.audit_chain.prev_event_hash).toBe(GENESIS_HASH);

    // The chain verifies clean.
    const result = verifyChain(events);
    expect(result.ok).toBe(true);
    expect(result.breaks).toHaveLength(0);

    // The Jira event carried a Requirement artifact id.
    const jiraEvent = events.find((e) => e.event_type === 'jira.issue.ingested');
    expect(jiraEvent).toBeDefined();
    expect(jiraEvent!.artifacts_emitted.length).toBe(1);
    expect(jiraEvent!.artifacts_emitted[0]).toMatch(/^art-[0-9a-f]{16}$/);

    // The GitHub event carried Code Patch + Task Breakdown.
    const ghEvent = events.find((e) => e.event_type === 'github.pr.merged');
    expect(ghEvent).toBeDefined();
    expect(ghEvent!.artifacts_emitted.length).toBe(2);

    // The circuit transition is the chain head.
    const circuit = events[events.length - 1]!;
    expect(circuit.event_type).toBe('connector.circuit.opened');
    expect(circuit.audit_chain.prev_event_hash).toBe(events[events.length - 2]!.audit_chain.event_hash);
  });

  it('JsonlStore: persists, reloads, and the chain still verifies', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'connector-events-e2e-'));
    const path = join(tmp, 'chain.jsonl');
    try {
      const store = new JsonlStore(path);
      await emitBindingLifecycle({
        store,
        verb: 'created',
        connector_id: 'github',
        tenant_id: 'tnt_8XQ',
        project_id: 'prj_FORA',
        binding_id: 'bind_42',
      });
      await emitConnectorEvent({
        store,
        event_type: 'github.push.received',
        tenant_id: 'tnt_8XQ',
        project_id: 'prj_FORA',
        connector_id: 'github',
        binding_id: 'bind_42',
        actor: { type: 'agent', id: 'agent:developer', role: 'developer' },
        outcome: 'success',
        op: 'push.receive',
        args: { ref: 'refs/heads/main' },
        latency_ms: 5,
        response: { status: 200, body: { ok: true } },
      });
      expect(existsSync(path)).toBe(true);

      // Reload into a fresh store — chain must still verify.
      const reloaded = new JsonlStore(path);
      const events = await reloaded.read('tnt_8XQ', 'bind_42');
      expect(events).toHaveLength(2);
      expect(verifyChain(events).ok).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Tampering at any point breaks the chain', async () => {
    const store = new InMemoryStore();
    await emitBindingLifecycle({
      store,
      verb: 'created',
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
    });
    await emitConnectorEvent({
      store,
      event_type: 'jira.issue.observed',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      connector_id: 'jira',
      binding_id: 'bind_42',
      actor: { type: 'agent', id: 'a', role: 'developer' },
      outcome: 'success',
      op: 'issue.get',
      args: { issueIdOrKey: 'FORA-1' },
      latency_ms: 1,
      response: { status: 200, body: { id: 'FORA-1' } },
    });
    const events = await store.read('tnt_8XQ', 'bind_42');

    // Tamper: change the body of the second event but keep its hashes.
    const tampered = events.map((e, i) => (i === 1 ? { ...e, latency_ms: 9999 } : e));
    const r = verifyChain(tampered);
    expect(r.ok).toBe(false);
    expect(r.breaks[0]!.reason).toBe('self_hash_mismatch');
  });
});