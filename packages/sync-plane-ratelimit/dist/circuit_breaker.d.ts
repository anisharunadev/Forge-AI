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
export declare class CircuitBreaker {
    state: BreakerState;
    private failure_timestamps;
    private opened_at_ms;
    private half_open_in_flight;
    private readonly failure_threshold;
    private readonly failure_window_ms;
    private readonly cooldown_ms;
    private readonly now;
    private readonly transitions;
    constructor(opts: CircuitBreakerOpts);
    /**
     * Returns `true` if the call may proceed. Side effect: when the
     * breaker is in `half_open` and the cooldown has elapsed, the first
     * caller wins the probe slot; subsequent callers are rejected until
     * the probe resolves.
     */
    canPass(): boolean;
    onSuccess(): void;
    onFailure(): void;
    /** Read-only access to recent transitions (for audit emission). */
    recentTransitions(): readonly BreakerTransition[];
    private setState;
}
