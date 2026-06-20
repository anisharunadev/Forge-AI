/**
 * Unit tests for the retry policy (FORA-145 §6).
 *
 *   - backoff math (no-jitter + full-jitter)
 *   - isRetryable classification
 *   - withRetry exhaustion + cancellable backoff
 */

import { describe, it, expect } from 'vitest';

import {
  CancelledError,
  computeBackoff,
  isRetryable,
  RetryableError,
  withRetry,
  type BackoffOpts,
  type CancelToken,
} from '../src/retry.js';

const FIXED_BACKOFF: BackoffOpts = {
  base: 100,
  factor: 2,
  max: 30_000,
  fullJitter: false,
};

describe('retry: backoff math', () => {
  it('exponentially grows by `factor^attempt` capped at `max`', () => {
    // attempt 0 -> 100 * 1 = 100
    // attempt 1 -> 100 * 2 = 200
    // attempt 2 -> 100 * 4 = 400
    // attempt 3 -> 100 * 8 = 800
    // ...
    // attempt 9 -> 100 * 512 = 51_200 -> capped to 30_000
    expect(computeBackoff(0, FIXED_BACKOFF)).toBe(100);
    expect(computeBackoff(1, FIXED_BACKOFF)).toBe(200);
    expect(computeBackoff(2, FIXED_BACKOFF)).toBe(400);
    expect(computeBackoff(3, FIXED_BACKOFF)).toBe(800);
    expect(computeBackoff(9, FIXED_BACKOFF)).toBe(30_000);
    expect(computeBackoff(20, FIXED_BACKOFF)).toBe(30_000);
  });

  it('with fullJitter returns a value in [0, min(max, base*factor^attempt))', () => {
    const opts: BackoffOpts = { ...FIXED_BACKOFF, fullJitter: true, random: () => 0 };
    expect(computeBackoff(0, opts)).toBe(0);
    expect(computeBackoff(2, opts)).toBe(0);

    const almostOne: BackoffOpts = { ...FIXED_BACKOFF, fullJitter: true, random: () => 0.999 };
    // attempt 2 -> ceiling 400; jitter -> floor(0.999 * 400) = 399
    expect(computeBackoff(2, almostOne)).toBe(399);
    // attempt 9 -> ceiling 30_000; jitter -> floor(0.999 * 30_000) = 29_970
    expect(computeBackoff(9, almostOne)).toBe(29_970);
  });

  it('clamps random values outside [0,1) defensively', () => {
    const opts: BackoffOpts = { ...FIXED_BACKOFF, fullJitter: true, random: () => -0.5 };
    expect(computeBackoff(0, opts)).toBe(0);
    const overshoot: BackoffOpts = { ...FIXED_BACKOFF, fullJitter: true, random: () => 5 };
    // Clamped to 0.999_999_999 * 100 = 99
    expect(computeBackoff(0, overshoot)).toBe(99);
  });

  it('returns 0 for negative attempt values', () => {
    expect(computeBackoff(-1, FIXED_BACKOFF)).toBe(0);
  });
});

describe('retry: isRetryable', () => {
  it('returns true for RetryableError', () => {
    expect(isRetryable(new RetryableError('timeout', 'timeout'))).toBe(true);
  });

  it('returns true for any subclass of RetryableError', () => {
    class Http5xxError extends RetryableError {
      constructor(msg: string) { super(msg, 'http-5xx', 503); }
    }
    expect(isRetryable(new Http5xxError('boom'))).toBe(true);
  });

  it('returns false for `NotAllowed` and `IdempotencyMissing` typed errors', () => {
    expect(isRetryable({ code: 'NotAllowed', message: '' })).toBe(false);
    expect(isRetryable({ code: 'IdempotencyMissing', message: '' })).toBe(false);
  });

  it('returns false for plain errors (non-retryable by default)', () => {
    expect(isRetryable(new Error('validation failed'))).toBe(false);
  });
});

describe('retry: withRetry', () => {
  function neverCancelled(): CancelToken {
    return {
      isCancelled: false,
      whenCancelled: new Promise<{ reason: string }>(() => { /* never */ }),
      reason: undefined,
    };
  }

  it('returns the first non-retryable result without retrying', async () => {
    let calls = 0;
    const out = await withRetry(async () => {
      calls += 1;
      return 'ok';
    }, { maxAttempts: 5, backoff: FIXED_BACKOFF, cancel: neverCancelled() });
    expect(out).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on RetryableError and eventually returns success', async () => {
    let calls = 0;
    const out = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new RetryableError('flap', 'transport');
      return 'finally';
    }, {
      maxAttempts: 5,
      backoff: { ...FIXED_BACKOFF, base: 1, max: 1, fullJitter: false },
      cancel: neverCancelled(),
    });
    expect(out).toBe('finally');
    expect(calls).toBe(3);
  });

  it('throws after maxAttempts retryable errors', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new RetryableError('always', 'transport');
        },
        {
          maxAttempts: 3,
          backoff: { ...FIXED_BACKOFF, base: 5, max: 5, fullJitter: false },
          cancel: neverCancelled(),
          sleep: async (ms) => { sleeps.push(ms); },
        },
      ),
    ).rejects.toThrow(/retry budget exhausted/i);
    expect(calls).toBe(3);
    // Two sleeps between three attempts.
    expect(sleeps).toEqual([5, 5]);
  });

  it('does not retry on a non-retryable error and rethrows immediately', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('validation');
        },
        { maxAttempts: 5, backoff: FIXED_BACKOFF, cancel: neverCancelled() },
      ),
    ).rejects.toThrow('validation');
    expect(calls).toBe(1);
  });

  it('aborts backoff sleep when the cancel token fires', async () => {
    let resolveCancel!: (v: { reason: string }) => void;
    const whenCancelled = new Promise<{ reason: string }>((r) => { resolveCancel = r; });
    let isCancelled = false;
    const cancelToken: CancelToken = {
      get isCancelled() { return isCancelled; },
      whenCancelled,
      get reason() { return isCancelled ? 'op cancel' : undefined; },
    };

    // Trigger cancellation after a short tick.
    setTimeout(() => {
      isCancelled = true;
      resolveCancel({ reason: 'op cancel' });
    }, 5);

    let calls = 0;
    const sleeps: number[] = [];
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new RetryableError('flap', 'transport');
        },
        {
          maxAttempts: 5,
          // Short sleep so the test is fast; the cancel still fires
          // before the sleep timer resolves.
          backoff: { ...FIXED_BACKOFF, base: 50, max: 50, fullJitter: false },
          sleep: async (ms) => {
            sleeps.push(ms);
            // Real wait so the cancel has time to fire.
            await new Promise<void>((r) => setTimeout(r, ms));
          },
          cancel: cancelToken,
        },
      ),
    ).rejects.toBeInstanceOf(CancelledError);
    // The retry loop aborted on the first sleep; the second attempt
    // never ran.
    expect(sleeps.length).toBe(1);
    expect(calls).toBe(1);
  });
});
