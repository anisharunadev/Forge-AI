/**
 * @fora/event-bus — replay contract.
 *
 * Covers FORA-136 acceptance #4: "An Orchestrator crash mid-publish does not
 * lose events: the bus is durable; on restart, the Orchestrator re-publishes
 * from the last persisted `agent_run_events` row."
 *
 * The replay contract:
 *   - Rows are read in occurred_at order.
 *   - Each row is re-published with its original event_id (preserving dedupe).
 *   - Producer.flush() is awaited before the summary returns.
 *   - Per-event payload validation re-runs against the current schema.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemoryEventProducer,
  replayRun,
  subjectForRow,
  type AgentRunEventRow,
} from '../src/index.js';

const TENANT = 'tnt_acme';
const RUN = 'run-1234';

function mkRow(over: Partial<AgentRunEventRow>): AgentRunEventRow {
  return {
    run_id: RUN,
    tenant_id: TENANT,
    stage: null,
    event_type: 'run_created',
    payload: {
      run_id: RUN,
      tenant_id: TENANT,
      goal_id: 'goal-1',
      trigger: { type: 'manual', actor: 'u', payload_ref: null },
    },
    actor: { type: 'system', id: 'orchestrator' },
    occurred_at: '2026-06-17T00:00:00.000Z',
    event_id: 'evt-r',
    v: '1.0.0',
    ...over,
  };
}

describe('replayRun', () => {
  it('re-publishes rows in occurred_at order with the original event_id', async () => {
    const rows: AgentRunEventRow[] = [
      mkRow({ event_type: 'run_created', event_id: 'evt-1', occurred_at: '2026-06-17T10:00:00.000Z' }),
      mkRow({ event_type: 'run_started', event_id: 'evt-2', occurred_at: '2026-06-17T10:00:01.000Z', payload: { run_id: RUN, stage: 'ideation' } }),
      mkRow({ event_type: 'stage_started', event_id: 'evt-3', occurred_at: '2026-06-17T10:00:02.000Z', payload: { run_id: RUN, stage: 'ideation', owner: 'agent:ba', started_at: '2026-06-17T10:00:02.000Z' } }),
    ];
    const source = async (id: string) => (id === RUN ? rows : []);
    const producer = new InMemoryEventProducer(TENANT);

    const summary = await replayRun({ source, producer, runId: RUN });
    expect(summary.row_count).toBe(3);
    expect(summary.published_count).toBe(3);
    expect(summary.error_count).toBe(0);
    expect(producer.published.length).toBe(3);
    expect(producer.published.map((p) => p.envelope.event_id)).toEqual(['evt-1', 'evt-2', 'evt-3']);
    expect(producer.published.map((p) => p.subject)).toEqual([
      'fora.events.tnt_acme.run_created.v1',
      'fora.events.tnt_acme.run_started.v1',
      'fora.events.tnt_acme.stage_started.v1',
    ]);
  });

  it('skips rows whose payload no longer parses (current schema tightened)', async () => {
    const rows: AgentRunEventRow[] = [
      mkRow({ event_id: 'evt-1', occurred_at: '2026-06-17T10:00:00.000Z' }),
      mkRow({ event_id: 'evt-2', occurred_at: '2026-06-17T10:00:01.000Z', payload: { /* missing run_id */ tenant_id: TENANT, goal_id: 'g', trigger: { type: 'manual', actor: 'u', payload_ref: null } } }),
      mkRow({ event_id: 'evt-3', occurred_at: '2026-06-17T10:00:02.000Z' }),
    ];
    const source = async (id: string) => (id === RUN ? rows : []);
    const producer = new InMemoryEventProducer(TENANT);
    const summary = await replayRun({ source, producer, runId: RUN });
    expect(summary.row_count).toBe(3);
    expect(summary.published_count).toBe(2);
    expect(summary.error_count).toBe(1);
  });

  it('subjectForRow returns the canonical per-tenant subject', () => {
    const r = mkRow({ event_type: 'cost_reported', payload: { run_id: RUN, stage: 'dev', tokens_in: 0, tokens_out: 0, usd: 0 } });
    expect(subjectForRow(r)).toBe('fora.events.tnt_acme.cost_reported.v1');
  });
});
