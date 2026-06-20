/**
 * @fora/mcp-breaker — pure state machine
 *
 * Reused-pattern from `@fora/sync-plane-ratelimit/src/circuit_breaker.ts`
 * (FORA-256) and `@fora/customer-cloud-broker/src/adapters/aws.ts`
 * (FORA-126.5). The differences here:
 *
 *   - Keying: per `(tenantId, serverName)` — the sync-plane breaker is
 *     per-platform (one breaker protects every tenant), and the cloud
 *     broker's is per-tenant+service. MCP is per-tenant+server.
 *   - Trip rule: BOTH "5 consecutive failures" AND "errorRate > 0.5 over
 *     30s sliding window". Either trips. The cloud-broker's uses only
 *     the consecutive-failure rule; the sync-plane uses only consecutive
 *     failures within a window. The MCP breaker is a hybrid per FORA-48
 *     §3.3 because MCP servers fail both ways (a single bad auth call
 *     trips repeatedly; a flaky network fails intermittently).
 *   - Half-open semantics: probe-slot lock — only one probe at a time.
 *
 * The state machine is intentionally side-effect free. Persistence and
 * event emission live in `breaker.ts`; tests can drive `decide` /
 * `apply` directly without an event bus or cache.
 */

import {
  type BreakerDecision,
  type BreakerPolicy,
  type BreakerSnapshot,
  type BreakerState,
  type CallOutcome,
  DEFAULT_POLICY,
} from './types.js';

/** A pure transition: read the snapshot, return the decision + next snapshot. */
export function decide(
  key: { tenant_id: string; server_name: string },
  snapshot: BreakerSnapshot,
  now_ms: number,
  policy: BreakerPolicy = DEFAULT_POLICY,
): { decision: BreakerDecision; next: BreakerSnapshot } {
  if (!key.tenant_id) throw new Error('mcp-breaker: tenant_id is required');
  if (!key.server_name) throw new Error('mcp-breaker: server_name is required');

  // 1. Prune samples outside the sliding window.
  const pruned = pruneWindow(snapshot, now_ms, policy.window_ms);

  if (pruned.state === 'open') {
    const elapsed = now_ms - pruned.state_since_ms;
    if (elapsed >= policy.cooldown_ms) {
      // Cool-down elapsed → transition to half_open and admit the first probe.
      // Flip the probe-slot sentinel so the next caller is rejected until
      // this probe resolves.
      const next: BreakerSnapshot = {
        ...pruned,
        state: 'half_open',
        state_since_ms: now_ms,
        consecutive_failures: -1,
      };
      return {
        decision: { allow: true, state: 'half_open', probe: true },
        next,
      };
    }
    return {
      decision: { allow: false, state: 'open', retry_after_ms: policy.cooldown_ms - elapsed },
      next: pruned,
    };
  }

  if (pruned.state === 'half_open') {
    // Only one probe at a time. The probe-slot flag lives on the snapshot as
    // `consecutive_failures === -1` sentinel while a probe is in flight; the
    // orchestrator (breaker.ts) flips it back on success / failure.
    if (pruned.consecutive_failures === -1) {
      return {
        decision: { allow: false, state: 'open', retry_after_ms: policy.cooldown_ms },
        next: pruned,
      };
    }
    return {
      decision: { allow: true, state: 'half_open', probe: true },
      next: { ...pruned, consecutive_failures: -1 },
    };
  }

  // closed → allow.
  return { decision: { allow: true, state: 'closed', probe: false }, next: pruned };
}

/**
 * Apply a call outcome to a snapshot and return the next snapshot. The
 * caller passes the outcome AFTER the call completes (or throws).
 */
export function apply(
  snapshot: BreakerSnapshot,
  outcome: CallOutcome,
  now_ms: number,
  policy: BreakerPolicy = DEFAULT_POLICY,
): BreakerSnapshot {
  const pruned = pruneWindow(snapshot, now_ms, policy.window_ms);

  if (pruned.state === 'half_open') {
    if (outcome === 'success') {
      // Probe succeeded → closed; clear probe + samples.
      return {
        state: 'closed',
        state_since_ms: now_ms,
        recent_calls: [],
        consecutive_failures: 0,
        window_ms: policy.window_ms,
      };
    }
    // Probe failed → open, restart cool-down clock.
    return {
      state: 'open',
      state_since_ms: now_ms,
      recent_calls: [{ at_ms: now_ms, outcome: 'failure' }],
      consecutive_failures: 1,
      window_ms: policy.window_ms,
    };
  }

  // closed → record outcome, decide if we trip.
  const new_calls = [...pruned.recent_calls, { at_ms: now_ms, outcome }];
  // Recompute consecutive_failures from the END of the window. After the
  // prune, old samples drop out, so the trailing run of failures can shrink.
  let consecutive = 0;
  for (let i = new_calls.length - 1; i >= 0; i--) {
    const call = new_calls[i]!;
    if (call.outcome === 'failure') consecutive++;
    else break;
  }

  // Trip rule 1: N consecutive failures.
  if (outcome === 'failure' && consecutive >= policy.consecutive_failure_threshold) {
    return {
      state: 'open',
      state_since_ms: now_ms,
      recent_calls: new_calls,
      consecutive_failures: consecutive,
      window_ms: policy.window_ms,
    };
  }

  // Trip rule 2: errorRate > threshold over the sliding window, with
  // a min-calls guard so a single failure does not trip a half-empty window.
  if (new_calls.length >= policy.error_rate_min_calls) {
    const failures = new_calls.filter((c) => c.outcome === 'failure').length;
    const rate = failures / new_calls.length;
    if (rate > policy.error_rate_threshold) {
      return {
        state: 'open',
        state_since_ms: now_ms,
        recent_calls: new_calls,
        consecutive_failures: consecutive,
        window_ms: policy.window_ms,
      };
    }
  }

  return {
    state: 'closed',
    state_since_ms: pruned.state_since_ms,
    recent_calls: new_calls,
    consecutive_failures: consecutive,
    window_ms: policy.window_ms,
  };
}

/** Empty snapshot for a brand-new `(tenantId, serverName)` key. */
export function emptySnapshot(window_ms: number): BreakerSnapshot {
  return {
    state: 'closed',
    state_since_ms: 0,
    recent_calls: [],
    consecutive_failures: 0,
    window_ms,
  };
}

/** Drop samples outside the sliding window. */
function pruneWindow(
  snapshot: BreakerSnapshot,
  now_ms: number,
  window_ms: number,
): BreakerSnapshot {
  const cutoff = now_ms - window_ms;
  const recent = snapshot.recent_calls.filter((c) => c.at_ms >= cutoff);
  return { ...snapshot, recent_calls: recent };
}

/** Read-only helper: current error rate (0 when no samples). */
export function errorRate(snapshot: BreakerSnapshot, now_ms: number): number {
  const cutoff = now_ms - snapshot.window_ms;
  const samples = snapshot.recent_calls.filter((c) => c.at_ms >= cutoff);
  if (samples.length === 0) return 0;
  const failures = samples.filter((c) => c.outcome === 'failure').length;
  return failures / samples.length;
}