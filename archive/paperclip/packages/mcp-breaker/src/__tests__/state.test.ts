/**
 * State machine — pure tests.
 *
 * Drives `decide` / `apply` directly with an injectable clock. No IO,
 * no events — just the four-transition rule set from FORA-48 §3.3.
 */

import { describe, it, expect } from 'vitest';
import { apply, decide, emptySnapshot, errorRate } from '../state.js';
import { DEFAULT_POLICY } from '../types.js';

const KEY = { tenant_id: 'tnt_a', server_name: 'jira' };

describe('mcp-breaker state machine', () => {
  describe('decide (pre-call)', () => {
    it('closed → allow', () => {
      const snap = emptySnapshot(DEFAULT_POLICY.window_ms);
      const { decision } = decide(KEY, snap, 1_000, DEFAULT_POLICY);
      expect(decision.allow).toBe(true);
      if (decision.allow) {
        expect(decision.state).toBe('closed');
        expect(decision.probe).toBe(false);
      }
    });

    it('open within cooldown → reject with retry_after_ms', () => {
      let snap = apply(emptySnapshot(30_000), 'failure', 0, DEFAULT_POLICY);
      // Trip it.
      for (let i = 0; i < 4; i++) snap = apply(snap, 'failure', 1, DEFAULT_POLICY);
      expect(snap.state).toBe('open');
      const { decision } = decide(KEY, snap, 10_000, DEFAULT_POLICY);
      expect(decision.allow).toBe(false);
      if (!decision.allow) {
        expect(decision.state).toBe('open');
        expect(decision.retry_after_ms).toBeGreaterThan(0);
        expect(decision.retry_after_ms).toBeLessThanOrEqual(30_000);
      }
    });

    it('open after cooldown → transition to half_open + admit probe', () => {
      let snap = apply(emptySnapshot(30_000), 'failure', 0, DEFAULT_POLICY);
      for (let i = 0; i < 4; i++) snap = apply(snap, 'failure', 1, DEFAULT_POLICY);
      // Elapse cooldown.
      const { decision, next } = decide(KEY, snap, 30_001, DEFAULT_POLICY);
      expect(decision.allow).toBe(true);
      if (decision.allow) {
        expect(decision.state).toBe('half_open');
        expect(decision.probe).toBe(true);
      }
      expect(next.state).toBe('half_open');
    });

    it('half_open with probe in flight → reject second caller', () => {
      let snap = apply(emptySnapshot(30_000), 'failure', 0, DEFAULT_POLICY);
      for (let i = 0; i < 4; i++) snap = apply(snap, 'failure', 1, DEFAULT_POLICY);
      const r1 = decide(KEY, snap, 30_001, DEFAULT_POLICY);
      // Second caller sees probe slot taken.
      const r2 = decide(KEY, r1.next, 30_002, DEFAULT_POLICY);
      expect(r1.decision.allow).toBe(true);
      expect(r2.decision.allow).toBe(false);
    });
  });

  describe('apply (post-call)', () => {
    it('trips after 5 consecutive failures (FORA-48 §3.3 default)', () => {
      let snap = emptySnapshot(30_000);
      for (let i = 0; i < 4; i++) {
        snap = apply(snap, 'failure', 1_000 + i, DEFAULT_POLICY);
        expect(snap.state).toBe('closed');
      }
      snap = apply(snap, 'failure', 1_005, DEFAULT_POLICY);
      expect(snap.state).toBe('open');
      expect(snap.consecutive_failures).toBe(5);
    });

    it('success resets the consecutive-failure counter', () => {
      let snap = emptySnapshot(30_000);
      for (let i = 0; i < 4; i++) snap = apply(snap, 'failure', 1_000 + i, DEFAULT_POLICY);
      expect(snap.consecutive_failures).toBe(4);
      snap = apply(snap, 'success', 1_010, DEFAULT_POLICY);
      expect(snap.consecutive_failures).toBe(0);
      expect(snap.state).toBe('closed');
    });

    it('trips when errorRate > 0.5 over sliding window with min_calls=10', () => {
      let snap = emptySnapshot(30_000);
      // 5 successes + 6 failures interleaved → 6/11 > 0.5 → trip.
      for (let i = 0; i < 5; i++) snap = apply(snap, 'success', 1_000 + i * 10, DEFAULT_POLICY);
      for (let i = 0; i < 6; i++) snap = apply(snap, 'failure', 1_050 + i * 10, DEFAULT_POLICY);
      expect(snap.state).toBe('open');
    });

    it('does NOT trip on errorRate when min_calls guard not met', () => {
      let snap = emptySnapshot(30_000);
      // 1 success + 4 failures = 4/5, but min_calls=10 → no rate trip.
      // (The 4 consecutive failures < threshold of 5, so also no consecutive trip.)
      snap = apply(snap, 'success', 1_000, DEFAULT_POLICY);
      for (let i = 0; i < 4; i++) snap = apply(snap, 'failure', 1_010 + i, DEFAULT_POLICY);
      expect(snap.state).toBe('closed');
    });

    it('does NOT trip on old failures outside the sliding window', () => {
      let snap = emptySnapshot(30_000);
      // 4 failures at t=0..3.
      for (let i = 0; i < 4; i++) snap = apply(snap, 'failure', i, DEFAULT_POLICY);
      // Elapse 31s; window prunes the old failures.
      snap = apply(snap, 'failure', 31_000, DEFAULT_POLICY);
      expect(snap.state).toBe('closed');
      expect(snap.consecutive_failures).toBe(1);
    });

    it('half_open + success → closed (and clears samples)', () => {
      let snap = apply(emptySnapshot(30_000), 'failure', 0, DEFAULT_POLICY);
      for (let i = 0; i < 4; i++) snap = apply(snap, 'failure', 1, DEFAULT_POLICY);
      const half = decide(KEY, snap, 30_001, DEFAULT_POLICY);
      snap = half.next;
      const closed = apply(snap, 'success', 30_002, DEFAULT_POLICY);
      expect(closed.state).toBe('closed');
      expect(closed.recent_calls).toEqual([]);
      expect(closed.consecutive_failures).toBe(0);
    });

    it('half_open + failure → open with reset cooldown clock', () => {
      let snap = apply(emptySnapshot(30_000), 'failure', 0, DEFAULT_POLICY);
      for (let i = 0; i < 4; i++) snap = apply(snap, 'failure', 1, DEFAULT_POLICY);
      const half = decide(KEY, snap, 30_001, DEFAULT_POLICY);
      const reopened = apply(half.next, 'failure', 30_002, DEFAULT_POLICY);
      expect(reopened.state).toBe('open');
      expect(reopened.state_since_ms).toBe(30_002);
      // New cooldown clock — must wait again.
      const denied = decide(KEY, reopened, 30_003, DEFAULT_POLICY);
      expect(denied.decision.allow).toBe(false);
    });
  });

  describe('errorRate', () => {
    it('returns 0 when no samples in window', () => {
      expect(errorRate(emptySnapshot(30_000), 1_000)).toBe(0);
    });
    it('counts only samples within window', () => {
      const snap = {
        state: 'closed' as const,
        state_since_ms: 0,
        window_ms: 30_000,
        consecutive_failures: 0,
        recent_calls: [
          { at_ms: 0, outcome: 'failure' as const },
          { at_ms: 1_000, outcome: 'failure' as const },
          { at_ms: 40_000, outcome: 'failure' as const }, // outside window
        ],
      };
      // At t=10_000, window covers 0..10_000 → 2 failures / 2 = 1.0.
      expect(errorRate(snap, 10_000)).toBe(1.0);
      // At t=50_000, window covers 20_000..50_000 → 1 sample / 1 = 1.0.
      expect(errorRate(snap, 50_000)).toBe(1.0);
    });
  });
});