/**
 * @fora/event-bus — dedupe contract.
 *
 * Covers FORA-50 spec §5.2: producer is at-least-once; consumer dedupes by
 * event_id. The bridge relies on this for both JetStream redelivery and SQS
 * redelivery.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemoryEventProducer,
  NatsEventConsumer,
  InMemoryDedupeStore,
  type EventType,
  type TypedEvent,
} from '../src/index.js';

describe('dedupe', () => {
  it('invokes the handler once when the same event_id is delivered twice', async () => {
    const tenant = 'tnt_acme';
    const seen: string[] = [];
    const dedupe = new InMemoryDedupeStore();

    const consumer = new NatsEventConsumer({
      tenantId: tenant,
      durableName: 'audit-bridge-test',
      dedupe,
      onMessage: async () => {
        /* never invoked in this test */
      },
    });

    consumer.on('run_created', (env: TypedEvent<'run_created'>) => {
      seen.push(env.event_id);
    });

    const producer = new InMemoryEventProducer(tenant);
    const env = await producer.publish(
      'run_created',
      {
        run_id: 'r-1',
        tenant_id: tenant,
        goal_id: 'g',
        trigger: { type: 'manual', actor: 'u', payload_ref: null },
      },
      { eventId: 'evt-fixed' },
    );
    const raw = Buffer.from(JSON.stringify(env));
    const subject = `fora.events.${tenant}.run_created.v1`;

    const a = await consumer.processRaw(raw, { subject });
    const b = await consumer.processRaw(raw, { subject });
    expect(a.status).toBe('processed');
    expect(b.status).toBe('deduplicated');
    expect(seen).toEqual(['evt-fixed']);
  });

  it('treats different event_ids as distinct events', async () => {
    const tenant = 'tnt_acme';
    const seen: string[] = [];
    const consumer = new NatsEventConsumer({
      tenantId: tenant,
      durableName: 'test',
      onMessage: async () => {},
    });
    consumer.on('stage_completed', (env) => {
      seen.push(env.event_id);
    });
    const producer = new InMemoryEventProducer(tenant);

    for (const id of ['evt-1', 'evt-2', 'evt-3']) {
      const env = await producer.publish(
        'stage_completed',
        {
          run_id: 'r-1',
          stage: 'dev',
          artefact_refs: [],
          duration_ms: 100,
        },
        { eventId: id },
      );
      const raw = Buffer.from(JSON.stringify(env));
      await consumer.processRaw(raw, { subject: `fora.events.${tenant}.stage_completed.v1` });
    }
    expect(seen).toEqual(['evt-1', 'evt-2', 'evt-3']);
  });
});
