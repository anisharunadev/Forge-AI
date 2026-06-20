/**
 * BackoffPolicy — pure retry-policy calculator (FORA-487.3 / FORA-517).
 *
 * Implements the FORA-487 charter "Backoff scheduler" semantics:
 *   1. Honor a `Retry-After` header (RFC 7231: delta-seconds OR HTTP-date).
 *      Clamped to [floor_ms, ceiling_ms] so a misbehaving server can't
 *      make us sleep forever or burn the audit-trail budget.
 *   2. Otherwise exponential with full-jitter:
 *        delay = min(ceiling_ms, base_ms * 2^attempt) + uniform(0, jitter_ms)
 *      base = 500ms, jitter = 250ms, ceiling = 60s. The "+ jitter" pattern
 *      (vs. "full jitter" = uniform(0, ceil)) preserves the published
 *      backoff curve while breaking up thundering-herd retries.
 *   3. The caller decides max attempts (idempotent 5, non-idempotent 1) —
 *      this module is just the delay math.
 *
 * The RNG is injectable so the test suite can run deterministic scenarios
 * without depending on `Math.random()`. Default RNG is `Math.random`.
 *
 * Pattern reused from `p-retry` and the AWS SDK retry strategy; tuned
 * per the FORA-487 charter §"Backoff scheduler".
 */

export interface BackoffPolicyOpts {
  /** Base delay in ms. Default 500ms. */
  readonly base_ms?: number;
  /** Full-jitter spread in ms. Default 250ms. */
  readonly jitter_ms?: number;
  /** Hard ceiling in ms (applied BEFORE the jitter). Default 60_000 (60s). */
  readonly ceiling_ms?: number;
  /** Hard floor in ms. Default 1ms (refuses zero/negative delays so the
   *  event loop can yield). */
  readonly floor_ms?: number;
  /** RNG returning a number in [0, 1). Default `Math.random`. */
  readonly rng?: () => number;
}

/**
 * A pair of (raw header value, parsed ms) returned by `parseRetryAfterMs`
 * — exposed for tests. Production callers should use `nextDelayMs()`.
 */
export interface ParsedRetryAfter {
  readonly raw: string;
  readonly ms: number;
}

const DEFAULT_BASE_MS = 500;
const DEFAULT_JITTER_MS = 250;
const DEFAULT_CEILING_MS = 60_000;
const DEFAULT_FLOOR_MS = 1;

export class BackoffPolicy {
  private readonly base_ms: number;
  private readonly jitter_ms: number;
  private readonly ceiling_ms: number;
  private readonly floor_ms: number;
  private readonly rng: () => number;

  constructor(opts: BackoffPolicyOpts = {}) {
    this.base_ms = opts.base_ms ?? DEFAULT_BASE_MS;
    this.jitter_ms = opts.jitter_ms ?? DEFAULT_JITTER_MS;
    this.ceiling_ms = opts.ceiling_ms ?? DEFAULT_CEILING_MS;
    this.floor_ms = opts.floor_ms ?? DEFAULT_FLOOR_MS;
    this.rng = opts.rng ?? Math.random;
    if (this.base_ms <= 0) throw new Error('backoff_policy: base_ms must be > 0');
    if (this.jitter_ms < 0) throw new Error('backoff_policy: jitter_ms must be >= 0');
    if (this.ceiling_ms < this.base_ms) {
      throw new Error('backoff_policy: ceiling_ms must be >= base_ms');
    }
    if (this.floor_ms < 1) {
      throw new Error('backoff_policy: floor_ms must be >= 1ms');
    }
  }

  /** Returns the configured base delay (test seam). */
  get baseMs(): number {
    return this.base_ms;
  }

  /** Returns the configured jitter (test seam). */
  get jitterMs(): number {
    return this.jitter_ms;
  }

  /** Returns the configured ceiling (test seam). */
  get ceilingMs(): number {
    return this.ceiling_ms;
  }

  /** Returns the configured floor (test seam). */
  get floorMs(): number {
    return this.floor_ms;
  }

  /**
   * Parse a `Retry-After` header (RFC 7231 §7.1.3) into a clamped delay.
   * Returns `null` if the header is absent or unparseable — callers fall
   * back to the exponential schedule.
   *
   * The returned delay is clamped to [floor_ms, ceiling_ms] — the jitter
   * does NOT apply to Retry-After (the server told us the exact delay;
   * we should honor it without adding noise).
   */
  parseRetryAfter(headers: Readonly<Record<string, string>>): ParsedRetryAfter | null {
    const raw = headers['retry-after'] ?? headers['Retry-After'];
    if (raw === undefined || raw === '') return null;
    const trimmed = raw.trim();
    // Reject anything that looks like a malformed number (e.g. "-5").
    // new Date('-5') is "5 ms before epoch" — a valid date — so the
    // date branch below would happily parse it without this guard.
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const seconds = Number(trimmed);
      if (!Number.isFinite(seconds) || seconds < 0) return null;
      return { raw: trimmed, ms: this.clampRetryAfter(Math.round(seconds * 1000)) };
    }
    // Form 2: HTTP-date.
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      const delta = date.getTime() - Date.now();
      // A past date is the server telling us "retry now" — clamp to floor.
      if (delta <= 0) return { raw: trimmed, ms: this.floor_ms };
      return { raw: trimmed, ms: this.clampRetryAfter(delta) };
    }
    return null;
  }

  /**
   * Compute the next backoff delay.
   *
   *   - If `headers` includes a `Retry-After`, honor it (clamped).
   *   - Otherwise exponential with full-jitter: `min(ceiling, base*2^attempt) + uniform(0, jitter)`.
   *
   * `attempt` is 0-indexed (the first retry is `attempt=0` after the
   * initial call). Returns a delay in [floor_ms, ceiling_ms + jitter_ms].
   */
  nextDelayMs(attempt: number, headers?: Readonly<Record<string, string>>): number {
    if (headers) {
      const parsed = this.parseRetryAfter(headers);
      if (parsed !== null) return parsed.ms;
    }
    if (attempt < 0) attempt = 0;
    const capped = Math.min(this.ceiling_ms, this.base_ms * Math.pow(2, attempt));
    const jitter = this.rng() * this.jitter_ms;
    return this.clamp(capped + jitter);
  }

  /** Clamp a delay to [floor_ms, ceiling_ms + jitter_ms]. */
  private clamp(ms: number): number {
    const max = this.ceiling_ms + this.jitter_ms;
    if (ms < this.floor_ms) return this.floor_ms;
    if (ms > max) return max;
    return ms;
  }

  /** Clamp a Retry-After value to [floor_ms, ceiling_ms] (no jitter). */
  private clampRetryAfter(ms: number): number {
    if (ms < this.floor_ms) return this.floor_ms;
    if (ms > this.ceiling_ms) return this.ceiling_ms;
    return ms;
  }
}
