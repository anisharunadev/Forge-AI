/**
 * @fora/event-bus — schema versioning.
 *
 * Covers FORA-136 acceptance #2: "Schema versioning: a producer emitting
 * `v: 2.0.0` for a new event does not break a consumer on `v: 1.x`."
 *
 * The contract: a v1 consumer keeps reading v1 events indefinitely. When the
 * producer bumps an event to v2 (publishing on a new subject
 * `fora.events.<tenant>.<event_type>.v2`), the v1 consumer:
 *   - keeps receiving v1 events on the v1 subject — no break,
 *   - ignores v2 events (skip + log) — no panic.
 */

import { describe, expect, it } from 'vitest';
import {
  NatsEventConsumer,
  InMemoryDedupeStore,
  buildSubject,
  type ProcessOutcome,
} from '../src/index.js';

describe('schema-version', () => {
  it('a v1 consumer accepts a v1 envelope', async () => {
    const tenant = 'tnt_acme';
    const consumer = new NatsEventConsumer({
      tenantId: tenant,
      durableName: 'test',
      maxMajorVersion: 1,
      onMessage: async () => {},
    });
    const subject = buildSubject({ tenantId: tenant, eventType: 'run_created', major: 1 });
    const raw = JSON.stringify({
      v: '1.0.0',
      event_id: 'evt-1',
      run_id: 'r-1',
      tenant_id: tenant,
      stage: null,
      event_type: 'run_created',
      occurred_at: '2026-06-17T00:00:00.000Z',
      actor: { type: 'system', id: 'orchestrator' },
      payload: { run_id: 'r-1', tenant_id: tenant, goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null } },
    });
    const outcome = await consumer.processRaw(raw, { subject });
    expect(outcome.status).toBe('processed');
  });

  it('a v1 consumer skips a v2 envelope — does not invoke handler, does not crash', async () => {
    const tenant = 'tnt_acme';
    const errors: ProcessOutcome[] = [];
    const consumer = new NatsEventConsumer({
      tenantId: tenant,
      durableName: 'test',
      maxMajorVersion: 1,
      onError: (o) => errors.push(o),
      onMessage: async () => {},
    });
    let handlerInvoked = false;
    consumer.on('run_created', () => {
      handlerInvoked = true;
    });

    // Producer publishes a v2 envelope on the v2 subject (the breaking-change
    // pattern from ADR-0006 §3.3).
    const subject = buildSubject({ tenantId: tenant, eventType: 'run_created', major: 2 });
    const raw = JSON.stringify({
      v: '2.0.0',
      event_id: 'evt-2',
      run_id: 'r-1',
      tenant_id: tenant,
      stage: null,
      event_type: 'run_created',
      occurred_at: '2026-06-17T00:00:00.000Z',
      actor: { type: 'system', id: 'orchestrator' },
      payload: { run_id: 'r-1', tenant_id: tenant, goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null }, _v2_extra_field: 'new' },
    });
    const outcome = await consumer.processRaw(raw, { subject });
    expect(outcome.status).toBe('unsupported_version');
    expect(handlerInvoked).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.error?.message).toContain('major v2');
  });

  it('a v2 consumer accepts both v1 and v2 envelopes during the deprecation window', async () => {
    const tenant = 'tnt_acme';
    const consumer = new NatsEventConsumer({
      tenantId: tenant,
      durableName: 'test',
      maxMajorVersion: 2,
      onMessage: async () => {},
    });
    let count = 0;
    consumer.on('run_created', () => {
      count += 1;
    });

    // v1 envelope on v1 subject.
    const v1Subj = buildSubject({ tenantId: tenant, eventType: 'run_created', major: 1 });
    const v1 = JSON.stringify({
      v: '1.0.0',
      event_id: 'evt-1',
      run_id: 'r-1',
      tenant_id: tenant,
      stage: null,
      event_type: 'run_created',
      occurred_at: '2026-06-17T00:00:00.000Z',
      actor: { type: 'system', id: 'orchestrator' },
      payload: { run_id: 'r-1', tenant_id: tenant, goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null } },
    });
    // v2 envelope on v2 subject.
    const v2Subj = buildSubject({ tenantId: tenant, eventType: 'run_created', major: 2 });
    const v2 = JSON.stringify({
      v: '2.0.0',
      event_id: 'evt-2',
      run_id: 'r-1',
      tenant_id: tenant,
      stage: null,
      event_type: 'run_created',
      occurred_at: '2026-06-17T00:00:00.000Z',
      actor: { type: 'system', id: 'orchestrator' },
      payload: { run_id: 'r-1', tenant_id: tenant, goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null } },
    });

    const a = await consumer.processRaw(v1, { subject: v1Subj });
    const b = await consumer.processRaw(v2, { subject: v2Subj });
    expect(a.status).toBe('processed');
    expect(b.status).toBe('processed');
    expect(count).toBe(2);
  });
});
