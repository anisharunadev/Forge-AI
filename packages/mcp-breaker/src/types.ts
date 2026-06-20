/**
 * @fora/mcp-breaker — types + typed errors
 *
 * The breaker is keyed by `(tenantId, serverName)`. Every MCP-server
 * integration gets its own per-tenant state machine; a tenant-A Jira
 * outage does NOT trip tenant-B Jira.
 *
 * Typed error: `CircuitOpenError` carries the same `(tenantId, serverName)`
 * key so the router can map it to the canonical MCP-router `mcp_unavailable`
 * error in FORA-48 §3.4 without losing the underlying cause.
 */

/** The three states the breaker cycles through. */
export type BreakerState = 'closed' | 'open' | 'half_open';

/** Single outcome recorded for the sliding-window error-rate calculation. */
export type CallOutcome = 'success' | 'failure';

/** Per-key state. One of these lives in the cache-broker per `(tenant, server)`. */
export interface BreakerSnapshot {
  readonly state: BreakerState;
  /** Last transition time (ms since epoch). Used to compute cool-down. */
  readonly state_since_ms: number;
  /** Sliding-window samples: ms timestamp per call. Old samples are pruned on read. */
  readonly recent_calls: ReadonlyArray<{ at_ms: number; outcome: CallOutcome }>;
  /** Number of consecutive failures from the most recent point. Reset on any success. */
  readonly consecutive_failures: number;
  /** Cached `recent_calls` window length so we don't have to recompute it. */
  readonly window_ms: number;
}

/** What the breaker decided about a call. */
export type BreakerDecision =
  | { readonly allow: true; readonly state: BreakerState; readonly probe: boolean }
  | { readonly allow: false; readonly state: 'open'; readonly retry_after_ms: number };

/** Threshold policy. Defaults match FORA-48 §3.3 v0.1. */
export interface BreakerPolicy {
  /** Trip after this many consecutive failures. Default 5. */
  readonly consecutive_failure_threshold: number;
  /** Sliding window in ms for the error-rate calculation. Default 30_000. */
  readonly window_ms: number;
  /** Trip when errorRate over the sliding window exceeds this. Default 0.5. */
  readonly error_rate_threshold: number;
  /** Minimum number of calls in the window before the error-rate trip is honored. Default 10. */
  readonly error_rate_min_calls: number;
  /** Time in ms before an `open` breaker transitions to `half_open`. Default 30_000. */
  readonly cooldown_ms: number;
}

/** Default policy — matches the v0.1 spec verbatim. */
export const DEFAULT_POLICY: BreakerPolicy = {
  consecutive_failure_threshold: 5,
  window_ms: 30_000,
  error_rate_threshold: 0.5,
  error_rate_min_calls: 10,
  cooldown_ms: 30_000,
};

/**
 * The typed error thrown / returned when the breaker is `open` (or
 * `half_open` and the probe slot is taken). Mirrors the pattern in
 * `@fora/customer-cloud-broker` and `@fora/sync-plane-ratelimit` — a
 * discriminated `kind` so callers can branch without parsing strings.
 *
 * Note on naming: the FORA-48 v0.1 plan calls the typed error
 * `circuit_open`. The future MCP Platform Engineer (Hire #6 charter §3.3)
 * will rename / wrap this into `mcp_unavailable` at the router seam; the
 * breaker package keeps the lower-level name because the circuit is what
 * is open, not the MCP server as a whole.
 */
export class CircuitOpenError extends Error {
  readonly kind = 'circuit_open' as const;
  readonly tenant_id: string;
  readonly server_name: string;
  readonly state: BreakerState;
  readonly retry_after_ms: number;

  constructor(
    message: string,
    details: { tenant_id: string; server_name: string; state: BreakerState; retry_after_ms: number },
  ) {
    super(message);
    this.name = 'CircuitOpenError';
    this.tenant_id = details.tenant_id;
    this.server_name = details.server_name;
    this.state = details.state;
    this.retry_after_ms = details.retry_after_ms;
  }
}

/** Decision returned by the breaker for a given call. `state` is informational. */
export interface BreakerCallResult {
  readonly decision: BreakerDecision;
  readonly snapshot: BreakerSnapshot;
}