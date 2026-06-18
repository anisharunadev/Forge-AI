/**
 * @fora/event-bus — producer contract.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemoryEventProducer,
  SchemaValidationError,
  TenantMismatchError,
  buildSubject,
  type EventType,
  type TypedEvent,
} from '../src/index.js';

describe('producer (InMemoryEventProducer)', () => {
  it('publishes a valid payload and returns the typed envelope', async () => {
    const producer = new InMemoryEventProducer('tnt_acme');
    const env = await producer.publish(
      'run_created',
      {
        run_id: 'r-1',
        tenant_id: 'tnt_acme',
        goal_id: 'g-1',
        trigger: { type: 'manual', actor: 'user:cto', payload_ref: null },
      },
      { eventId: 'evt-fixed', occurredAt: '2026-06-17T00:00:00.000Z' },
    );
    expect(env.event_type).toBe<'run_created'>('run_created');
    expect(env.event_id).toBe('evt-fixed');
    expect(env.tenant_id).toBe('tnt_acme');
    expect(env.v).toBe('1.0.0');
    expect(producer.published.length).toBe(1);
    expect(producer.published[0]!.subject).toBe('fora.events.tnt_acme.run_created.v1');
  });

  it('rejects an invalid payload with a typed SchemaValidationError', async () => {
    const producer = new InMemoryEventProducer('tnt_acme');
    await expect(
      producer.publish('run_created', { run_id: 'r-1' /* missing fields */ }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it('auto-generates event_id when none provided', async () => {
    const producer = new InMemoryEventProducer('tnt_acme');
    const env = await producer.publish('run_created', {
      run_id: 'r-1',
      tenant_id: 'tnt_acme',
      goal_id: 'g',
      trigger: { type: 'manual', actor: 'u', payload_ref: null },
    });
    expect(env.event_id).toMatch(/^evt-/);
  });

  it('subjects always match the producer tenant (in-process tenant guard)', async () => {
    const producer = new InMemoryEventProducer('tnt_A');
    const env = await producer.publish(
      'stage_started',
      { run_id: 'r-1', stage: 'dev', owner: 'agent:developer', started_at: '2026-06-17T00:00:00.000Z' },
    );
    const expected = buildSubject({ tenantId: 'tnt_A', eventType: 'stage_started', major: 1 });
    expect(producer.published.at(-1)?.subject).toBe(expected);
    expect(env.tenant_id).toBe('tnt_A');
  });

  it('publishing to an unknown event_type throws InvalidInputError', async () => {
    const producer = new InMemoryEventProducer('tnt_acme');
    await expect(
      // @ts-expect-error — intentionally wrong event_type
      producer.publish('not_an_event', {}),
    ).rejects.toThrow(/unknown event_type/);
  });

  it('flush is a no-op and close is idempotent', async () => {
    const producer = new InMemoryEventProducer('tnt_acme');
    await producer.flush();
    await producer.close();
    await producer.close(); // idempotent
    await expect(
      producer.publish('run_created', {
        run_id: 'r-1',
        tenant_id: 'tnt_acme',
        goal_id: 'g',
        trigger: { type: 'manual', actor: 'u', payload_ref: null },
      }),
    ).rejects.toThrow(/closed/);
  });

  it('produces all 19 events end-to-end', async () => {
    const producer = new InMemoryEventProducer('tnt_acme');
    const allTypes: EventType[] = [
      'run_created','run_started','stage_started','stage_completed','stage_approved',
      'stage_rejected','stage_returned','approval_requested','approval_decided','approval_expired',
      'gate_passed','cost_reported','budget_exceeded','run_aborted','run_paused','run_resumed',
      'run_finished','error','invalid_transition',
    ];
    const samples: Record<EventType, unknown> = {
      run_created: { run_id: 'r', tenant_id: 't', goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null } },
      run_started: { run_id: 'r', stage: 'ideation' },
      stage_started: { run_id: 'r', stage: 'dev', owner: 'o', started_at: '2026-06-17T00:00:00.000Z' },
      stage_completed: { run_id: 'r', stage: 'dev', artefact_refs: [], duration_ms: 1 },
      stage_approved: { run_id: 'r', stage: 'dev', approved_by: 'u', artefact_refs: [] },
      stage_rejected: { run_id: 'r', stage: 'qa', rejected_by: 'u', reason: 'r' },
      stage_returned: { run_id: 'r', from_stage: 'dev', to_stage: 'architect', reason: 'r', returned_by: 'u', approval_id: 'a' },
      approval_requested: { run_id: 'r', stage: 'architect', required_role: 'cto', expires_at: '2026-06-17T00:00:00.000Z', artefact_refs: [], approval_id: 'a', gate_kind: 'architect->dev', interaction_id: 'pc-1' },
      approval_decided: { run_id: 'r', approval_id: 'a', decision: 'approved', decided_by: 'u', decided_at: '2026-06-17T00:00:00.000Z' },
      approval_expired: { run_id: 'r', approval_id: 'a', expired_at: '2026-06-17T00:00:00.000Z' },
      gate_passed: { run_id: 'r', from_stage: 'ideation', to_stage: 'architect' },
      cost_reported: { run_id: 'r', stage: 'dev', tokens_in: 0, tokens_out: 0, usd: 0 },
      budget_exceeded: { run_id: 'r', ceiling_usd: 100, spent_usd: 100, stage: 'dev' },
      run_aborted: { run_id: 'r', reason: 'r', last_stage: 'dev' },
      run_paused: { run_id: 'r', paused_by: 'u', reason: 'r' },
      run_resumed: { run_id: 'r', resumed_by: 'u' },
      run_finished: { run_id: 'r', total_cost_usd: 0, total_duration_ms: 0 },
      error: { run_id: 'r', stage: 'dev', code: 'E', message: 'm', retryable: false },
      invalid_transition: { run_id: 'r', from_stage: 'dev', to_stage: 'docs', requested_by: 'u' },
    };
    for (const et of allTypes) {
      const env: TypedEvent<typeof et> = await producer.publish(et, samples[et]);
      expect(env.event_type).toBe(et);
    }
    expect(producer.published.length).toBe(19);
  });
});
