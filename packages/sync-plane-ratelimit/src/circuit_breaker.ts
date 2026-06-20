/**
 * CircuitBreaker — per-(connector_id, tenant_id) failure isolation.
 *
 * Pattern reused from `@fora/customer-cloud-broker/src/adapters/aws.ts`
 * (FORA-126.5) and extended per FORA-487 Layer 3:
 *   - Per `(connector_id, tenant_id)` keying.
 *   - Failure-ratio mode: trips on `>50% failures over 20 calls`
 *     (sliding window) — in addition to v0.1 consecutive-failure mode.
 *   - Exponential backoff on repeated half-open failures:
 *     30s → 60s → 120s → 240s → 300s (5 min cap).
 *   - Emits `connector.circuit.{opened,half_open,closed}` transitions
 *     to the audit module.
 *
 * FORA-487 Layer 3 (circuit breaker, failure-driven).
 * FORA-391 Plan 5 §3.3.
 */

export type BreakerState = 'closed' | 'open' | 'half_open';

export type BreakerMode = 'consecutive' | 'failure_ratio' | 'both';

export interface CircuitBreakerOpts {
  /** Consecutive failures that trip the breaker from closed → open. Default 5. */
  readonly failure_threshold?: number;
  /** Sliding window over which consecutive failures accumulate (ms). Default 60_000. */
  readonly failure_window_ms?: number;
  /** Base cooldown (ms) before half-open probe. Default 30_000 (FORA-487 Layer 3). */
  readonly cooldown_ms?: number;
  /** Cooldown cap after repeated half-open failures (ms). Default 300_000 (5 min). */
  readonly cooldown_max_ms?: number;
  /** Sliding window for the failure-ratio mode. Default 20 calls. */
  readonly ratio_window?: number;
  /** Failure ratio threshold (0..1). Default 0.5 (50%). */
  readonly ratio_threshold?: number;
  /** Mode: 'consecutive' (v0.1), 'failure_ratio', or 'both' (FORA-487 default). */
  readonly mode?: BreakerMode;
  /** `now()` injection for tests. */
  readonly now?: () => number;
}

export interface BreakerTransition {
  readonly from: BreakerState;
  readonly to: BreakerState;
  readonly at_ms: number;
  /** The trigger that caused the transition (for audit + diagnostics). */
  readonly trigger?: 'consecutive' | 'failure_ratio' | 'cooldown_elapsed' | 'probe_success' | 'probe_failure';
}

export class CircuitBreaker {
  state: BreakerState = 'closed';
  private failure_timestamps: number[] = [];
  private opened_at_ms = 0;
  private half_open_in_flight = false;
  private readonly failure_threshold: number;
  private readonly failure_window_ms: number;
  private readonly cooldown_base_ms: number;
  private readonly cooldown_max_ms: number;
  private readonly ratio_window: number;
  private readonly ratio_threshold: number;
  private readonly mode: BreakerMode;
  private readonly now: () => number;
  private readonly transitions: BreakerTransition[] = [];
  /** Sliding window of recent call outcomes (true=success, false=failure) for ratio mode. */
  private recent_outcomes: boolean[] = [];
  /** Number of consecutive half-open failures (drives exp backoff). */
  private half_open_failures = 0;
  /** Total successes since last open. */
  private total_successes = 0;

