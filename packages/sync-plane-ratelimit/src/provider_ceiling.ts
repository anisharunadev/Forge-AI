/**
 * ProviderCeiling — Layer 1 (provider ceiling, hard) of the
 * FORA-487 three-layer limiter.
 *
 * A token bucket per `(connector_id, auth_method, scope)` whose
 * capacity and refill rate come from a static ceilings registry
 * (e.g. GitHub REST 5000/hr, Jira Cloud REST 100/min, Slack
 * 1/sec per channel tier). Provider feedback from response
 * headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`,
 * `Retry-After`) dynamically tightens the bucket to mirror
 * what the provider says is left.
 *
 * The bucket is read-only externally; `take()` is O(1), `adjust()`
 * is the provider-feedback seam (call it once per response with the
 * provider's reported remaining count and Retry-After hint).
 *
 * Calls that would exceed the ceiling are **throttled** — the
 * caller waits for the next refill tick — not failed. The outbound
 * orchestrator surfaces the throttle as a `rejected_rate_limited`
 * disposition with `layer: 'provider'`.
 *
 * FORA-487 Layer 1 (provider ceiling, hard).
 * FORA-391 Plan 5 §3.1.
 */

import { TokenBucket } from './token_bucket.js';

export type ConnectorId = 'jira' | 'github' | 'clickup' | 'slack';

export type AuthMethod = 'pat' | 'oauth' | 'app' | 'webhook';

export type Scope =
  | 'rest'             // generic REST API
  | 'rest:write'       // state-changing REST
  | 'graphql'          // GraphQL
  | 'webhook'          // inbound webhook delivery
  | 'channel-tier-1'   // Slack tier 1
  | 'channel-tier-2'   // Slack tier 2
  | 'channel-tier-3';  // Slack tier 3

export interface CeilingConfig {
  /** Burst capacity. */
  readonly capacity: number;
  /** Steady-state refill rate (tokens per second). */
  readonly refill_per_sec: number;
}

export type CeilingRegistry = ReadonlyMap<string, CeilingConfig>;

const DEFAULT_CEILINGS: ReadonlyArray<readonly [string, CeilingConfig]> = [
  // GitHub REST: 5000 / hour
  ['github|pat|rest',          { capacity: 5000, refill_per_sec: 5000 / 3600 }],
  ['github|pat|rest:write',    { capacity: 5000, refill_per_sec: 5000 / 3600 }],
  ['github|app|rest',          { capacity: 5000, refill_per_sec: 5000 / 3600 }],
  ['github|app|graphql',       { capacity: 5000, refill_per_sec: 5000 / 3600 }],
  // Jira Cloud REST: 100 / min
  ['jira|pat|rest',            { capacity: 100, refill_per_sec: 100 / 60 }],
  ['jira|oauth|rest',          { capacity: 100, refill_per_sec: 100 / 60 }],
  ['jira|pat|rest:write',      { capacity: 100, refill_per_sec: 100 / 60 }],
  // ClickUp API: 100 / min
  ['clickup|pat|rest',         { capacity: 100, refill_per_sec: 100 / 60 }],
  ['clickup|pat|rest:write',   { capacity: 100, refill_per_sec: 100 / 60 }],
  // Slack: 1/sec per channel tier (tier 1, 2, 3)
  ['slack|app|channel-tier-1', { capacity: 1, refill_per_sec: 1 }],
  ['slack|app|channel-tier-2', { capacity: 20, refill_per_sec: 20 }],
  ['slack|app|channel-tier-3', { capacity: 50, refill_per_sec: 50 }],
];

export function defaultCeilingRegistry(): CeilingRegistry {
  return new Map(DEFAULT_CEILINGS);
}

export function ceilingKey(connector: ConnectorId, auth: AuthMethod, scope: Scope): string {
  return `${connector}|${auth}|${scope}`;
}

export interface ProviderFeedback {
  /** Provider-reported `X-RateLimit-Remaining` (tokens still on the provider's bucket). */
  readonly remaining?: number;
  /** Provider-reported `X-RateLimit-Limit` (provider's bucket size). */
  readonly limit?: number;
  /** Provider-reported `Retry-After` in seconds, if present. */
  readonly retry_after_sec?: number;
}

export interface ProviderCeilingOpts {
  readonly now?: () => number;
  /** Inject a custom registry (tests). Defaults to {@link defaultCeilingRegistry}. */
  readonly registry?: CeilingRegistry;
}

