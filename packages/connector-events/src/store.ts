/**
 * Append-only connector event store — FORA-484.
 *
 * The store is the audit boundary for connector events. Every
 * connector call passes through here exactly once. The store is
 * responsible for:
 *   1. Maintaining the per-(tenant, binding) chain head.
 *   2. Computing `audit_chain.prev_event_hash` and `event_hash` on append.
 *   3. Idempotent emission: replays with the same `event_id` return
 *      the existing record without appending.
 *
 * In dev (this file ships both adapters):
 *   - `InMemoryStore` — for tests and the smoke gate.
 *   - `JsonlStore` — append-only file at `path` for local persistence.
 *
 * Production deployment (separate ticket — same seam as `agents/audit/store.py`)
 *   - Postgres + SQS adapter, deferred.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ConnectorEvent } from './envelope.js';
import { GENESIS_HASH, makeEventId, nextHash } from './chain.js';

/** The minimum contract every store adapter must satisfy. */
export interface ConnectorEventStore {
  /**
   * Append `event` to the chain. The store fills in `audit_chain.prev_event_hash`
   * and `audit_chain.event_hash` from the chain head. Returns the persisted event.
   * Idempotent on `event.event_id`: replays return the existing record.
   */
  append(event: Omit<ConnectorEvent, 'audit_chain'> & { audit_chain?: undefined }): Promise<ConnectorEvent>;

  /** Read all events for `(tenant_id, binding_id)` in append order. */
  read(tenant_id: string, binding_id: string): Promise<ConnectorEvent[]>;

  /** Count events for `(tenant_id, binding_id)`. */
  count(tenant_id: string, binding_id: string): Promise<number>;
}

/** Map `(tenant, binding)` to a chain head event_hash. */
type ChainHead = Map<string, Map<string, string>>;

function headKey(tenant_id: string, binding_id: string): string {
  return `${tenant_id}${binding_id}`;
}

/** In-memory store for tests and the smoke gate. */
export class InMemoryStore implements ConnectorEventStore {
  private readonly events: Map<string, ConnectorEvent[]> = new Map();
  private readonly heads: ChainHead = new Map();
  private readonly byEventId: Map<string, ConnectorEvent> = new Map();

  async append(
    draft: Omit<ConnectorEvent, 'audit_chain'> & { audit_chain?: undefined },
  ): Promise<ConnectorEvent> {
    // Mint an event id when the caller omitted one. The id is the audit
    // chain's idempotency key; if the caller supplies an id, replays
    // return the existing record.
    const draftWithId: Omit<ConnectorEvent, 'audit_chain'> = draft.event_id
      ? draft
      : { ...draft, event_id: makeEventId() };

    const existing = this.byEventId.get(draftWithId.event_id);
    if (existing) return existing;

    const tenantHeads = this.heads.get(draftWithId.tenant_id) ?? new Map<string, string>();
    this.heads.set(draftWithId.tenant_id, tenantHeads);
    const prev = tenantHeads.get(draftWithId.binding_id) ?? GENESIS_HASH;

    const withPrev: ConnectorEvent = {
      ...draftWithId,
      audit_chain: {
        prev_event_hash: prev,
        event_hash: '', // filled below
      },
    };
    withPrev.audit_chain.event_hash = nextHash(withPrev, prev);

    const key = headKey(draftWithId.tenant_id, draftWithId.binding_id);
    const bucket = this.events.get(key) ?? [];
    bucket.push(withPrev);
    this.events.set(key, bucket);
    this.byEventId.set(draftWithId.event_id, withPrev);
    tenantHeads.set(draftWithId.binding_id, withPrev.audit_chain.event_hash);
    return withPrev;
  }

  async read(tenant_id: string, binding_id: string): Promise<ConnectorEvent[]> {
    return [...(this.events.get(headKey(tenant_id, binding_id)) ?? [])];
  }

  async count(tenant_id: string, binding_id: string): Promise<number> {
    return (this.events.get(headKey(tenant_id, binding_id)) ?? []).length;
  }

