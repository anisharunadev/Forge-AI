/**
 * CircuitBreaker — per-platform failure isolation.
 *
 * Pattern reused from `@fora/customer-cloud-broker/src/adapters/aws.ts`
 * (FORA-126.5). The Sync Plane's breaker is *per platform* (NOT per
 * tenant+platform like the customer-cloud-broker's per-service
 * breaker) because the breaker reacts to platform health — a Jira
 * outage trips one breaker that protects every tenant at once. ADR-0010
 * §7.1: "Adapter's circuit breaker trips on consecutive 5xx".
 *
 * FORA-256 §"Scope":
 *   - trips on N consecutive 5xx within a sliding window (default 5
 *     in 60s)
 *   - half-open probe after 5 min
 *   - emits `sync.platform.degraded` on the open transition (the
 *     audit module turns the transition into the typed event)
 *
 * The breaker is a pure state machine. `now()` is injectable so the
 * smoke test can compress the 5-min cooldown to milliseconds.
 */

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOpts {
  /** Consecutive failures that trip the breaker from closed → open. */
  readonly failure_threshold: number;
  /** Sliding window over which failures accumulate (ms). */
  readonly failure_window_ms: number;
  /** Time (ms) the breaker stays open before allowing a half-open probe. */
  readonly cooldown_ms: number;
  /** `now()` injection for tests. */
  readonly now?: () => number;
}

export interface BreakerTransition {
  readonly from: BreakerState;
  readonly to: BreakerState;
  readonly at_ms: number;
}

export class CircuitBreaker {
  state: BreakerState = 'closed';
  private failure_timestamps: number[] = [];
  private opened_at_ms = 0;
  private half_open_in_flight = false;
  private readonly failure_threshold: number;
  private readonly failure_window_ms: number;
  private readonly cooldown_ms: number;
  private readonly now: () => number;
  private readonly transitions: BreakerTransition[] = [];

  constructor(opts: CircuitBreakerOpts) {
    if (opts.failure_threshold <= 0) throw new Error('circuit_breaker: threshold must be > 0');
    if (opts.cooldown_ms < 0) throw new Error('circuit_breaker: cooldown_ms must be >= 0');
    this.failure_threshold = opts.failure_threshold;
    this.failure_window_ms = opts.failure_window_ms;
    this.cooldown_ms = opts.cooldown_ms;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Returns `true` if the call may proceed. Side effect: when the
   * breaker is in `half_open` and the cooldown has elapsed, the first
   * caller wins the probe slot; subsequent callers are rejected until
   * the probe resolves.
   */
  canPass(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (this.now() - this.opened_at_ms >= this.cooldown_ms) {
        this.setState('half_open');
        this.half_open_in_flight = false;
      } else {
        return false;
      }
    }
    if (this.state === 'half_open') {
      if (this.half_open_in_flight) return false;
      this.half_open_in_flight = true;
      return true;
    }
    return false;
  }

  onSuccess(): void {
    this.failure_timestamps = [];
    this.half_open_in_flight = false;
    this.setState('closed');
  }

  onFailure(): void {
    const now = this.now();
    this.failure_timestamps.push(now);
    // Drop failures outside the sliding window.
    const cutoff = now - this.failure_window_ms;
    this.failure_timestamps = this.failure_timestamps.filter((t) => t >= cutoff);
    this.half_open_in_flight = false;
    if (this.state === 'half_open' || this.failure_timestamps.length >= this.failure_threshold) {
      this.opened_at_ms = now;
      this.setState('open');
    }
  }

  /** Read-only access to recent transitions (for audit emission). */
  recentTransitions(): readonly BreakerTransition[] {
    return this.transitions;
  }

  private setState(to: BreakerState): void {
    if (this.state === to) return;
    const from = this.state;
    this.state = to;
    this.transitions.push({ from, to, at_ms: this.now() });
    // Cap history to avoid unbounded growth in long-lived processes.
    if (this.transitions.length > 64) this.transitions.shift();
  }
}
