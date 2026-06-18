/**
 * TokenBucket — per-tenant + per-(tenant, platform) rate limiter.
 *
 * Pattern reused from `@fora/customer-cloud-broker/src/adapters/aws.ts`
 * (FORA-126.5). The Sync Plane needs *two* buckets in series:
 *   1. Per-tenant bucket — caps a single tenant's total outbound across
 *      ALL platforms (R-SYNC-08: one tenant bursting must not
 *      exhaust the platform's per-IP limit for everyone else).
 *   2. Per-(tenant, platform) bucket — caps how many requests a tenant
 *      can direct at a single platform in the same window. Distinct
 *      from (1) because each platform has its own quotas.
 *
 * The bucket is a pure object: `take()` is O(1), `now()` is injectable
 * for tests, no Node / no I/O. The smoke test exercises both layers.
 *
 * FORA-256 §"Scope":
 *   - per-tenant token bucket, configurable rate + burst
 *   - default 60 events / min / tenant (1 / sec), burst 10
 *   - per-platform adapter queue
 */
export interface TokenBucketOpts {
    /** Maximum burst size (capacity). */
    readonly capacity: number;
    /** Steady-state refill rate (tokens per second). */
    readonly refill_per_sec: number;
    /** `now()` injection for tests. */
    readonly now?: () => number;
}
export declare class TokenBucket {
    private tokens;
    private last_refill_ms;
    private readonly capacity;
    private readonly refill_per_ms;
    private readonly now;
    constructor(opts: TokenBucketOpts);
    /**
     * Try to take one token. Returns `true` on success, `false` if the
     * bucket is empty (caller should fail fast with a rate-limit error).
     */
    take(): boolean;
    /** Current token count (after refill at `now()`). Read-only. */
    level(): number;
    /** Capacity (max tokens). */
    get maxCapacity(): number;
}
