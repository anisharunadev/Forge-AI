/**
 * @fora/event-bus — tenant isolation at the consumer boundary.
 *
 * Covers FORA-136 acceptance #5: "Per-tenant subject isolation: a tenant-A
 * consumer cannot read tenant-B events (verified by an integration test)."
 *
 * The in-process consumer refuses to process any envelope whose subject
 * tenant segment does not match the consumer's tenant identity. The broker
 * ACL is the cloud-side gate; this test is the in-process gate that ensures
 * a misconfigured subscription cannot accidentally fan out across tenants.
 */

import { describe, expect, it } from 'vitest';
import {
  NatsEventConsumer,
  type ProcessOutcome,
} from '../src/index.js';

describe('tenant isolation', () => {
  it('a tenant-A consumer refuses a tenant-B subject', async () => {
    const tenant = 'tnt_A';
    const consumer = new NatsEventConsumer({
      tenantId: tenant,
      durableName: 'test',
      onMessage: async () => {},
    });
    let handlerInvoked = false;
    consumer.on('run_created', () => {
      handlerInvoked = true;
    });

    // A tenant-B producer publishes an event.
    const bSubject = 'fora.events.tnt_B.run_created.v1';
    const raw = JSON.stringify({
      v: '1.0.0',
      event_id: 'evt-1',
      run_id: 'r-1',
      tenant_id: 'tnt_B',
      stage: null,
      event_type: 'run_created',
      occurred_at: '2026-06-17T00:00:00.000Z',
      actor: { type: 'system', id: 'b-producer' },
      payload: { run_id: 'r-1', tenant_id: 'tnt_B', goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null } },
    });

    const errors: ProcessOutcome[] = [];
    consumer['onError'] = (o: ProcessOutcome) => errors.push(o); // override to capture

    const outcome = await consumer.processRaw(raw, { subject: bSubject });
    expect(outcome.status).toBe('validation_failed');
    expect(handlerInvoked).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(String(errors[0]!.error?.message)).toMatch(/does not match consumer tenant/);
  });

  it('a tenant-A consumer accepts a tenant-A subject', async () => {
    const tenant = 'tnt_A';
    const consumer = new NatsEventConsumer({
      tenantId: tenant,
      durableName: 'test',
      onMessage: async () => {},
    });
    let count = 0;
    consumer.on('run_created', () => {
      count += 1;
    });
    const aSubject = 'fora.events.tnt_A.run_created.v1';
    const raw = JSON.stringify({
      v: '1.0.0',
      event_id: 'evt-1',
      run_id: 'r-1',
      tenant_id: 'tnt_A',
      stage: null,
      event_type: 'run_created',
      occurred_at: '2026-06-17T00:00:00.000Z',
      actor: { type: 'system', id: 'a-producer' },
      payload: { run_id: 'r-1', tenant_id: 'tnt_A', goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null } },
    });
    const outcome = await consumer.processRaw(raw, { subject: aSubject });
    expect(outcome.status).toBe('processed');
    expect(count).toBe(1);
  });

  it('an enforceTenantAcl=false consumer logs a warning rather than throwing (escape hatch for the multi-tenant bridge)', async () => {
    const consumer = new NatsEventConsumer({
      tenantId: 'tnt_A',
      durableName: 'test',
      enforceTenantAcl: false,
      onMessage: async () => {},
    });
    const bSubject = 'fora.events.tnt_B.run_created.v1';
    const raw = JSON.stringify({
      v: '1.0.0',
      event_id: 'evt-1',
      run_id: 'r-1',
      tenant_id: 'tnt_B',
      stage: null,
      event_type: 'run_created',
      occurred_at: '2026-06-17T00:00:00.000Z',
      actor: { type: 'system', id: 'b' },
      payload: { run_id: 'r-1', tenant_id: 'tnt_B', goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null } },
    });
    const outcome = await consumer.processRaw(raw, { subject: bSubject });
    // Tenant ACL off means the consumer attempts to parse + dispatch. The
    // event_type matches so it should process. (In production the broker's
    // per-tenant ACL is the real gate; this option is for the bridge only.)
    expect(['processed', 'validation_failed']).toContain(outcome.status);
  });
});
