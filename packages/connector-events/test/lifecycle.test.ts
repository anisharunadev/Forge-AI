/**
 * Cross-connector lifecycle events — FORA-484 AC #3.
 */

import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_VERBS,
  SYSTEM_ACTOR,
  emitBindingLifecycle,
  emitCircuitTransition,
  emitHealthChecked,
  emitRateLimit,
  emitWebhook,
} from '../src/lifecycle.js';
import { InMemoryStore } from '../src/store.js';

describe('LIFECYCLE_VERBS catalog', () => {
  it('ships the 16 lifecycle verbs in 6 concerns', () => {
    expect(LIFECYCLE_VERBS).toHaveLength(16);
    expect(new Set(LIFECYCLE_VERBS).size).toBe(16);
  });
});

describe('emitBindingLifecycle', () => {
  it('records binding.created', async () => {
    const store = new InMemoryStore();
    const e = await emitBindingLifecycle({
      store,
      verb: 'created',
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
    });
    expect(e.event_type).toBe('connector.binding.created');
    expect(e.actor).toEqual(SYSTEM_ACTOR);
    expect(e.outcome).toBe('success');
  });

  it('records binding.revoked with denied outcome', async () => {
    const store = new InMemoryStore();
    const e = await emitBindingLifecycle({
      store,
      verb: 'revoked',
      connector_id: 'github',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
      reason_code: 'manual_revocation',
      outcome: 'denied',
    });
    expect(e.event_type).toBe('connector.binding.revoked');
    expect(e.outcome).toBe('denied');
    expect(e.reason_code).toBe('manual_revocation');
  });
});

describe('emitHealthChecked', () => {
  it('records ok=true → success', async () => {
    const store = new InMemoryStore();
    const e = await emitHealthChecked({
      store,
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
      ok: true,
      latency_ms: 23,
    });
    expect(e.event_type).toBe('connector.health.checked');
    expect(e.outcome).toBe('success');
    expect(e.latency_ms).toBe(23);
  });

  it('records ok=false → failure + reason_code', async () => {
    const store = new InMemoryStore();
    const e = await emitHealthChecked({
      store,
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
      ok: false,
      latency_ms: 5000,
    });
    expect(e.outcome).toBe('failure');
    expect(e.reason_code).toBe('health_check_failed');
  });
});

describe('emitRateLimit', () => {
  it('records consumed → success', async () => {
    const store = new InMemoryStore();
    const e = await emitRateLimit({
      store,
      verb: 'consumed',
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
      tokens_remaining: 95,
      bucket: 'jira:read',
    });
    expect(e.event_type).toBe('connector.rate_limit.consumed');
    expect(e.outcome).toBe('success');
  });

  it('records throttled → denied with reason_code', async () => {
    const store = new InMemoryStore();
    const e = await emitRateLimit({
      store,
      verb: 'throttled',
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
      tokens_remaining: 0,
      bucket: 'jira:read',
    });
    expect(e.event_type).toBe('connector.rate_limit.throttled');
    expect(e.outcome).toBe('denied');
    expect(e.reason_code).toBe('rate_limited');
  });
});

describe('emitCircuitTransition', () => {
  it('records circuit.opened with reason_code', async () => {
    const store = new InMemoryStore();
    const e = await emitCircuitTransition({
      store,
      state: 'opened',
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
      reason_code: '5_consecutive_failures',
    });
    expect(e.event_type).toBe('connector.circuit.opened');
    expect(e.reason_code).toBe('5_consecutive_failures');
  });

  it('records circuit.closed', async () => {
    const store = new InMemoryStore();
    const e = await emitCircuitTransition({
      store,
      state: 'closed',
      connector_id: 'jira',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
    });
    expect(e.event_type).toBe('connector.circuit.closed');
  });
});

describe('emitWebhook', () => {
  it('records webhook.received', async () => {
    const store = new InMemoryStore();
    const e = await emitWebhook({
      store,
      verb: 'received',
      connector_id: 'github',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
    });
    expect(e.event_type).toBe('connector.webhook.received');
    expect(e.outcome).toBe('success');
  });

  it('records webhook.rejected → denied', async () => {
    const store = new InMemoryStore();
    const e = await emitWebhook({
      store,
      verb: 'rejected',
      connector_id: 'github',
      tenant_id: 'tnt_8XQ',
      project_id: 'prj_FORA',
      binding_id: 'bind_42',
      reason_code: 'invalid_signature',
    });
    expect(e.event_type).toBe('connector.webhook.rejected');
    expect(e.outcome).toBe('denied');
    expect(e.reason_code).toBe('invalid_signature');
  });
});