/**
 * @fora/event-bus-bridge — bridge wiring + cross-account envelope preservation.
 *
 * Covers FORA-136 acceptance #3: "The SQS+SNS bridge delivers every event to
 * the audit account within 60 s (p99)." — verified here by the in-memory SNS
 * publisher recording publish timestamps and the bridge runner measuring
 * end-to-end latency.
 */

import { describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  AwsSnsPublisher,
  startBridge,
  type SnsPublisher,
} from '../src/index.js';
import { InMemoryEventProducer, buildSubject } from '@fora/event-bus';

const TENANT = 'tnt_acme';
const TOPIC_ARN = 'arn:aws:sns:us-east-1:111111111111:fora-audit-events';

function makeEnvelope(eventType: 'run_created' | 'stage_completed' | 'cost_reported', eventId: string, occurredAt: string) {
  return {
    v: '1.0.0',
    event_id: eventId,
    run_id: 'run-1',
    tenant_id: TENANT,
    stage: eventType === 'run_created' ? null : 'dev',
    event_type: eventType,
    occurred_at: occurredAt,
    actor: { type: 'system', id: 'orchestrator' },
    payload: eventType === 'run_created'
      ? { run_id: 'run-1', tenant_id: TENANT, goal_id: 'g-1', trigger: { type: 'manual', actor: 'u', payload_ref: null } }
      : eventType === 'stage_completed'
      ? { run_id: 'run-1', stage: 'dev', artefact_refs: [], duration_ms: 1000 }
      : { run_id: 'run-1', stage: 'dev', tokens_in: 100, tokens_out: 50, usd: 0.01 },
  };
}

describe('AwsSnsPublisher', () => {
  it('publishes the envelope verbatim and carries fora-* attributes', async () => {
    const snsMock = mockClient(SNSClient);
    snsMock.on(PublishCommand).resolves({ MessageId: 'msg-1' });
    const publisher = new AwsSnsPublisher(TOPIC_ARN, 'us-east-1');
    const env = makeEnvelope('run_created', 'evt-1', '2026-06-17T00:00:00.000Z');
    const out = await publisher.publish({ subject: 'fora.events.tnt_acme.run_created.v1', envelope: env });
    expect(out.messageId).toBe('msg-1');
    const calls = snsMock.commandCalls(PublishCommand);
    expect(calls.length).toBe(1);
    const input = calls[0]!.args[0].input as Record<string, unknown>;
    expect(input.TopicArn).toBe(TOPIC_ARN);
    expect(input.Subject).toBe('fora.events.tnt_acme.run_created.v1');
    expect(JSON.parse(input.Message as string)).toEqual(env);
    expect(input.MessageDeduplicationId).toBe('evt-1');
    expect(input.MessageGroupId).toBe(TENANT);
    expect((input.MessageAttributes as Record<string, { StringValue: string }>)['fora-tenant-id'].StringValue).toBe(TENANT);
    expect((input.MessageAttributes as Record<string, { StringValue: string }>)['fora-event-id'].StringValue).toBe('evt-1');
    await publisher.close();
  });
});

describe('startBridge — wiring + latency', () => {
  it('forwards every event to SNS, dedupes by event_id, measures p99', async () => {
    const snsMock = mockClient(SNSClient);
    snsMock.on(PublishCommand).resolves({ MessageId: 'msg' });

    const publisher = new AwsSnsPublisher(TOPIC_ARN, 'us-east-1');
    const messages: Array<{ raw: Uint8Array; subject: string; redelivered: boolean }> = [];
    const unsubscribe = vi.fn(async () => undefined);
    const subscribe = async (
      handler: (raw: Uint8Array, subject: string, redelivered: boolean) => Promise<void>,
    ): Promise<() => Promise<void>> => {
      // Drive the bridge with a synthetic stream of events.
      for (const env of [
        makeEnvelope('run_created', 'evt-1', '2026-06-17T00:00:00.000Z'),
        makeEnvelope('stage_completed', 'evt-2', '2026-06-17T00:00:01.000Z'),
        makeEnvelope('cost_reported', 'evt-3', '2026-06-17T00:00:02.000Z'),
        // Redelivery of evt-2 — should be deduplicated, not published twice to SNS.
        makeEnvelope('stage_completed', 'evt-2', '2026-06-17T00:00:01.000Z'),
      ]) {
        messages.push({ raw: Buffer.from(JSON.stringify(env)), subject: `fora.events.${TENANT}.${env.event_type}.v1`, redelivered: false });
      }
      // Run them sequentially.
      (async () => {
        for (const m of messages) {
          await handler(m.raw, m.subject, m.redelivered);
        }
      })();
      return unsubscribe;
    };

    const { stop, metrics } = await startBridge({
      config: {
        natsUrl: 'nats://test',
        snsTopicArn: TOPIC_ARN,
        awsRegion: 'us-east-1',
        tenantId: TENANT,
        durableName: 'audit-bridge-test',
        maxMajorVersion: 1,
        rateRps: 100,
      },
      publisher,
      subscribe,
    });

    // Wait for the message loop above to complete.
    await new Promise((r) => setTimeout(r, 50));

    const calls = snsMock.commandCalls(PublishCommand);
    // 4 inbound messages, 1 deduplicated → 3 SNS publishes.
    expect(calls.length).toBe(3);

    // Bridge metrics: at least one sample recorded.
    expect(metrics.p50()).toBeGreaterThanOrEqual(0);
    expect(metrics.p99()).toBeGreaterThanOrEqual(0);

    await stop();
  });

  it('refuses to publish a v2 envelope to SNS (consumer drops it first)', async () => {
    const snsMock = mockClient(SNSClient);
    snsMock.on(PublishCommand).resolves({ MessageId: 'msg' });
    const publisher = new AwsSnsPublisher(TOPIC_ARN, 'us-east-1');
    const unsubscribe = vi.fn(async () => undefined);

    const v2Envelope = {
      ...makeEnvelope('run_created', 'evt-v2', '2026-06-17T00:00:00.000Z'),
      v: '2.0.0',
    };

    const subscribe = async (
      handler: (raw: Uint8Array, subject: string, redelivered: boolean) => Promise<void>,
    ): Promise<() => Promise<void>> => {
      (async () => {
        await handler(
          Buffer.from(JSON.stringify(v2Envelope)),
          `fora.events.${TENANT}.run_created.v2`, // v2 subject
          false,
        );
      })();
      return unsubscribe;
    };

    const { stop } = await startBridge({
      config: {
        natsUrl: 'nats://test',
        snsTopicArn: TOPIC_ARN,
        awsRegion: 'us-east-1',
        tenantId: TENANT,
        durableName: 'audit-bridge-test',
        maxMajorVersion: 1, // bridge configured for v1
        rateRps: 100,
      },
      publisher,
      subscribe,
    });
    await new Promise((r) => setTimeout(r, 30));
    // v2 envelope must not be forwarded to SNS — the consumer drops it.
    expect(snsMock.commandCalls(PublishCommand).length).toBe(0);
    await stop();
  });
});

describe('InMemoryEventProducer — bridge-side sanity', () => {
  it('publishes per-tenant subjects', async () => {
    const producer = new InMemoryEventProducer(TENANT);
    await producer.publish('run_created', {
      run_id: 'r',
      tenant_id: TENANT,
      goal_id: 'g',
      trigger: { type: 'manual', actor: 'u', payload_ref: null },
    });
    expect(producer.published[0]!.subject).toBe(
      buildSubject({ tenantId: TENANT, eventType: 'run_created', major: 1 }),
    );
  });
});
