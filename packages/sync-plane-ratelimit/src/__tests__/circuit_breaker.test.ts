/**
 * CircuitBreaker — pure state-machine tests.
 * Reuses the breaker test bar from aws-dispatch.test.ts (FORA-126.5
 * AC #4) and extends with the Sync Plane's per-platform keying
 * (FORA-256 AC #2: trips on synthetic 5xx burst; recovers in
 * half-open after 5 min).
 */

import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../circuit_breaker.js';

describe('CircuitBreaker', () => {
  it('opens after threshold consecutive failures within window', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failure_threshold: 5, failure_window_ms: 60_000, cooldown_ms: 300_000, now: () => t });
    expect(cb.state).toBe('closed');
    for (let i = 0; i < 4; i++) {
      cb.onFailure();
      expect(cb.state).toBe('closed');
    }
    cb.onFailure();
    expect(cb.state).toBe('open');
    expect(cb.canPass()).toBe(false);
  });

  it('does NOT open when failures fall outside the sliding window', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failure_threshold: 5, failure_window_ms: 60_000, cooldown_ms: 300_000, now: () => t });
    // 4 failures at t=0, then wait 61s, then 4 more.
    for (let i = 0; i < 4; i++) cb.onFailure();
    t += 61_000;
    for (let i = 0; i < 4; i++) cb.onFailure();
    expect(cb.state).toBe('closed');
  });

  it('half-opens after cooldown and admits exactly one probe', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failure_threshold: 3, failure_window_ms: 60_000, cooldown_ms: 1000, now: () => t });
    for (let i = 0; i < 3; i++) cb.onFailure();
    expect(cb.state).toBe('open');
    expect(cb.canPass()).toBe(false);
    t += 1001;
    // First caller wins the probe.
    expect(cb.canPass()).toBe(true);
    // Second caller blocked until probe resolves.
    expect(cb.canPass()).toBe(false);
    // Probe success → closed; failures cleared.
    cb.onSuccess();
    expect(cb.state).toBe('closed');
  });

  it('re-opens on probe failure and resets the cooldown clock (v0.3 exp backoff applies)', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failure_threshold: 3, failure_window_ms: 60_000, cooldown_ms: 1000, now: () => t });
    for (let i = 0; i < 3; i++) cb.onFailure();
    t += 1001;
    expect(cb.canPass()).toBe(true);
    cb.onFailure();
    expect(cb.state).toBe('open');
    // v0.3 exp backoff: first half-open failure doubles the cooldown
    // from 1000ms to 2000ms (factor[0]=2). must wait again, and for
    // the full doubled window before the next probe is admitted.
    expect(cb.currentCooldown()).toBe(2000);
    expect(cb.canPass()).toBe(false);
    t += 1500;
    expect(cb.canPass()).toBe(false); // still inside the 2s cooldown
    t += 600;
    expect(cb.canPass()).toBe(true); // 2.1s elapsed since opened_at_ms
  });

  it('emits a transition record on state change', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failure_threshold: 2, failure_window_ms: 60_000, cooldown_ms: 100, now: () => t });
    cb.onFailure();
    cb.onFailure();
    // open -> half_open happens in canPass() once the cooldown elapses.
    t += 101;
    expect(cb.canPass()).toBe(true);
    cb.onSuccess(); // half_open -> closed
    const transitions = cb.recentTransitions();
    const kinds = transitions.map((tr) => `${tr.from}->${tr.to}`);
    expect(kinds).toContain('closed->open');
    expect(kinds).toContain('open->half_open');
    expect(kinds).toContain('half_open->closed');
  });
});
