/**
 * Integration test for the NATS adapter (FORA-170 acceptance #2 + #3).
 *
 * Runs only when `FORA_NATS_URL` is set; otherwise skipped so the unit
 * suite stays hermetic. Mirrors the gating pattern in
 * `apps/orchestrator/test/approvals-repo-pg.live.test.ts`.
 *
 * What it covers:
 *   - The adapter publishes to a live NATS broker; a real subscriber
 *     reads the message back. Verifies the wire format (envelope +
 *     subject) end-to-end.
 *   - Per-tenant subject isolation: a tenant-A publish is not visible
 *     to a tenant-B subscriber subscribed to its own tenant prefix.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, StringCodec, type NatsConnection, type Subscription } from 'nats';

import {
  NatsApprovalEventBus,
  natsProducerFactoryFor,
  openNatsConnection,
  type NatsConnectionBundle,
} from './event-bus-nats.js';
import { asRunId, asTenantId } from '../types.js';
import type { ApprovalEvent } from '../ports.js';

const URL = process.env['FORA_NATS_URL'];
const TENANT_A = 'tnt_live_a';
const TENANT_B = 'tnt_live_b';
const RUN = 'run-live-1';

const sc = StringCodec();

const skip = !URL;

describe.skipIf(skip)('NatsApprovalEventBus — live NATS', () => {
  let bundle: NatsConnectionBundle;
  let subscriberNc: NatsConnection;
  let adapter: NatsApprovalEventBus;
  let tenantASub: Subscription;
  let tenantBSub: Subscription;
  const tenantAReceived: unknown[] = [];
  const tenantBReceived: unknown[] = [];

  beforeAll(async () => {
    bundle = await openNatsConnection(URL!);
    subscriberNc = await connect({ servers: URL! });

    adapter = new NatsApprovalEventBus({
      producerFactory: natsProducerFactoryFor(bundle),
    });

    // Subscribe to per-tenant prefixes. The broker's subject ACL is the
    // production gate; in this test we use two wildcards to model
    // "tenant A consumer" vs "tenant B consumer".
    tenantASub = subscriberNc.subscribe(`fora.events.${TENANT_A}.>`);
    tenantBSub = subscriberNc.subscribe(`fora.events.${TENANT_B}.>`);
    void (async () => {
      for await (const msg of tenantASub) {
        tenantAReceived.push(JSON.parse(sc.decode(msg.data)));
      }
    })();
    void (async () => {
      for await (const msg of tenantBSub) {
        tenantBReceived.push(JSON.parse(sc.decode(msg.data)));
      }
    })();

    // Give the broker a beat to register the subscribes.
    await new Promise((r) => setTimeout(r, 100));
  }, 20_000);

  afterAll(async () => {
    try {
      tenantASub?.unsubscribe();
      tenantBSub?.unsubscribe();
    } catch {
      /* ignore */
    }
    await adapter?.disconnect();
    await subscriberNc?.close();
    await bundle?.close();
  }, 20_000);

  it('publishes approval_requested and a tenant-A consumer reads it back', async () => {
    tenantAReceived.length = 0;
    const event: ApprovalEvent = {
      type: 'approval_requested',
      tenantId: asTenantId(TENANT_A),
      runId: asRunId(RUN),
      stage: 'dev',
      gateKind: 'dev->qa',
      requiredRole: 'qa',
      approvalId: 'apr-live-1',
      interactionId: 'pc-live-1',
      expiresAt: '2026-06-17T01:00:00.000Z',
      artefactRefs: [
        { kind: 'pr', url: 'https://github.com/fora/repo/pull/99', sha256: 'abc' },
      ],
    };
    await adapter.emit(event);

    // The in-memory test fakes synchronously capture publishes; the
    // broker is asynchronous — wait for the subscriber to drain.
    await new Promise((r) => setTimeout(r, 500));

    expect(tenantAReceived.length).toBeGreaterThanOrEqual(1);
    const env = tenantAReceived[tenantAReceived.length - 1] as {
      event_type: string;
      tenant_id: string;
      run_id: string;
      payload: Record<string, unknown>;
    };
    expect(env.event_type).toBe('approval_requested');
    expect(env.tenant_id).toBe(TENANT_A);
    expect(env.run_id).toBe(RUN);
    expect(env.payload).toMatchObject({
      run_id: RUN,
      stage: 'dev',
      approval_id: 'apr-live-1',
      gate_kind: 'dev->qa',
      interaction_id: 'pc-live-1',
    });
  }, 15_000);

  it('a tenant-A publish is not visible to a tenant-B subscriber', async () => {
    tenantAReceived.length = 0;
    tenantBReceived.length = 0;

    await adapter.emit({
      type: 'approval_requested',
      tenantId: asTenantId(TENANT_A),
      runId: asRunId(RUN),
      stage: 'architect',
      gateKind: 'architect->dev',
      requiredRole: 'cto',
      approvalId: 'apr-live-iso-1',
      interactionId: 'pc-live-iso-1',
      expiresAt: '2026-06-17T05:00:00.000Z',
      artefactRefs: [],
    });

    await new Promise((r) => setTimeout(r, 500));

    expect(tenantAReceived.length).toBeGreaterThanOrEqual(1);
    expect(tenantBReceived.length).toBe(0);
  }, 15_000);
});
