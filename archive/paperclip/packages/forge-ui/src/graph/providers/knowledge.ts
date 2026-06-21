/**
 * KnowledgeGraphProvider — Plan 2 §3.1 + §5.
 *
 * Backs the Knowledge Graph canvas (Knowledge Center). Data source is the
 * Knowledge Layer files + cross-ref index. Cache TTL: 5 minutes. The
 * Knowledge Layer registry pushes mutations via `invalidate()` so the cache
 * stays empty in the happy path; the TTL is a floor.
 */

import {
  TtlCache,
  SubscriberRegistry,
  type GraphDeltaNotification,
} from "../cache";
import type { GraphDelta, GraphFilter, GraphProvider, Unsubscribe } from "../provider";
import type { KnowledgeEdge, KnowledgeNode } from "../nodes";

export const KNOWLEDGE_PROVIDER_ID = "knowledge-graph-v1";

export interface KnowledgeFetcher {
  /** Read all knowledge files (every consumer paginates from this). */
  listFiles(): Promise<ReadonlyArray<KnowledgeNode>>;
  /** Read the cross-reference edges. */
  listCrossRefs(): Promise<ReadonlyArray<KnowledgeEdge>>;
}

/**
 * The default fetcher. In v1.0 we read from a JSON manifest that the
 * Knowledge Layer producer emits; the producer side lives in FORA-389.
 * Tests and demos pass in `MockKnowledgeFetcher`.
 */
export class JsonManifestKnowledgeFetcher implements KnowledgeFetcher {
  constructor(private readonly manifestUrl: string) {}
  async listFiles(): Promise<ReadonlyArray<KnowledgeNode>> {
    const res = await fetch(this.manifestUrl);
    if (!res.ok) throw new Error(`knowledge manifest ${this.manifestUrl} → ${res.status}`);
    return (await res.json()) as ReadonlyArray<KnowledgeNode>;
  }
  async listCrossRefs(): Promise<ReadonlyArray<KnowledgeEdge>> {
    // v1.0 ships cross-refs alongside files in the same manifest; split the
    // endpoint once the producer separates them.
    return [];
  }
}

/** In-memory fetcher — used by tests, by MockGraphProvider, and by demos. */
export class InMemoryKnowledgeFetcher implements KnowledgeFetcher {
  private files: KnowledgeNode[];
  private edges: KnowledgeEdge[];
  constructor(initial?: {
    files?: ReadonlyArray<KnowledgeNode>;
    edges?: ReadonlyArray<KnowledgeEdge>;
  }) {
    this.files = initial?.files ? [...initial.files] : [];
    this.edges = initial?.edges ? [...initial.edges] : [];
  }
  setFiles(files: ReadonlyArray<KnowledgeNode>): void { this.files = [...files]; }
  setEdges(edges: ReadonlyArray<KnowledgeEdge>): void { this.edges = [...edges]; }
  async listFiles(): Promise<ReadonlyArray<KnowledgeNode>> { return this.files; }
  async listCrossRefs(): Promise<ReadonlyArray<KnowledgeEdge>> { return this.edges; }
}

export class KnowledgeGraphProvider implements GraphProvider<KnowledgeNode, KnowledgeEdge> {
  readonly id = KNOWLEDGE_PROVIDER_ID;
  readonly family = "knowledge" as const;
  private readonly cache: TtlCache<{
    nodes: ReadonlyArray<KnowledgeNode>;
    edges: ReadonlyArray<KnowledgeEdge>;
  }>;
  private readonly subs = new SubscriberRegistry<KnowledgeNode, KnowledgeEdge>();

  constructor(
    private readonly fetcher: KnowledgeFetcher,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    const cacheOpts: { ttlMs: number; now?: () => number } = { ttlMs: opts.ttlMs ?? 5 * 60 * 1000 };
    if (opts.now) cacheOpts.now = opts.now;
    this.cache = new TtlCache(cacheOpts);
  }

  async getNodes(filter: GraphFilter): Promise<ReadonlyArray<KnowledgeNode>> {
    const all = await this.readAll();
    return applyFilter(all.nodes, filter);
  }

  async getEdges(filter: GraphFilter): Promise<ReadonlyArray<KnowledgeEdge>> {
    const all = await this.readAll();
    return applyFilter(all.edges, filter);
  }

  watch(
    filter: GraphFilter,
    onChange: (delta: GraphDelta<KnowledgeNode, KnowledgeEdge>) => void,
  ): Unsubscribe {
    return this.subs.subscribe(filter, (delta: GraphDeltaNotification<KnowledgeNode, KnowledgeEdge>) =>
      onChange(toPublicDelta(delta)),
    );
  }

  /** Eager-invalidate on Knowledge Layer file write. Drops the cache and notifies. */
  invalidate(): void {
    this.cache.clear();
    this.subs.notify({
      addedNodes: [],
      removedNodeIds: [],
      updatedNodes: [],
      addedEdges: [],
      removedEdgeIds: [],
      updatedEdges: [],
      emittedAt: new Date().toISOString(),
    });
  }

  private async readAll() {
    const cached = this.cache.get({});
    if (cached) return cached;
    const [nodes, edges] = await Promise.all([
      this.fetcher.listFiles(),
      this.fetcher.listCrossRefs(),
    ]);
    const value = { nodes, edges };
    this.cache.set({}, value);
    return value;
  }
}

function applyFilter<T extends { id: string }>(items: ReadonlyArray<T>, filter: GraphFilter): ReadonlyArray<T> {
  let out: ReadonlyArray<T> = items;
  if (filter.nodeIds && filter.nodeIds.length > 0) {
    const allowed = new Set(filter.nodeIds);
    out = out.filter((i) => allowed.has(i.id));
  }
  if (filter.family && filter.family.length > 0) {
    const allowed = new Set<string>(filter.family);
    out = out.filter((i) => {
      const fam = (i as unknown as { family?: string }).family;
      return fam != null && allowed.has(fam);
    });
  }
  if (filter.offset != null || filter.limit != null) {
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? items.length;
    out = out.slice(offset, offset + limit);
  }
  return out;
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
