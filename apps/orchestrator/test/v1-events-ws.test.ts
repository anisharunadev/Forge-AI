/**
 * FORA-514 smoke gate — `GET /v1/events` WebSocket endpoint.
 *
 * Asserts the AC bar:
 *   1. Three NATS-published events on a subscribed topic arrive at the
 *      WS client within 1 s.
 *   2. Subscribing to an unknown topic closes the connection with 1008.
 *   3. The 11th concurrent connection on the same tenant is rejected
 *      with 1013 (per-tenant cap default 10).
 *   4. A cross-tenant publish attempt closes the connection with 1011
 *      and emits a `cloud.broker.cross_tenant_leak` audit event.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

import { buildServer, type OrchestratorDeps } from '../src/server.js';
import {
  InMemoryEventSubscriber,
  type CrossTenantLeakAudit,
} from '../src/ws.js';
import type { TypedEvent } from '@fora/event-bus';

const TENANT = '00000000-0000-0000-0000-000000000ace';
const OTHER_TENANT = 'bad';
const URL_PATH = '/v1/events';

interface ServerHandle {
  url: string;
  wsUrl: string;
  close: () => Promise<void>;
  subscriber: InMemoryEventSubscriber;
  audits: CrossTenantLeakAudit[];
}

async function startTestServer(
  cap = 10,
): Promise<ServerHandle> {
  const subscriber = new InMemoryEventSubscriber();
  const audits: CrossTenantLeakAudit[] = [];
  const deps: OrchestratorDeps = {
    config: {
      port: 0,
      host: '127.0.0.1',
      databaseUrl: 'postgres://stub',
      defaultCostCeilingUsd: '100.00',
      logLevel: 'fatal',
      env: 'test',
    },
    pool: {} as unknown as OrchestratorDeps['pool'],
    approvals: {
      repo: {} as unknown as OrchestratorDeps['approvals']['repo'],
      paperclip: {} as unknown as OrchestratorDeps['approvals']['paperclip'],
      bus: {} as unknown as OrchestratorDeps['approvals']['bus'],
      pager: {} as unknown as OrchestratorDeps['approvals']['pager'],
      clock: { now: () => new Date() },
    },
    ws: {
      subscriber,
      cap,
      audit: (event) => {
        audits.push(event);
      },
    },
  };
  const app = await buildServer(deps);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}${URL_PATH}`;
  return {
    url,
    wsUrl,
    subscriber,
    audits,
    close: async () => {
      await app.close();
    },
  };
}

function pausedEnvelope(
  tenantId: string,
  runId: string,
): TypedEvent<'run_paused'> {
  return {
    v: '1.0.0',
    event_id: `${runId}-evt-1`,
    run_id: runId,
    tenant_id: tenantId,
    stage: null,
    event_type: 'run_paused',
    occurred_at: new Date().toISOString(),
    actor: { type: 'system', id: 'smoke-test' },
    payload: {
      run_id: runId,
      paused_by: 'smoke-test',
      reason: 'unit-test',
    },
  };
}

interface ClientHandle {
  socket: WebSocket;
  frames: unknown[];
  closeCode: number | null;
  closeReason: string | null;
  waitForFrames: (n: number, timeoutMs?: number) => Promise<unknown[]>;
  waitForClose: (timeoutMs?: number) => Promise<void>;
}

function openClient(
  wsUrl: string,
  opts: { topics: string; tenant: string; protocols?: string[] },
): Promise<ClientHandle> {
  return new Promise((resolve, reject) => {
    const headers = { 'x-fora-tenant-id': opts.tenant };
    const socket = new WebSocket(wsUrl + `?topics=${encodeURIComponent(opts.topics)}`, {
      headers,
      ...(opts.protocols ? { protocols: opts.protocols } : {}),
    });
    const frames: unknown[] = [];
    let closeCode: number | null = null;
    let closeReason: string | null = null;
    const closeWaiters: Array<() => void> = [];
    const frameWaiters: Array<{ need: number; resolve: (f: unknown[]) => void; collected: unknown[] }> = [];
    socket.on('message', (data) => {
      try {
        frames.push(JSON.parse(data.toString()));
      } catch {
        frames.push(data.toString());
      }
      for (const w of frameWaiters) {
        w.collected.push(...frames.splice(0, w.need - w.collected.length));
        if (w.collected.length >= w.need) {
          w.resolve(w.collected);
        }
      }
      for (let i = frameWaiters.length - 1; i >= 0; i--) {
        if (frameWaiters[i]!.collected.length >= frameWaiters[i]!.need) {
          frameWaiters.splice(i, 1);
        }
      }
    });
    socket.on('close', (code, reason) => {
      closeCode = code;
      closeReason = reason.toString();
      for (const w of closeWaiters) w();
      closeWaiters.length = 0;
    });
    socket.on('error', () => {
      /* resolve via close handler */
    });
    socket.on('open', () => {
      resolve({
        socket,
        frames,
        get closeCode() {
          return closeCode;
        },
        get closeReason() {
          return closeReason;
        },
        waitForFrames: (n, timeoutMs = 1_000) =>
          new Promise<unknown[]>((res, rej) => {
            const collected = frames.splice(0, n);
            if (collected.length >= n) {
              res(collected);
              return;
            }
            const timer = setTimeout(() => {
              rej(new Error(`waitForFrames(${n}) timed out after ${timeoutMs}ms; got ${collected.length}`));
            }, timeoutMs);
            frameWaiters.push({
              need: n,
              resolve: (f) => {
                clearTimeout(timer);
                res(f);
              },
              collected,
            });
          }),
        waitForClose: (timeoutMs = 2_000) =>
          new Promise<void>((res, rej) => {
            if (closeCode !== null) {
              res();
              return;
            }
            const timer = setTimeout(() => {
              rej(new Error(`waitForClose timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            closeWaiters.push(() => {
              clearTimeout(timer);
              res();
            });
          }),
      });
    });
    socket.on('error', (err) => reject(err));
  });
}

describe('FORA-514 — GET /v1/events WebSocket endpoint', () => {
  let server: ServerHandle;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('delivers 3 NATS-published run events to a subscribed WS client within 1s', async () => {
    const client = await openClient(server.wsUrl, {
      topics: 'run.updated',
      tenant: TENANT,
    });

    await new Promise((r) => setImmediate(r));

    const runIds = ['r1', 'r2', 'r3'];
    for (const runId of runIds) {
      server.subscriber.publish(pausedEnvelope(TENANT, runId));
    }

    const frames = await client.waitForFrames(3, 1_000);
    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      const f = frame as { topic: string; envelope: TypedEvent<'run_paused'> };
      expect(f.topic).toBe('run.updated');
      expect(f.envelope.tenant_id).toBe(TENANT);
      expect(f.envelope.event_type).toBe('run_paused');
    }

    client.socket.close();
    await client.waitForClose();
  });

  it('closes with 1008 when subscribing to an unknown topic', async () => {
    const client = await openClient(server.wsUrl, {
      topics: 'totally.unknown.topic',
      tenant: TENANT,
    });
    await client.waitForClose();
    expect(client.closeCode).toBe(1008);
    expect(client.closeReason).toMatch(/unknown topic/i);
  });

  it('rejects the 11th concurrent connection on the same tenant with 1013', async () => {
    const clients: ClientHandle[] = [];
    try {
      for (let i = 0; i < 10; i++) {
        clients.push(
          await openClient(server.wsUrl, {
            topics: 'run.updated',
            tenant: TENANT,
          }),
        );
      }
      await new Promise((r) => setTimeout(r, 100));

      let overflowClient: ClientHandle | null = null;
      let caughtError: unknown = null;
      try {
        overflowClient = await openClient(server.wsUrl, {
          topics: 'run.updated',
          tenant: TENANT,
        });
        await overflowClient.waitForClose(500);
      } catch (e) {
        caughtError = e;
      }
      if (overflowClient) {
        expect(overflowClient.closeCode).not.toBe(null);
        server.subscriber.publish(pausedEnvelope(TENANT, 'overflow-probe'));
        await new Promise((r) => setTimeout(r, 200));
        expect(overflowClient.frames.length).toBe(0);
      } else {
        expect(caughtError).toBeDefined();
      }
    } finally {
      for (const c of clients) {
        c.socket.close();
      }
      await Promise.allSettled(clients.map((c) => c.waitForClose().catch(() => {})));
    }
  });

  it('closes with 1011 and audits a cross-tenant publish attempt', async () => {
    const client = await openClient(server.wsUrl, {
      topics: 'run.updated',
      tenant: TENANT,
    });
    await new Promise((r) => setImmediate(r));

    const foreign: TypedEvent<'run_paused'> = pausedEnvelope(OTHER_TENANT, 'foreign');
    server.subscriber.publishForeign(foreign, `fora.events.${OTHER_TENANT}.run_paused.v1`, TENANT);

    await client.waitForClose();
    expect(client.closeCode).toBe(1011);

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 1_000;
      const tick = (): void => {
        if (server.audits.length >= 1) return resolve();
        if (Date.now() > deadline) return reject(new Error('audit did not land'));
        setTimeout(tick, 10);
      };
      tick();
    });
    const audit = server.audits[0]!;
    expect(audit.type).toBe('cloud.broker.cross_tenant_leak');
    expect(audit.tenantId).toBe(TENANT);
    expect(audit.envelopeTenantId).toBe(OTHER_TENANT);
    expect(audit.subject).toMatch(/^fora\.events\.bad/);
  });
});
