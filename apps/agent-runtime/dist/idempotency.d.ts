/**
 * Idempotency store — §6 of the design doc.
 *
 *   - Keyed by `(agentId, tool, key)`. `key` is the per-step idempotency
 *     key supplied by the planner/handler.
 *   - In-process LRU with a default ~5 minute TTL. The interface is
 *     pluggable; the SQLite-backed store lands in 0.5 Audit.
 *   - A dedupe hit is recorded in the run record as `IdempotencyHit`.
 *
 * The store holds the *result* of the first successful invocation so a
 * retry returns the exact same bytes to the planner. Failed invocations
 * are not cached — a retry is allowed to fix a transient transport
 * failure.
 */
export interface IdempotencyRecord {
    output: unknown;
    storedAt: number;
    expiresAt: number;
}
export interface IdempotencyStore {
    /** Return the cached result, or `null` if no live record exists. */
    get(agentId: string, tool: string, key: string): IdempotencyRecord | null;
    /** Store a result with a TTL in ms (relative to `now()`). */
    set(agentId: string, tool: string, key: string, output: unknown, ttlMs: number): void;
    /** Remove a single entry (used by tests; not exposed at runtime). */
    delete(agentId: string, tool: string, key: string): void;
    /** Drop expired entries. Returns the number of entries evicted. */
    evictExpired(now: number): number;
    /** Diagnostic count. */
    size(): number;
}
/**
 * LRU + TTL map. Eviction is O(1) amortized; expired entries are dropped
 * lazily on read and eagerly when the store is full.
 */
export declare class LruIdempotencyStore implements IdempotencyStore {
    private readonly map;
    private readonly maxEntries;
    private readonly now;
    constructor(opts?: {
        maxEntries?: number;
        now?: () => number;
    });
    get(agentId: string, tool: string, key: string): IdempotencyRecord | null;
    set(agentId: string, tool: string, key: string, output: unknown, ttlMs?: number): void;
    delete(agentId: string, tool: string, key: string): void;
    evictExpired(now: number): number;
    size(): number;
    private evictIfFull;
}
/** A no-op store for tests that don't care about idempotency. */
export declare class NullIdempotencyStore implements IdempotencyStore {
    get(): null;
    set(): void;
    delete(): void;
    evictExpired(): number;
    size(): number;
}
