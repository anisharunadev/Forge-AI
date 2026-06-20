/**
 * WebSocket endpoint — `GET /v1/events` (FORA-514).
 *
 * Tenant-authenticated WS clients subscribe to a topic whitelist;
 * matching NATS events from the per-tenant bus are forwarded as JSON
 * frames. Closes with 1008 on unknown topics, 1013 on per-tenant cap
 * overflow, 1011 + `cloud.broker.cross_tenant_leak` audit on a
 * cross-tenant leak attempt. See FORA-514 §1-§5.
 */

import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';

import { type EventType, type TypedEvent } from '@fora/event-bus';

export const WS_TOPICS = [
  'run.created',
  'run.updated',
  'run.stage_changed',
  'issue.created',
  'issue.updated',
] as const;

export type WsTopic = (typeof WS_TOPICS)[number];

const WS_TOPIC_SET = new Set<string>(WS_TOPICS);

export const TOPIC_TO_EVENT_TYPES: Readonly<Record<WsTopic, ReadonlyArray<EventType>>> = {
  'run.created': ['run_created'],
  'run.updated': ['run_paused', 'run_resumed', 'run_aborted', 'run_finished', 'error', 'invalid_transition'],
  'run.stage_changed': [
    'stage_started',
    'stage_completed',
    'stage_approved',
    'stage_rejected',
    'stage_returned',
    'gate_passed',
  ],
  'issue.created': ['run_created'],
  'issue.updated': [
    'approval_requested',
    'approval_decided',
    'approval_expired',
    'cost_reported',
    'budget_exceeded',
  ],
};

const EVENT_TYPE_TO_TOPICS: ReadonlyMap<EventType, ReadonlyArray<WsTopic>> = (() => {
  const m = new Map<EventType, WsTopic[]>();
  for (const topic of WS_TOPICS) {
    for (const eventType of TOPIC_TO_EVENT_TYPES[topic]) {
      const existing = m.get(eventType);
      if (existing) {
        existing.push(topic);
      } else {
        m.set(eventType, [topic]);
      }
    }
  }
  return m;
})();

export interface WsFrame {
  topic: WsTopic;
  envelope: TypedEvent<EventType>;
}

const topicsParam = z
  .string()
  .min(1)
  .transform((s) => s.split(',').map((t) => t.trim()).filter((t) => t.length > 0))
  .pipe(z.array(z.string().min(1)).max(WS_TOPICS.length))
  .refine((arr) => arr.every((t) => WS_TOPIC_SET.has(t)), {
    message: `unknown topic — allowed: ${WS_TOPICS.join(', ')}`,
  });

export function parseTopicsParam(raw: string | null | undefined): ReadonlyArray<WsTopic> {
  if (!raw || raw.length === 0) return [];
  const result = topicsParam.safeParse(raw);
  if (!result.success) {
    throw new WsCloseError(1008, `topics: ${result.error.issues[0]?.message ?? 'invalid'}`);
  }
  return result.data as WsTopic[];
}

export class WsCloseError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'WsCloseError';
  }
}

export class WsConnectionRegistry {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly cap: number,
    private readonly onReject?: (tenantId: string) => void,
  ) {
    if (!Number.isInteger(cap) || cap <= 0) {
      throw new Error(`WsConnectionRegistry: cap must be a positive integer, got ${cap}`);
    }
  }

  tryReserve(tenantId: string): void {
    const current = this.counts.get(tenantId) ?? 0;
    if (current >= this.cap) {
      this.onReject?.(tenantId);
      throw new WsCloseError(1013, `tenant connection cap exceeded (${this.cap})`);
    }
    this.counts.set(tenantId, current + 1);
  }

  release(tenantId: string): void {
    const current = this.counts.get(tenantId) ?? 0;
    if (current <= 0) return;
    this.counts.set(tenantId, current - 1);
    if (current - 1 === 0) this.counts.delete(tenantId);
  }

  countFor(tenantId: string): number {
    return this.counts.get(tenantId) ?? 0;
  }
}

export interface CrossTenantLeakAudit {
  type: 'cloud.broker.cross_tenant_leak';
  tenantId: string;
  envelopeTenantId: string;
  subject: string;
  occurredAt: string;
  eventId: string;
}

export interface EventSubscriber {
  subscribe(
    tenantId: string,
    handler: (env: TypedEvent<EventType>, subject: string) => void | Promise<void>,
  ): Promise<() => Promise<void>>;
}

export interface WsConnectionState {
  readonly tenantId: string;
  readonly topics: ReadonlyArray<WsTopic>;
  readonly socket: WebSocket;
  readonly onClose: (reason: string) => void;
  readonly audit: (event: CrossTenantLeakAudit) => void;
  readonly now: () => number;
  readonly heartbeatMs: number;
  readonly idleTimeoutMs: number;
  unsubscribe: (() => Promise<void>) | null;
  heartbeatTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  closed: boolean;
}

export interface AttachEventsWebSocketOptions {
  readonly subscriber: EventSubscriber;
  readonly registry: WsConnectionRegistry;
  readonly audit?: (event: CrossTenantLeakAudit) => void;
  readonly heartbeatMs?: number;
  readonly idleTimeoutMs?: number;
  readonly now?: () => number;
}

export const WS_PATH = '/v1/events';
const TENANT_HEADER = 'x-fora-tenant-id';