  constructor(opts: CircuitBreakerOpts = {}) {
    this.failure_threshold = opts.failure_threshold ?? 5;
    this.failure_window_ms = opts.failure_window_ms ?? 60_000;
    this.cooldown_base_ms = opts.cooldown_ms ?? 30_000;
    this.cooldown_max_ms = opts.cooldown_max_ms ?? 5 * 60_000;
    this.ratio_window = opts.ratio_window ?? 20;
    this.ratio_threshold = opts.ratio_threshold ?? 0.5;
    this.mode = opts.mode ?? 'both';
    this.now = opts.now ?? Date.now;

    if (this.failure_threshold <= 0) throw new Error('circuit_breaker: threshold must be > 0');
    if (this.cooldown_base_ms < 0) throw new Error('circuit_breaker: cooldown_ms must be >= 0');
    if (this.cooldown_max_ms < this.cooldown_base_ms) {
      throw new Error('circuit_breaker: cooldown_max_ms must be >= cooldown_ms');
    }
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
      const wait = this.currentCooldown();
      if (this.now() - this.opened_at_ms >= wait) {
        this.setState('half_open', 'cooldown_elapsed');
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
    this.recent_outcomes.push(true);
    this.trimOutcomes();
    this.total_successes += 1;
    this.half_open_in_flight = false;
    if (this.state === 'half_open') {
      this.half_open_failures = 0;
      this.setState('closed', 'probe_success');
      return;
    }
    if (this.state === 'closed') {
      // Re-evaluate the failure-ratio trip in case the window just
      // filled up on this very call. The breaker was already closed;
      // a trip here is a delayed reaction to the running ratio.
      const shouldTrip = this.evaluateTrip();
      if (shouldTrip) {
        this.opened_at_ms = this.now();
        this.half_open_failures = 0;
        this.setState('open', shouldTrip);
      }
    }
  }

  onFailure(): void {
    const now = this.now();
    this.failure_timestamps.push(now);
    const cutoff = now - this.failure_window_ms;
    this.failure_timestamps = this.failure_timestamps.filter((t) => t >= cutoff);
    this.recent_outcomes.push(false);
    this.trimOutcomes();
    this.half_open_in_flight = false;

    if (this.state === 'half_open') {
      this.half_open_failures += 1;
      this.opened_at_ms = now;
      this.setState('open', 'probe_failure');
      return;
    }

    if (this.state === 'closed') {
      const shouldTrip = this.evaluateTrip();
      if (shouldTrip) {
        this.opened_at_ms = now;
        this.half_open_failures = 0;
        this.setState('open', shouldTrip);
      }
    }
  }

  /** Read-only access to recent transitions (for audit emission). */
  recentTransitions(): readonly BreakerTransition[] {
    return this.transitions;
  }

  /**
   * Current effective cooldown (ms) given the half-open failure count.
   * Pattern: base × 2^half_open_failures, capped at cooldown_max_ms.
   *  - 0 half-open failures → base (1×)
   *  - 1 half-open failure  → base × 2
   *  - 2 half-open failures → base × 4
   *  - 3 half-open failures → base × 8
   *  - 4+ half-open failures → base × 16 (capped at max)
   */
  currentCooldown(): number {
    const factor = Math.pow(2, Math.min(this.half_open_failures, 4));
    return Math.min(this.cooldown_max_ms, this.cooldown_base_ms * factor);
  }

  /** Read-only stats for the UI / smoke test. */
  get stats(): { state: BreakerState; total_successes: number; total_outcomes: number; failure_ratio: number; cooldown_ms: number; half_open_failures: number } {
    const total_outcomes = this.recent_outcomes.length;
    const failures = this.recent_outcomes.filter((o) => !o).length;
    return {
      state: this.state,
      total_successes: this.total_successes,
      total_outcomes,
      failure_ratio: total_outcomes > 0 ? failures / total_outcomes : 0,
      cooldown_ms: this.currentCooldown(),
      half_open_failures: this.half_open_failures,
    };
  }

  private evaluateTrip(): BreakerTransition['trigger'] | undefined {
    if (this.mode === 'consecutive' || this.mode === 'both') {
      if (this.failure_timestamps.length >= this.failure_threshold) return 'consecutive';
    }
    if (this.mode === 'failure_ratio' || this.mode === 'both') {
      if (this.recent_outcomes.length >= this.ratio_window) {
        const failures = this.recent_outcomes.filter((o) => !o).length;
        const ratio = failures / this.recent_outcomes.length;
        if (ratio > this.ratio_threshold) return 'failure_ratio';
      }
    }
    return undefined;
  }

  private trimOutcomes(): void {
    if (this.recent_outcomes.length > this.ratio_window) {
      this.recent_outcomes = this.recent_outcomes.slice(-this.ratio_window);
    }
  }

  private setState(to: BreakerState, trigger?: BreakerTransition['trigger']): void {
    if (this.state === to) return;
    const from = this.state;
    this.state = to;
    const at_ms = this.now();
    const transition: BreakerTransition = trigger !== undefined ? { from, to, at_ms, trigger } : { from, to, at_ms };
    this.transitions.push(transition);
    if (this.transitions.length > 64) this.transitions.shift();
  }
}
