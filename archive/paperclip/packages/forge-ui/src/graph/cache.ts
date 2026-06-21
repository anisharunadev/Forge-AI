/**
 * TTL cache + eager-invalidation helper for graph providers.
 *
 * Plan 2 §5 names three cache strategies:
 *  - `eager-invalidate` (Knowledge + Architecture) — TTL is the floor; the
 *    registry notifies on every mutation, so the cache is empty most of the time
 *  - `scheduled` (Dependency) — TTL is the truth; we re-read on `refresh()`
 *  - `live-tail` (Audit) — TTL is the polling floor; SSE bypasses it in v1.1
 *
 * This module is intentionally side-effect free: a single in-memory `Map`
 * keyed by JSON.stringify(filter). Tests can construct it fresh per case.
 */

import { filtersEqual, type GraphFilter, type Unsubscribe } from "./provider";

export interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export interface TtlCacheOptions {
  /** TTL in ms. After this many ms, the next read re-fetches. */
  readonly ttlMs: number;
  /** Wall-clock for tests (defaults to `Date.now`). */
  readonly now?: () => number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: TtlCacheOptions) {
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? (() => Date.now());
  }

  get(filter: GraphFilter): T | undefined {
    const key = keyOf(filter);
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(filter: GraphFilter, value: T): void {
    this.store.set(keyOf(filter), {
      value,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  /** Drop every entry — `eager-invalidate` providers call this on mutation. */
  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

function keyOf(filter: GraphFilter): string {
  // GraphFilter is readonly; JSON.stringify is a stable key here. We never
  // put a function / symbol inside it, so this is safe.
  return JSON.stringify(filter);
}

/**
 * Tiny in-process subscriber registry. The shared `BaseGraphProvider` calls
 * this from `watch` and exposes a `_notify(delta)` for implementations to
 * fire after a successful upstream read.
 */
export class SubscriberRegistry<N, E> {
  private readonly subs = new Set<(delta: GraphDeltaNotification<N, E>) => void>();
  private readonly filterIndex = new Map<
    (delta: GraphDeltaNotification<N, E>) => void,
    GraphFilter
  >();

  subscribe(
    filter: GraphFilter,
    onChange: (delta: GraphDeltaNotification<N, E>) => void,
  ): Unsubscribe {
    this.subs.add(onChange);
    this.filterIndex.set(onChange, filter);
    return () => {
      this.subs.delete(onChange);
      this.filterIndex.delete(onChange);
    };
  }

  /** Returns the number of currently active subscribers. */
  size(): number {
    return this.subs.size;
  }

  /** Notify every subscriber whose filter covers the changed ids. */
  notify(
    delta: GraphDeltaNotification<N, E>,
    matcher?: (filter: GraphFilter, delta: GraphDeltaNotification<N, E>) => boolean,
  ): void {
    for (const sub of this.subs) {
      const filter = this.filterIndex.get(sub);
      if (!filter) continue;
      if (matcher && !matcher(filter, delta)) continue;
      sub(delta);
    }
  }
}

/**
 * Compact notification shape — same fields as `GraphDelta` from `provider.ts`
 * but loosened (mutable arrays) so providers can build it cheaply. Consumers
 * receive the readonly `GraphDelta` from the public API.
 */
export interface GraphDeltaNotification<N, E> {
  addedNodes: N[];
  removedNodeIds: string[];
  updatedNodes: N[];
  addedEdges: E[];
  removedEdgeIds: string[];
  updatedEdges: E[];
  emittedAt: string;
}