  /**
   * Prime the cache with an already-persisted event. Used by `JsonlStore.read`
   * to replay the on-disk chain into the in-memory mirror without re-computing
   * hashes. Idempotent on `event_id`: replays are no-ops that return the
   * existing record.
   *
   * The chain head is updated to the event's `event_hash` so subsequent
   * appends chain correctly.
   */
  async prime(event: ConnectorEvent): Promise<ConnectorEvent> {
    const existing = this.byEventId.get(event.event_id);
    if (existing) return existing;

    const tenantHeads = this.heads.get(event.tenant_id) ?? new Map<string, string>();
    this.heads.set(event.tenant_id, tenantHeads);

    const key = headKey(event.tenant_id, event.binding_id);
    const bucket = this.events.get(key) ?? [];
    bucket.push(event);
    this.events.set(key, bucket);
    this.byEventId.set(event.event_id, event);
    tenantHeads.set(event.binding_id, event.audit_chain.event_hash);
    return event;
  }
}

/**
 * JSONL append-only store. Every line is one canonical JSON event.
 * On read, the file is replayed in order to rebuild the chain.
 * Production deployments swap this for Postgres + SQS.
 */
export class JsonlStore implements ConnectorEventStore {
  private readonly path: string;
  private readonly memCache: InMemoryStore;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
    this.memCache = new InMemoryStore();
  }

  async append(
    draft: Omit<ConnectorEvent, 'audit_chain'> & { audit_chain?: undefined },
  ): Promise<ConnectorEvent> {
    // Ensure parent dir exists. Fire-and-forget: mkdir is idempotent.
    await mkdir(dirname(this.path), { recursive: true });

    return this.serialize(draft, async (persisted) => {
      await appendFile(this.path, `${JSON.stringify(persisted)}\n`, 'utf8');
    });
  }

  async read(tenant_id: string, binding_id: string): Promise<ConnectorEvent[]> {
    if ((await this.memCache.count(tenant_id, binding_id)) > 0) {
      return this.memCache.read(tenant_id, binding_id);
    }
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    // Replay to populate the cache, then return the bucket. Use `prime` (not
    // `append`) — the on-disk event already has `audit_chain` populated and
    // we must not recompute it.
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line) as ConnectorEvent;
      await this.memCache.prime(ev);
    }
    return this.memCache.read(tenant_id, binding_id);
  }

  async count(tenant_id: string, binding_id: string): Promise<number> {
    return (await this.read(tenant_id, binding_id)).length;
  }

  /**
   * Serialise appends through a write queue so concurrent emits don't
   * interleave. Replays are served from the in-memory cache.
   */
  private async serialize(
    draft: Omit<ConnectorEvent, 'audit_chain'> & { audit_chain?: undefined },
    persist: (event: ConnectorEvent) => Promise<void>,
  ): Promise<ConnectorEvent> {
    // Fast path: replay hits the cache.
    const cached = await this.memCache.read(draft.tenant_id, draft.binding_id);
    const dup = cached.find((e) => e.event_id === draft.event_id);
    if (dup) return dup;

    const next = this.writeQueue.then(async () => {
      const persisted = await this.memCache.append(draft);
      await persist(persisted);
    });
    this.writeQueue = next.catch(() => undefined);
    await next;
    return this.memCache.append(draft);
  }
}

/** Mint a fresh draft event for callers that don't care about the event_id. */
export function draftEvent(input: {
  event_type: ConnectorEvent['event_type'];
  tenant_id: string;
  project_id: string;
  connector_id: ConnectorEvent['connector_id'];
  binding_id: string;
  actor: ConnectorEvent['actor'];
  outcome: ConnectorEvent['outcome'];
  reason_code?: string;
  latency_ms: number;
  request: ConnectorEvent['request'];
  response: ConnectorEvent['response'];
  artifacts_emitted?: string[];
  occurred_at?: string;
}): Omit<ConnectorEvent, 'audit_chain'> {
  return {
    event_id: makeEventId(),
    event_type: input.event_type,
    schema_version: '1.0.0',
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    tenant_id: input.tenant_id,
    project_id: input.project_id,
    connector_id: input.connector_id,
    binding_id: input.binding_id,
    actor: input.actor,
    outcome: input.outcome,
    reason_code: input.reason_code ?? '',
    latency_ms: input.latency_ms,
    request: input.request,
    response: input.response,
    artifacts_emitted: input.artifacts_emitted ?? [],
  };
}