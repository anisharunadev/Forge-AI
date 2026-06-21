/**
 * Typed graph provider — FORA-393 Plan 2 §5.
 *
 * Every canvas in §3 reads from a typed graph provider, not from raw API
 * calls. The provider is the source of truth for nodes, edges, pagination,
 * cache, and freshness. The canvas is the visualization.
 *
 * Each implementation (Knowledge / Architecture / Dependency / Audit) is a
 * concrete class in this directory; the contract here is what they share.
 */

/** Unsubscribe handle returned by {@link GraphProvider.watch}. */
export type Unsubscribe = () => void;

/**
 * Filter applied to {@link GraphProvider.getNodes} / {@link GraphProvider.getEdges}.
 * Implementations are free to ignore keys they don't understand; a `null` field
 * is "no filter on this axis". Empty object fetches everything.
 */
export interface GraphFilter {
  /** Restrict to these node ids (deduped). */
  readonly nodeIds?: ReadonlyArray<string> | null;
  /** Restrict to typed-artifact family (Knowledge / Architecture / Dependency / Audit). */
  readonly family?: ReadonlyArray<GraphFamily> | null;
  /** Free-form key/value bag for center-specific narrowing (e.g. folder, stage, owner). */
  readonly attributes?: Readonly<Record<string, string | number | boolean>> | null;
  /** Inclusive pagination window. Defaults to 0..200 inside the implementation. */
  readonly offset?: number;
  readonly limit?: number;
}

/** The four artifact families Plan 2 names. The color tokens live in tokens/index. */
export type GraphFamily = "knowledge" | "architecture" | "dependency" | "audit";

/**
 * Delta pushed to {@link GraphProvider.watch} subscribers. Mirrors the data
 * shape (Node + Edge) of the underlying provider so consumers can splice
 * directly into React Flow's `nodes` / `edges` state.
 */
export interface GraphDelta<N, E> {
  readonly addedNodes: ReadonlyArray<N>;
  readonly removedNodeIds: ReadonlyArray<string>;
  readonly updatedNodes: ReadonlyArray<N>;
  readonly addedEdges: ReadonlyArray<E>;
  readonly removedEdgeIds: ReadonlyArray<string>;
  readonly updatedEdges: ReadonlyArray<E>;
  /** ISO timestamp of when the upstream source emitted the delta. */
  readonly emittedAt: string;
}

/**
 * Cache + freshness strategy an implementation applies to its data source.
 * Plan 2 §5 names the per-provider values; we model them so the shared
 * `createCachedProvider` factory in `cache.ts` can apply the right behavior.
 */
export type CacheStrategy = "eager-invalidate" | "scheduled" | "live-tail";

/**
 * The provider contract every implementation satisfies. The generic shape
 * means each canvas can use its own strongly-typed `Node` / `Edge` types
 * (e.g. `KnowledgeNode` / `KnowledgeEdge`) without `any` escaping.
 */
export interface GraphProvider<N, E> {
  /** Unique provider id; used as the React Flow `providerId` for delta routing. */
  readonly id: string;
  /** Artifact family this provider serves. */
  readonly family: GraphFamily;
  /** Read the current node set, filtered. Resolves with the same `N` consumers already typed. */
  getNodes(filter: GraphFilter): Promise<ReadonlyArray<N>>;
  /** Read the current edge set, filtered. */
  getEdges(filter: GraphFilter): Promise<ReadonlyArray<E>>;
  /**
   * Subscribe to changes. Implementations debounce + batch — never push more
   * than one delta per `flushIntervalMs`. The returned function unsubscribes.
   */
  watch(
    filter: GraphFilter,
    onChange: (delta: GraphDelta<N, E>) => void,
  ): Unsubscribe;
  /**
   * Eager invalidation hook. Most providers ignore this; the ones backed by
   * registries (`KnowledgeGraphProvider`, `ArchitectureGraphProvider`) call
   * it on upstream mutations to drop their cache and force the next `get*`
   * to re-read.
   */
  invalidate?(): void;
  /**
   * Tear down the provider. The default implementation is a no-op; long-lived
   * pollers / SSE listeners should override to stop their background work.
   */
  dispose?(): void;
}

/** Helper: shallow equality for `GraphFilter` cache keys. */
export function filtersEqual(a: GraphFilter, b: GraphFilter): boolean {
  if (a === b) return true;
  if (a.nodeIds?.length !== b.nodeIds?.length) return false;
  if ((a.family?.length ?? 0) !== (b.family?.length ?? 0)) return false;
  if ((a.attributes?.["keyCount"] ?? Object.keys(a.attributes ?? {}).length) !==
      (b.attributes?.["keyCount"] ?? Object.keys(b.attributes ?? {}).length)) {
    return false;
  }
  if (a.offset !== b.offset || a.limit !== b.limit) return false;
  for (let i = 0; i < (a.nodeIds?.length ?? 0); i++) {
    if (a.nodeIds?.[i] !== b.nodeIds?.[i]) return false;
  }
  for (let i = 0; i < (a.family?.length ?? 0); i++) {
    if (a.family?.[i] !== b.family?.[i]) return false;
  }
  return true;
}
