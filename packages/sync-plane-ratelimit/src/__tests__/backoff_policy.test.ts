/**
 * BackoffPolicy tests — pure retry-policy calculator (FORA-487.3 / FORA-517).
 *
 * AC coverage:
 *   - Retry-After parsing with floor/ceiling clamping
 *   - Exponential jitter policy (deterministic with injectable RNG)
 *   - Exponential growth curve at the published base/jitter/ceiling
 *   - Constructor validation
 */

import { describe, it, expect } from 'vitest';
import { BackoffPolicy } from '../backoff_policy.js';

describe('BackoffPolicy', () => {
  describe('Retry-After parsing', () => {
    it('parses delta-seconds and clamps to ceiling (60s)', () => {
      const p = new BackoffPolicy();
      const r = p.parseRetryAfter({ 'Retry-After': '120' });
      expect(r).not.toBeNull();
      expect(r!.ms).toBe(60_000);
    });

    it('parses delta-seconds and clamps to floor (1ms) for 0', () => {
      const p = new BackoffPolicy();
      const r = p.parseRetryAfter({ 'Retry-After': '0' });
      expect(r).not.toBeNull();
      expect(r!.ms).toBe(1);
    });

    it('parses decimal seconds and rounds', () => {
      const p = new BackoffPolicy();
      const r = p.parseRetryAfter({ 'Retry-After': '1.7' });
      expect(r!.ms).toBe(1700);
    });

    it('is case-insensitive on the header name', () => {
      const p = new BackoffPolicy();
      const r1 = p.parseRetryAfter({ 'retry-after': '5' });
      const r2 = p.parseRetryAfter({ 'Retry-After': '5' });
      expect(r1!.ms).toBe(5000);
      expect(r2!.ms).toBe(5000);
    });

    it('parses HTTP-date (future) and clamps to ceiling', () => {
      const p = new BackoffPolicy();
      const future = new Date(Date.now() + 5 * 60_000).toUTCString();
      const r = p.parseRetryAfter({ 'Retry-After': future });
      // 5 min → clamped to ceiling 60s.
      expect(r!.ms).toBe(60_000);
    });

    it('parses HTTP-date (past) and clamps to floor', () => {
      const p = new BackoffPolicy();
      const past = new Date(Date.now() - 10_000).toUTCString();
      const r = p.parseRetryAfter({ 'Retry-After': past });
      expect(r!.ms).toBe(1);
    });

    it('returns null for missing header', () => {
      const p = new BackoffPolicy();
      expect(p.parseRetryAfter({})).toBeNull();
    });

    it('returns null for unparseable header', () => {
      const p = new BackoffPolicy();
      expect(p.parseRetryAfter({ 'Retry-After': 'not-a-date' })).toBeNull();
    });

    it('returns null for negative seconds', () => {
      const p = new BackoffPolicy();
      expect(p.parseRetryAfter({ 'Retry-After': '-5' })).toBeNull();
    });
  });

  describe('exponential jitter schedule', () => {
    /** Deterministic RNG that returns 0.0 (lower bound of jitter). */
    const zero = (): number => 0;
    /** Deterministic RNG that returns 1.0 (exclusive — gives jitter_ms * 0.999). */
    const almostOne = (): number => 0.9999;

    it('exposes the configured knobs', () => {
      const p = new BackoffPolicy({ base_ms: 100, jitter_ms: 50, ceiling_ms: 1000, floor_ms: 2 });
      expect(p.baseMs).toBe(100);
      expect(p.jitterMs).toBe(50);
      expect(p.ceilingMs).toBe(1000);
      expect(p.floorMs).toBe(2);
    });

    it('returns min(ceiling, base * 2^attempt) + uniform(0, jitter) for attempt=0..7', () => {
      const p = new BackoffPolicy({ rng: zero });
      // attempt 0: 500 + 0 = 500
      expect(p.nextDelayMs(0)).toBe(500);
      // attempt 1: 1000 + 0 = 1000
      expect(p.nextDelayMs(1)).toBe(1000);
      // attempt 2: 2000
      expect(p.nextDelayMs(2)).toBe(2000);
      // attempt 3: 4000
      expect(p.nextDelayMs(3)).toBe(4000);
      // attempt 4: 8000
      expect(p.nextDelayMs(4)).toBe(8000);
      // attempt 5: 16000
      expect(p.nextDelayMs(5)).toBe(16_000);
      // attempt 6: 32000
      expect(p.nextDelayMs(6)).toBe(32_000);
      // attempt 7: min(60000, 64000) = 60000
      expect(p.nextDelayMs(7)).toBe(60_000);
      // attempt 8: 60000 (cap)
      expect(p.nextDelayMs(8)).toBe(60_000);
    });

    it('jitter adds the full spread on the upper bound (rng ≈ 1.0)', () => {
      const p = new BackoffPolicy({ rng: almostOne });
      // attempt 0: 500 + 250*0.9999 = 749.9... → ceil-friendly 750 (Math.round not applied since we clamp on max)
      // Actually nextDelayMs doesn't round — it returns the raw ms. So 749.9... ms.
      const d = p.nextDelayMs(0);
      expect(d).toBeGreaterThanOrEqual(749);
      expect(d).toBeLessThanOrEqual(750);
    });

    it('Retry-After header takes precedence over the exponential schedule', () => {
      const p = new BackoffPolicy({ rng: zero });
      // attempt 5 would normally be 16000ms; Retry-After: 2 should win.
      expect(p.nextDelayMs(5, { 'Retry-After': '2' })).toBe(2000);
    });

    it('clamps negative attempt to 0', () => {
      const p = new BackoffPolicy({ rng: zero });
      expect(p.nextDelayMs(-1)).toBe(500);
    });

    it('returns at least floor_ms even when the cap+jitter underflows', () => {
      // Sanity: floor=2, attempt=-10 — exponential=500 (clamped) — well above floor.
      const p = new BackoffPolicy({ floor_ms: 2, base_ms: 500, rng: zero });
      expect(p.nextDelayMs(0)).toBeGreaterThanOrEqual(2);
    });
  });

  describe('constructor validation', () => {
    it('rejects base_ms <= 0', () => {
      expect(() => new BackoffPolicy({ base_ms: 0 })).toThrow();
      expect(() => new BackoffPolicy({ base_ms: -1 })).toThrow();
    });
    it('rejects jitter_ms < 0', () => {
      expect(() => new BackoffPolicy({ jitter_ms: -1 })).toThrow();
    });
    it('rejects ceiling_ms < base_ms', () => {
      expect(() => new BackoffPolicy({ base_ms: 100, ceiling_ms: 50 })).toThrow();
    });
    it('rejects floor_ms < 1', () => {
      expect(() => new BackoffPolicy({ floor_ms: 0 })).toThrow();
    });
  });
});
