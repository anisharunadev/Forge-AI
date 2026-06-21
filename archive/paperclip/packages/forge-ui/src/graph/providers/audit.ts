/**
 * AuditGraphProvider — Plan 2 §3.4 + §5.
 *
 * Backs the Audit Timeline Graph canvas (Audit Center). Data source is the
 * audit log + actor index + tenant index. v1.0 uses 5-second polling; v1.1
 * will swap to SSE live-tail (the public `subscribe` signature is the same).
 */

import { TtlCache, SubscriberRegistry, type GraphDeltaNotification } from "../cache";
import type { GraphDelta, GraphFilter, GraphProvider, Unsubscribe } from "../provider";
import type { AuditEdge, AuditNode } from "../nodes";

export const AUDIT_PROVIDER_ID = "audit-graph-v1";

/** Default poll interval — Plan 2 §5 names 5s for v1.0. */
export const DEFAULT_AUDIT_POLL_MS = 5_000;

export interface AuditFetcher {
  listEntries(): Promise<ReadonlyArray<AuditNode>>;
  listActors(): Promise<ReadonlyArray<AuditNode>>;
  listTenants(): Promise<ReadonlyArray<AuditNode>>;
  listTimeBuckets(): Promise<ReadonlyArray<AuditNode>>;
  listEdges(): Promise<ReadonlyArray<AuditEdge>>;
}

export class InMemoryAuditFetcher implements AuditFetcher {
  private entries: AuditNode[] = [];
  private actors: AuditNode[] = [];
  private tenants: AuditNode[] = [];
  private buckets: AuditNode[] = [];
  private edges: AuditEdge[] = [];
  setEntries(e: ReadonlyArray<AuditNode>): void { this.entries = [...e]; }
  setActors(a: ReadonlyArray<AuditNode>): void { this.actors = [...a]; }
  setTenants(t: ReadonlyArray<AuditNode>): void { this.tenants = [...t]; }
  setBuckets(b: ReadonlyArray<AuditNode>): void { this.buckets = [...b]; }
  setEdges(e: ReadonlyArray<AuditEdge>): void { this.edges = [...e]; }
  async listEntries(): Promise<ReadonlyArray<AuditNode>> { return this.entries; }
  async listActors(): Promise<ReadonlyArray<AuditNode>> { return this.actors; }
  async listTenants(): Promise<ReadonlyArray<AuditNode>> { return this.tenants; }
  async listTimeBuckets(): Promise<ReadonlyArray<AuditNode>> { return this.buckets; }
  async listEdges(): Promise<ReadonlyArray<AuditEdge>> { return this.edges; }
}

export interface AuditGraphProviderOptions {
  /** Poll interval. Default 5000ms per Plan 2 §5 v1.0. */
  pollMs?: number;
  /** TTL is the polling floor. Default equal to `pollMs`. */
  ttlMs?: number;
  /** Wall-clock for tests. */
  now?: () => number;
  /** Set interval. Default `globalThis.setInterval`; tests can inject a fake. */
  setInterval?: (cb: () => void, ms: number) => unknown;
  /** Clear interval. Default `globalThis.clearInterval`. */
  clearInterval?: (handle: unknown) => void;
}

export class AuditGraphProvider implements GraphProvider<AuditNode, AuditEdge> {
  readonly id = AUDIT_PROVIDER_ID;
  readonly family = "audit" as const;
  private readonly cache: TtlCache<{
    nodes: ReadonlyArray<AuditNode>;
    edges: ReadonlyArray<AuditEdge>;
  }>;
  private readonly subs = new SubscriberRegistry<AuditNode, AuditEdge>();
  private pollHandle: unknown = null;
  private readonly pollMs: number;
  private readonly setIntervalFn: (cb: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;

  constructor(
    private readonly fetcher: AuditFetcher,
    opts: AuditGraphProviderOptions = {},
  ) {
    this.pollMs = opts.pollMs ?? DEFAULT_AUDIT_POLL_MS;
    const cacheOpts: { ttlMs: number; now?: () => number } = { ttlMs: opts.ttlMs ?? this.pollMs };
    if (opts.now) cacheOpts.now = opts.now;
    this.cache = new TtlCache(cacheOpts);
    const g = globalThis as unknown as {
      setInterval: (cb: () => void, ms: number) => unknown;
      clearInterval: (handle: unknown) => void;
    };
    this.setIntervalFn = opts.setInterval ?? g.setInterval.bind(g);
    this.clearIntervalFn = opts.clearInterval ?? g.clearInterval.bind(g);
  }

  async getNodes(filter: GraphFilter): Promise<ReadonlyArray<AuditNode>> {
    const all = await this.readAll();
    let out: ReadonlyArray<AuditNode> = all.nodes;
    if (filter.nodeIds && filter.nodeIds.length > 0) {
      const allowed = new Set(filter.nodeIds);
      out = out.filter((n) => allowed.has(n.id));
    }
    return out;
  }

  async getEdges(filter: GraphFilter): Promise<ReadonlyArray<AuditEdge>> {
    const all = await this.readAll();
    let edges: ReadonlyArray<AuditEdge> = all.edges;
    if (filter.nodeIds && filter.nodeIds.length > 0) {
      const allowed = new Set(filter.nodeIds);
      edges = edges.filter((e) => allowed.has(e.source) || allowed.has(e.target));
    }
    return edges;
  }

  watch(
    filter: GraphFilter,
    onChange: (delta: GraphDelta<AuditNode, AuditEdge>) => void,
  ): Unsubscribe {
    const off = this.subs.subscribe(filter, (d) => onChange(toPublicDelta(d)));
    this.ensurePolling();
    return () => {
      off();
      if (this.subs.size() === 0) this.stopPolling();
    };
  }

  /** Manual nudge — called by the SSE bridge in v1.1; a no-op in v1.0. */
  invalidate(): void {
    this.cache.clear();
    this.subs.notify(emptyDelta());
  }

  dispose(): void {
    this.stopPolling();
  }

  private ensurePolling(): void {
    if (this.pollHandle != null) return;
    this.pollHandle = this.setIntervalFn(() => {
      this.cache.clear();
      this.subs.notify(emptyDelta());
    }, this.pollMs);
  }

  private stopPolling(): void {
    if (this.pollHandle == null) return;
    this.clearIntervalFn(this.pollHandle);
    this.pollHandle = null;
  }

  private async readAll() {
    const cached = this.cache.get({});
    if (cached) return cached;
    const [entries, actors, tenants, buckets, edges] = await Promise.all([
      this.fetcher.listEntries(),
      this.fetcher.listActors(),
      this.fetcher.listTenants(),
      this.fetcher.listTimeBuckets(),
      this.fetcher.listEdges(),
    ]);
    const value = {
      nodes: [...entries, ...actors, ...tenants, ...buckets],
      edges,
    };
    this.cache.set({}, value);
    return value;
  }
}

function emptyDelta<N, E>(): GraphDeltaNotification<N, E> {
  return {
    addedNodes: [],
    removedNodeIds: [],
    updatedNodes: [],
    addedEdges: [],
    removedEdgeIds: [],
    updatedEdges: [],
    emittedAt: new Date().toISOString(),
  };
}

function toPublicDelta<N, E>(d: GraphDeltaNotification<N, E>): GraphDelta<N, E> {
  return {
    addedNodes: d.addedNodes,
    removedNodeIds: d.removedNodeIds,
    updatedNodes: d.updatedNodes,
    addedEdges: d.addedEdges,
    removedEdgeIds: d.removedEdgeIds,
    updatedEdges: d.updatedEdges,
    emittedAt: d.emittedAt,
  };
}