export function attachEventsWebSocket(
  server: HttpServer,
  opts: AttachEventsWebSocketOptions,
): void {
  const wss = new WebSocketServer({ noServer: true });
  const heartbeatMs = opts.heartbeatMs ?? 30_000;
  const idleTimeoutMs = opts.idleTimeoutMs ?? 90_000;
  const audit = opts.audit ?? (() => {});
  const now = opts.now ?? (() => Date.now());

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (!url.startsWith(`${WS_PATH}`)) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const tenantHeader = readTenantHeader(req);
      if (!tenantHeader) {
        ws.close(1008, 'missing tenant header');
        return;
      }

      let topics: ReadonlyArray<WsTopic>;
      try {
        topics = parseTopicsParam(readQueryParam(url, 'topics'));
      } catch (e) {
        const code = e instanceof WsCloseError ? e.code : 1008;
        const msg = e instanceof Error ? e.message : 'invalid topics';
        ws.close(code, msg);
        return;
      }

      try {
        opts.registry.tryReserve(tenantHeader);
      } catch (e) {
        const code = e instanceof WsCloseError ? e.code : 1013;
        const msg = e instanceof Error ? e.message : 'cap exceeded';
        ws.close(code, msg);
        return;
      }

      const state: WsConnectionState = {
        tenantId: tenantHeader,
        topics,
        socket: ws,
        onClose: (_reason: string) => {
          if (state.closed) return;
          state.closed = true;
          if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
          if (state.idleTimer) clearTimeout(state.idleTimer);
          if (state.unsubscribe) {
            void state.unsubscribe().catch(() => {});
          }
          opts.registry.release(tenantHeader);
        },
        audit,
        now,
        heartbeatMs,
        idleTimeoutMs,
        unsubscribe: null,
        heartbeatTimer: null,
        idleTimer: null,
        closed: false,
      };

      void opts.subscriber
        .subscribe(tenantHeader, (env, subject) => {
          if (state.closed) return;
          if (env.tenant_id !== tenantHeader) {
            state.audit({
              type: 'cloud.broker.cross_tenant_leak',
              tenantId: tenantHeader,
              envelopeTenantId: env.tenant_id,
              subject,
              occurredAt: new Date(state.now()).toISOString(),
              eventId: env.event_id,
            });
            state.socket.close(1011, 'cross-tenant leak');
            return;
          }
          const matchingTopics = EVENT_TYPE_TO_TOPICS.get(env.event_type);
          if (!matchingTopics) return;
          for (const topic of matchingTopics) {
            if (!state.topics.includes(topic)) continue;
            const frame: WsFrame = { topic, envelope: env };
            try {
              state.socket.send(JSON.stringify(frame));
            } catch {
              /* socket closed mid-send */
            }
          }
        })
        .then((unsub) => {
          if (state.closed) {
            void unsub().catch(() => {});
            return;
          }
          state.unsubscribe = unsub;
          state.heartbeatTimer = setInterval(() => {
            if (state.closed) return;
            try {
              state.socket.ping();
            } catch {
              state.socket.terminate();
            }
          }, state.heartbeatMs);
          const resetIdle = (): void => {
            if (state.idleTimer) clearTimeout(state.idleTimer);
            state.idleTimer = setTimeout(() => {
              if (state.closed) return;
              try {
                state.socket.close(1006, 'idle timeout');
              } catch {
                state.socket.terminate();
              }
            }, state.idleTimeoutMs);
          };
          state.socket.on('pong', resetIdle);
          state.socket.on('message', resetIdle);
          state.socket.on('error', () => {
            try {
              state.socket.terminate();
            } catch {
              /* already closed */
            }
          });
          resetIdle();
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'subscribe failed';
          try {
            state.socket.close(1011, msg);
          } catch {
            state.socket.terminate();
          }
          state.onClose('subscribe-failed');
        });

      ws.on('close', () => state.onClose('client-disconnect'));
      ws.on('error', () => state.onClose('socket-error'));
    });
  });
}

function readTenantHeader(req: IncomingMessage): string | null {
  const v = req.headers[TENANT_HEADER];
  if (typeof v === 'string' && v.length > 0) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].length > 0) {
    return v[0].trim();
  }
  return null;
}

function readQueryParam(url: string, name: string): string | null {
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return null;
  const qs = url.slice(qIndex + 1);
  for (const part of qs.split('&')) {
    if (part.length === 0) continue;
    const eq = part.indexOf('=');
    const k = eq === -1 ? part : part.slice(0, eq);
    if (k !== name) continue;
    return eq === -1 ? '' : decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

export class InMemoryEventSubscriber implements EventSubscriber {
  private readonly listeners = new Map<string, Set<(env: TypedEvent<EventType>, subject: string) => void | Promise<void>>>();

  async subscribe(
    tenantId: string,
    handler: (env: TypedEvent<EventType>, subject: string) => void | Promise<void>,
  ): Promise<() => Promise<void>> {
    let set = this.listeners.get(tenantId);
    if (!set) {
      set = new Set();
      this.listeners.set(tenantId, set);
    }
    set.add(handler);
    return async () => {
      const s = this.listeners.get(tenantId);
      if (s) s.delete(handler);
    };
  }

  publish(env: TypedEvent<EventType>, subject?: string): void {
    const set = this.listeners.get(env.tenant_id);
    if (!set) return;
    const s = subject ?? `fora.events.${env.tenant_id}.${env.event_type}.v1`;
    for (const h of set) {
      void Promise.resolve(h(env, s)).catch(() => {});
    }
  }

  publishForeign(
    env: TypedEvent<EventType>,
    subject: string,
    targetTenantId: string,
  ): void {
    const set = this.listeners.get(targetTenantId);
    if (!set) return;
    for (const h of set) {
      void Promise.resolve(h(env, subject)).catch(() => {});
    }
  }
}
