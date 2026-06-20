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

export class TokenBucket {
  private tokens: number;
  private last_refill_ms: number;
  private readonly capacity: number;
  private readonly refill_per_ms: number;
  private readonly now: () => number;

  constructor(opts: TokenBucketOpts) {
    if (opts.capacity <= 0) throw new Error('token_bucket: capacity must be > 0');
    if (opts.refill_per_sec < 0) throw new Error('token_bucket: refill_per_sec must be >= 0');
    this.capacity = opts.capacity;
    this.refill_per_ms = opts.refill_per_sec / 1000;
    this.now = opts.now ?? Date.now;
    this.tokens = opts.capacity;
    this.last_refill_ms = this.now();
  }

  /**
   * Try to take one token. Returns `true` on success, `false` if the
   * bucket is empty (caller should fail fast with a rate-limit error).
   */
  take(): boolean {
    const now = this.now();
    const elapsed_ms = now - this.last_refill_ms;
    if (elapsed_ms > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed_ms * this.refill_per_ms);
      this.last_refill_ms = now;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Current token count (after refill at `now()`). Read-only. */
  level(): number {
    const now = this.now();
    const elapsed_ms = now - this.last_refill_ms;
    return Math.min(this.capacity, this.tokens + elapsed_ms * this.refill_per_ms);
  }

  /** Capacity (max tokens). */
  get maxCapacity(): number {
    return this.capacity;
  }
}
