/**
 * @fora/event-bus — 19 typed events + (state-change → event_type) mapping.
 *
 * Covers FORA-136 acceptance #1: "All 19 event types are published on the
 * corresponding state changes; a unit test asserts every (state-change → event)
 * pair."
 *
 * Strategy: build a representative payload for each event_type, publish it
 * through the producer, and assert (a) the producer accepts it, (b) the
 * subject is correct, (c) the envelope type matches the state-change mapping.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_EVENT_TYPES,
  EVENT_SCHEMAS,
  InMemoryEventProducer,
  STATE_CHANGE_TO_EVENT,
  assertExhaustiveCoverage,
  buildSubject,
  CURRENT_EVENT_VERSION,
  type EventType,
  type TypedEvent,
} from '../src/index.js';

const TENANT = 'tnt_acme';
const RUN = 'run-1234';
const NOW = '2026-06-17T12:34:56.789Z';

/** A representative payload per event type. */
function samplePayload(eventType: EventType): unknown {
  const baseRun = { run_id: RUN };
  switch (eventType) {
    case 'run_created':
      return {
        ...baseRun,
        tenant_id: TENANT,
        goal_id: 'goal-1',
        trigger: { type: 'manual', actor: 'user:cto', payload_ref: null },
      };
    case 'run_started':
      return { ...baseRun, stage: 'ideation' };
    case 'stage_started':
      return { ...baseRun, stage: 'dev', owner: 'agent:developer', started_at: NOW };
    case 'stage_completed':
      return {
        ...baseRun,
        stage: 'dev',
        artefact_refs: [{ kind: 'pr', url: 'https://github.com/.../pull/1', sha256: 'abc' }],
        duration_ms: 12345,
      };
    case 'stage_approved':
      return {
        ...baseRun,
        stage: 'dev',
        approved_by: 'user:cto',
        artefact_refs: [{ kind: 'pr', url: 'https://github.com/.../pull/1', sha256: 'abc' }],
      };
    case 'stage_rejected':
      return { ...baseRun, stage: 'qa', rejected_by: 'user:qa', reason: 'tests failing' };
    case 'stage_returned':
      return { ...baseRun, from_stage: 'dev', to_stage: 'architect', reason: 'adr missing', returned_by: 'user:cto', approval_id: 'apr-1' };
    case 'approval_requested':
      return {
        ...baseRun,
        stage: 'architect',
        required_role: 'cto',
        expires_at: '2026-06-17T16:00:00.000Z',
        artefact_refs: [],
        approval_id: 'apr-1',
        gate_kind: 'architect->dev',
        interaction_id: 'pc-1',
      };
    case 'approval_decided':
      return { ...baseRun, approval_id: 'apr-1', decision: 'approved', decided_by: 'user:cto', decided_at: '2026-06-17T16:00:00.000Z' };
    case 'approval_expired':
      return { ...baseRun, approval_id: 'apr-1', expired_at: '2026-06-17T16:00:00.000Z' };
    case 'gate_passed':
      return { ...baseRun, from_stage: 'ideation', to_stage: 'architect' };
    case 'cost_reported':
      return { ...baseRun, stage: 'dev', tokens_in: 1000, tokens_out: 500, usd: 0.42 };
    case 'budget_exceeded':
      return { ...baseRun, ceiling_usd: 100, spent_usd: 100, stage: 'dev' };
    case 'run_aborted':
      return { ...baseRun, reason: 'unrecoverable: model timeout', last_stage: 'dev' };
    case 'run_paused':
      return { ...baseRun, paused_by: 'user:cto', reason: 'awaiting board approval' };
    case 'run_resumed':
      return { ...baseRun, resumed_by: 'user:cto' };
    case 'run_finished':
      return { ...baseRun, total_cost_usd: 12.34, total_duration_ms: 3600000 };
    case 'error':
      return { ...baseRun, stage: 'dev', code: 'MODEL_TIMEOUT', message: 'gpt-4 timed out', retryable: true };
    case 'invalid_transition':
      return { ...baseRun, from_stage: 'dev', to_stage: 'docs', requested_by: 'agent:developer' };
  }
}

describe('events — 19 typed events', () => {
  it('exactly 19 event types are declared', () => {
    expect(ALL_EVENT_TYPES.length).toBe(19);
    expect(new Set(ALL_EVENT_TYPES).size).toBe(19);
  });

  it('every event type has a registered payload schema', () => {
    for (const et of ALL_EVENT_TYPES) {
      expect(EVENT_SCHEMAS[et]).toBeDefined();
      expect(EVENT_SCHEMAS[et].major).toBe(1);
    }
  });

  it('all schemas accept their representative sample', () => {
    for (const et of ALL_EVENT_TYPES) {
      const result = EVENT_SCHEMAS[et].payload.safeParse(samplePayload(et));
      if (!result.success) {
        throw new Error(`schema for ${et} rejected its sample: ${JSON.stringify(result.error.issues)}`);
      }
      expect(result.success).toBe(true);
    }
  });
});

describe('state-changes → event_type (FORA-136 acceptance #1)', () => {
  it('the coverage map is empty — every state change maps to a known event_type and every event_type is reachable', () => {
    const cov = assertExhaustiveCoverage();
    expect(cov.unmappedStateChanges).toEqual([]);
    expect(cov.unreachedEventTypes).toEqual([]);
  });

  it('the (state-change → event_type) pairs are exhaustive over all 19 events', async () => {
    const producer = new InMemoryEventProducer(TENANT);
    for (const et of ALL_EVENT_TYPES) {
      // Find the state change that emits this event_type.
      const stateChange = (Object.entries(STATE_CHANGE_TO_EVENT) as Array<[string, EventType]>).find(
        ([, v]) => v === et,
      )?.[0];
      expect(stateChange, `no state change maps to ${et}`).toBeDefined();

      // Publish via the producer and assert the envelope.
      const envelope = await producer.publish(et, samplePayload(et), { eventId: `evt-${et}`, occurredAt: NOW });
      expect(envelope.event_type).toBe(et);
      expect(envelope.v).toBe(CURRENT_EVENT_VERSION);
      expect(envelope.tenant_id).toBe(TENANT);

      // Subject must be the per-tenant subject for this event_type and major=1.
      const expectedSubject = buildSubject({ tenantId: TENANT, eventType: et, major: 1 });
      expect(producer.published.at(-1)?.subject).toBe(expectedSubject);
    }
    expect(producer.published.length).toBe(19);
  });

  it('one-to-one: each event_type is emitted by exactly one state change', () => {
    const counts = new Map<EventType, number>();
    for (const et of Object.values(STATE_CHANGE_TO_EVENT)) {
      counts.set(et, (counts.get(et) ?? 0) + 1);
    }
    for (const [et, n] of counts) {
      expect(n, `${et} emitted by ${n} state changes`).toBe(1);
    }
  });
});
