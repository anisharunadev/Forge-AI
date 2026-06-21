/**
 * DependencyGraphProvider — Plan 2 §3.3 + §5.
 *
 * Backs the Dependency Graph canvas (Development Center). Data source is the
 * repo analyzer output (`forge/2.3/cycles.json` shape) + ownership registry.
 * Cache TTL: 15 minutes. Scheduled refresh on build completion.
 *
 * Per Plan 2 §4.5, edges beyond 500 are aggregated — the provider sums
 * `imports` edges within a package into a single `imports_external` summary
 * edge with a count badge.
 */

import { TtlCache, SubscriberRegistry, type GraphDeltaNotification } from "../cache";
import type { GraphDelta, GraphFilter, GraphProvider, Unsubscribe } from "../provider";
import type { DependencyEdge, DependencyNode } from "../nodes";

export const DEPENDENCY_PROVIDER_ID = "dependency-graph-v1";

export const EDGE_AGGREGATION_THRESHOLD = 500;

export interface DependencyFetcher {
  listModules(): Promise<ReadonlyArray<DependencyNode>>;
  listPackages(): Promise<ReadonlyArray<DependencyNode>>;
  listOwners(): Promise<ReadonlyArray<DependencyNode>>;
  listEdges(): Promise<ReadonlyArray<DependencyEdge>>;
}

export class InMemoryDependencyFetcher implements DependencyFetcher {
  private modules: DependencyNode[] = [];
  private packages: DependencyNode[] = [];
  private owners: DependencyNode[] = [];
  private edges: DependencyEdge[] = [];
  setModules(m: ReadonlyArray<DependencyNode>): void { this.modules = [...m]; }
  setPackages(p: ReadonlyArray<DependencyNode>): void { this.packages = [...p]; }
  setOwners(o: ReadonlyArray<DependencyNode>): void { this.owners = [...o]; }
  setEdges(e: ReadonlyArray<DependencyEdge>): void { this.edges = [...e]; }
  async listModules(): Promise<ReadonlyArray<DependencyNode>> { return this.modules; }
  async listPackages(): Promise<ReadonlyArray<DependencyNode>> { return this.packages; }
  async listOwners(): Promise<ReadonlyArray<DependencyNode>> { return this.owners; }
  async listEdges(): Promise<ReadonlyArray<DependencyEdge>> { return this.edges; }
}

export class DependencyGraphProvider implements GraphProvider<DependencyNode, DependencyEdge> {
  readonly id = DEPENDENCY_PROVIDER_ID;
  readonly family = "dependency" as const;
  private readonly cache: TtlCache<{
    nodes: ReadonlyArray<DependencyNode>;
    edges: ReadonlyArray<DependencyEdge>;
  }>;
  private readonly subs = new SubscriberRegistry<DependencyNode, DependencyEdge>();

  constructor(
    private readonly fetcher: DependencyFetcher,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    const cacheOpts: { ttlMs: number; now?: () => number } = { ttlMs: opts.ttlMs ?? 15 * 60 * 1000 };
    if (opts.now) cacheOpts.now = opts.now;
    this.cache = new TtlCache(cacheOpts);
  }

  async getNodes(filter: GraphFilter): Promise<ReadonlyArray<DependencyNode>> {
    const all = await this.readAll();
    let out: ReadonlyArray<DependencyNode> = all.nodes;
    if (filter.nodeIds && filter.nodeIds.length > 0) {
      const allowed = new Set(filter.nodeIds);
      out = out.filter((n) => allowed.has(n.id));
    }
    return out;
  }

  async getEdges(filter: GraphFilter): Promise<ReadonlyArray<DependencyEdge>> {
    const all = await this.readAll();
    let edges: ReadonlyArray<DependencyEdge> = all.edges;
    if (filter.nodeIds && filter.nodeIds.length > 0) {
      const allowed = new Set(filter.nodeIds);
      edges = edges.filter((e) => allowed.has(e.source) || allowed.has(e.target));
    }
    if (edges.length > EDGE_AGGREGATION_THRESHOLD) {
      edges = aggregateEdges(edges);
    }
    return edges;
  }

  watch(
    filter: GraphFilter,
    onChange: (delta: GraphDelta<DependencyNode, DependencyEdge>) => void,
  ): Unsubscribe {
    return this.subs.subscribe(filter, (d) => onChange(toPublicDelta(d)));
  }

  /** Scheduled refresh — called by the build-completion handler. */
  refresh(): void {
    this.cache.clear();
    this.subs.notify(emptyDelta());
  }

  private async readAll() {
    const cached = this.cache.get({});
    if (cached) return cached;
    const [modules, packages, owners, edges] = await Promise.all([
      this.fetcher.listModules(),
      this.fetcher.listPackages(),
      this.fetcher.listOwners(),
      this.fetcher.listEdges(),
    ]);
    const value = {
      nodes: [...modules, ...packages, ...owners],
      edges,
    };
    this.cache.set({}, value);
    return value;
  }
}

/**
 * Aggregate `imports` edges that target the same external package into a
 * single `imports_external` summary edge. Plan 2 §4.5: "the system
 * collapses imports edges within a package into a single imports_external
 * summary edge with a count badge."
 */
export function aggregateEdges(edges: ReadonlyArray<DependencyEdge>): ReadonlyArray<DependencyEdge> {
  const byTarget = new Map<string, DependencyEdge>();
  const passthrough: DependencyEdge[] = [];
  for (const e of edges) {
    if (e.kind !== "imports") {
      passthrough.push(e);
      continue;
    }
    const existing = byTarget.get(e.target);
    if (existing) {
      const next = (existing.aggregatedCount ?? 1) + 1;
      byTarget.set(e.target, {
        ...existing,
        aggregatedCount: next,
        annotation: `×${next} modules`,
      });
    } else {
      byTarget.set(e.target, {
        ...e,
        kind: "imports_external",
        aggregatedCount: 1,
        annotation: "×1 modules",
      });
    }
  }
  return [...passthrough, ...byTarget.values()];
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
