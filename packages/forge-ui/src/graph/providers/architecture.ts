/**
 * ArchitectureGraphProvider — Plan 2 §3.2 + §5.
 *
 * Backs the Architecture Graph canvas (Project Intelligence center). Data
 * source is the ADR + Component + Contract registries. Cache TTL: 1 minute.
 * Eager invalidation on ADR transition (proposed → accepted → superseded).
 */

import { TtlCache, SubscriberRegistry, type GraphDeltaNotification } from "../cache";
import type { GraphDelta, GraphFilter, GraphProvider, Unsubscribe } from "../provider";
import type { ArchitectureEdge, ArchitectureNode } from "../nodes";

export const ARCHITECTURE_PROVIDER_ID = "architecture-graph-v1";

export interface ArchitectureFetcher {
  listComponents(): Promise<ReadonlyArray<ArchitectureNode>>;
  listContracts(): Promise<ReadonlyArray<ArchitectureNode>>;
  listAdrs(): Promise<ReadonlyArray<ArchitectureNode>>;
  listStages(): Promise<ReadonlyArray<ArchitectureNode>>;
  listEdges(): Promise<ReadonlyArray<ArchitectureEdge>>;
}

export class InMemoryArchitectureFetcher implements ArchitectureFetcher {
  private components: ArchitectureNode[] = [];
  private contracts: ArchitectureNode[] = [];
  private adrs: ArchitectureNode[] = [];
  private stages: ArchitectureNode[] = [];
  private edges: ArchitectureEdge[] = [];
  setComponents(c: ReadonlyArray<ArchitectureNode>): void { this.components = [...c]; }
  setContracts(c: ReadonlyArray<ArchitectureNode>): void { this.contracts = [...c]; }
  setAdrs(a: ReadonlyArray<ArchitectureNode>): void { this.adrs = [...a]; }
  setStages(s: ReadonlyArray<ArchitectureNode>): void { this.stages = [...s]; }
  setEdges(e: ReadonlyArray<ArchitectureEdge>): void { this.edges = [...e]; }
  async listComponents(): Promise<ReadonlyArray<ArchitectureNode>> { return this.components; }
  async listContracts(): Promise<ReadonlyArray<ArchitectureNode>> { return this.contracts; }
  async listAdrs(): Promise<ReadonlyArray<ArchitectureNode>> { return this.adrs; }
  async listStages(): Promise<ReadonlyArray<ArchitectureNode>> { return this.stages; }
  async listEdges(): Promise<ReadonlyArray<ArchitectureEdge>> { return this.edges; }
}

export class ArchitectureGraphProvider implements GraphProvider<ArchitectureNode, ArchitectureEdge> {
  readonly id = ARCHITECTURE_PROVIDER_ID;
  readonly family = "architecture" as const;
  private readonly cache: TtlCache<{
    nodes: ReadonlyArray<ArchitectureNode>;
    edges: ReadonlyArray<ArchitectureEdge>;
  }>;
  private readonly subs = new SubscriberRegistry<ArchitectureNode, ArchitectureEdge>();

  constructor(
    private readonly fetcher: ArchitectureFetcher,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    const cacheOpts: { ttlMs: number; now?: () => number } = { ttlMs: opts.ttlMs ?? 60 * 1000 };
    if (opts.now) cacheOpts.now = opts.now;
    this.cache = new TtlCache(cacheOpts);
  }

  async getNodes(filter: GraphFilter): Promise<ReadonlyArray<ArchitectureNode>> {
    const all = await this.readAll();
    return applyNodeFilter(all.nodes, filter);
  }

  async getEdges(filter: GraphFilter): Promise<ReadonlyArray<ArchitectureEdge>> {
    const all = await this.readAll();
    return applyEdgeFilter(all.edges, filter);
  }

  watch(
    filter: GraphFilter,
    onChange: (delta: GraphDelta<ArchitectureNode, ArchitectureEdge>) => void,
  ): Unsubscribe {
    return this.subs.subscribe(filter, (d) => onChange(toPublicDelta(d)));
  }

  /** Eager-invalidate on ADR transition. */
  invalidate(): void {
    this.cache.clear();
    this.subs.notify(emptyDelta());
  }

  private async readAll() {
    const cached = this.cache.get({});
    if (cached) return cached;
    const [components, contracts, adrs, stages, edges] = await Promise.all([
      this.fetcher.listComponents(),
      this.fetcher.listContracts(),
      this.fetcher.listAdrs(),
      this.fetcher.listStages(),
      this.fetcher.listEdges(),
    ]);
    const value = { nodes: [...components, ...contracts, ...adrs, ...stages], edges };
    this.cache.set({}, value);
    return value;
  }
}

function applyNodeFilter(items: ReadonlyArray<ArchitectureNode>, filter: GraphFilter): ReadonlyArray<ArchitectureNode> {
  let out: ReadonlyArray<ArchitectureNode> = items;
  if (filter.nodeIds && filter.nodeIds.length > 0) {
    const allowed = new Set(filter.nodeIds);
    out = out.filter((i) => allowed.has(i.id));
  }
  if (filter.attributes?.["adrStatus"]) {
    const status = String(filter.attributes["adrStatus"]);
    out = out.filter((n) => n.kind !== "adr" || n.adrStatus === status);
  }
  return out;
}

function applyEdgeFilter(items: ReadonlyArray<ArchitectureEdge>, filter: GraphFilter): ReadonlyArray<ArchitectureEdge> {
  if (filter.nodeIds && filter.nodeIds.length > 0) {
    const allowed = new Set(filter.nodeIds);
    return items.filter((e) => allowed.has(e.source) || allowed.has(e.target));
  }
  return items;
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