export class ProviderCeiling {
  private readonly bucket: TokenBucket;
  private readonly cfg: CeilingConfig;
  private readonly now: () => number;
  private readonly registry: CeilingRegistry;
  private readonly key: string;
  private readonly scope: Scope;
  /** When non-zero and > now(), `take()` returns false. The Retry-After drain seam. */
  private paused_until_ms = 0;
  /** Last-applied Retry-After reduction in ms (for diagnostics). */
  private last_retry_after_ms = 0;
  /** Last observed provider-remaining cap (for diagnostics). */
  private last_provider_remaining: number | null = null;

  constructor(connector: ConnectorId, auth: AuthMethod, scope: Scope, opts: ProviderCeilingOpts = {}) {
    this.key = ceilingKey(connector, auth, scope);
    this.scope = scope;
    this.now = opts.now ?? Date.now;
    this.registry = opts.registry ?? defaultCeilingRegistry();
    const cfg = this.registry.get(this.key);
    if (!cfg) {
      throw new Error(
        `provider_ceiling: no ceiling registered for ${this.key}. ` +
        `Register it via the constructor's \`registry\` option or use a built-in scope.`,
      );
    }
    this.cfg = cfg;
    this.bucket = new TokenBucket({ capacity: cfg.capacity, refill_per_sec: cfg.refill_per_sec, now: this.now });
  }

  /**
   * Try to take one token. Returns `true` on success, `false` if the
   * bucket is empty or currently paused (Retry-After in effect).
   * Caller should emit `connector.rate_limit.throttled` with
   * `layer: 'provider'` on `false`.
   */
  take(): boolean {
    if (this.now() < this.paused_until_ms) return false;
    return this.bucket.take();
  }

  /**
   * Adjust the dynamic capacity based on provider feedback.
   *
   * - If the provider reports `X-RateLimit-Remaining` and `-Limit`,
   *   we **drain the bucket** down to the reported remaining (when
   *   that is lower than the current level). Never raised above
   *   the static ceiling.
   * - If the provider reports `Retry-After`, we **pause** the bucket
   *   for that duration (1ms floor, 60s ceiling — matches the
   *   FORA-487 backoff scheduler floor/ceiling).
   *
   * Each call applies the feedback for the *current* state. A new
   * `Retry-After` always replaces the prior pause (most recent
   * server hint wins).
   */
  adjust(feedback: ProviderFeedback): void {
    if (typeof feedback.remaining === 'number' && typeof feedback.limit === 'number' && feedback.limit > 0) {
      const observed = Math.max(0, Math.min(feedback.remaining, this.cfg.capacity));
      this.last_provider_remaining = observed;
      const current = this.bucket.level();
      if (observed < current) {
        // Drain the delta. Repeated take() is the simplest drain
        // primitive; capacity may be very large but the drain is
        // bounded by `current - observed` so the loop is O(delta).
        for (let i = 0; i < current - observed; i++) {
          if (!this.bucket.take()) break;
        }
      }
    }
    if (typeof feedback.retry_after_sec === 'number' && feedback.retry_after_sec > 0) {
      // Floor 1ms, ceiling 60s — matches FORA-487 backoff scheduler.
      const ms = Math.max(1, Math.min(60_000, Math.round(feedback.retry_after_sec * 1000)));
      this.last_retry_after_ms = ms;
      this.paused_until_ms = this.now() + ms;
    }
  }

  /** True if the bucket is currently throttling (empty or paused). */
  isThrottling(): boolean {
    if (this.now() < this.paused_until_ms) return true;
    return this.bucket.level() < 1;
  }

  /** Read-only view of the registered scope (Layer 1 plumbing). */
  get currentKey(): string {
    return this.key;
  }

  /** Read-only view of the scope (Layer 1 plumbing). */
  get currentScope(): Scope {
    return this.scope;
  }

  /** Read-only: the static ceiling capacity. */
  get maxCapacity(): number {
    return this.cfg.capacity;
  }

  /** Read-only: the current level of the underlying bucket (for diagnostics). */
  level(): number {
    return this.bucket.level();
  }

  /** Read-only: the last applied Retry-After (ms) — 0 if none. */
  get lastRetryAfterMs(): number {
    return this.last_retry_after_ms;
  }

  /** Read-only: the last observed provider remaining — null if never observed. */
  get lastProviderRemaining(): number | null {
    return this.last_provider_remaining;
  }
}
