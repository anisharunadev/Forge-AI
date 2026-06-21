/**
 * @fora/mcp-transport — retry policy unit tests
 *
 * Pure logic — no child processes. Verifies the backoff schedule, the
 * retry/no-retry classification, and the `runWithRetry` loop semantics
 * per FORA-48 §3.4.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  classifyError,
  computeBackoffMs,
  isMutationTool,
  isRetryable,
  isStreamingTool,
  readIdempotencyKey,
  runWithRetry,
} from '../retry.js';
import { TransportError } from '../types.js';

describe('computeBackoffMs', () => {
  it('returns 0 for the first attempt (no delay before the initial call)', () => {
    expect(
      computeBackoffMs(0, { backoffMinMs: 50, backoffMaxMs: 2_000, backoffFactor: 4 }),
    ).toBe(0);
  });

  it('matches the FORA-48 §3.4 schedule: 50, 200, 800, 2000 (capped)', () => {
    const opts = { backoffMinMs: 50, backoffMaxMs: 2_000, backoffFactor: 4 };
    expect(computeBackoffMs(1, opts)).toBe(50);
    expect(computeBackoffMs(2, opts)).toBe(200);
    expect(computeBackoffMs(3, opts)).toBe(800);
    expect(computeBackoffMs(4, opts)).toBe(2_000); // 3200 capped at 2000
    expect(computeBackoffMs(5, opts)).toBe(2_000); // 12800 capped
  });
});

describe('isRetryable', () => {
  it('returns false for non-retryable TransportError', () => {
    const err = new TransportError('protocol_error', 'bad', { retryable: false, server: 'jira' as never });
    expect(isRetryable(err, { isMutation: false, hasIdempotencyKey: false })).toBe(false);
  });

  it('returns true for retryable TransportError on a read', () => {
    const err = new TransportError('spawn_failed', 'flaky', { retryable: true, server: 'jira' as never });
    expect(isRetryable(err, { isMutation: false, hasIdempotencyKey: false })).toBe(true);
  });

  it('refuses to retry a mutation without an idempotency key', () => {
    const err = new TransportError('child_died', 'died', { retryable: true, server: 'jira' as never });
    expect(isRetryable(err, { isMutation: true, hasIdempotencyKey: false })).toBe(false);
  });

  it('retries a mutation when the caller supplied an idempotency key', () => {
    const err = new TransportError('child_died', 'died', { retryable: true, server: 'jira' as never });
    expect(isRetryable(err, { isMutation: true, hasIdempotencyKey: true })).toBe(true);
  });

  it('returns false for plain JS errors (no retryable signal)', () => {
    expect(isRetryable(new Error('boom'), { isMutation: false, hasIdempotencyKey: false })).toBe(false);
  });
});

describe('runWithRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const result = await runWithRetry(op, {
      maxAttempts: 3,
      backoffMinMs: 1,
      backoffMaxMs: 1,
      backoffFactor: 1,
    });
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable TransportError up to maxAttempts', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new TransportError('spawn_failed', 'x', { retryable: true, server: 's' as never }))
      .mockRejectedValueOnce(new TransportError('spawn_failed', 'x', { retryable: true, server: 's' as never }))
      .mockResolvedValueOnce('ok');
    const sleeper = vi.fn().mockResolvedValue(undefined);
    const result = await runWithRetry(op, {
      maxAttempts: 3,
      backoffMinMs: 1,
      backoffMaxMs: 1,
      backoffFactor: 1,
      sleeper,
    });
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
    // Sleeper is consulted between attempts but skipped for the final try.
    expect(sleeper).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error (no retry)', async () => {
    const op = vi
      .fn()
      .mockRejectedValue(new TransportError('protocol_error', 'bad', { retryable: false, server: 's' as never }));
    await expect(
      runWithRetry(op, {
        maxAttempts: 5,
        backoffMinMs: 1,
        backoffMaxMs: 1,
        backoffFactor: 1,
      }),
    ).rejects.toMatchObject({ kind: 'protocol_error' });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('throws the last error after exhausting attempts', async () => {
    const op = vi
      .fn()
      .mockRejectedValue(new TransportError('invoke_timeout', 'slow', { retryable: true, server: 's' as never }));
    await expect(
      runWithRetry(op, {
        maxAttempts: 2,
        backoffMinMs: 1,
        backoffMaxMs: 1,
        backoffFactor: 1,
      }),
    ).rejects.toMatchObject({ kind: 'invoke_timeout' });
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('invokes onRetry hook with attempt + delay + error', async () => {
    const onRetry = vi.fn();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new TransportError('child_died', 'died', { retryable: true, server: 's' as never }))
      .mockResolvedValueOnce('ok');
    await runWithRetry(op, {
      maxAttempts: 2,
      backoffMinMs: 50,
      backoffMaxMs: 50,
      backoffFactor: 4,
      onRetry,
      sleeper: async () => undefined,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delay_ms: 50,
      error: expect.objectContaining({ kind: 'child_died' }),
    });
  });
});

describe('classifyError', () => {
  it('passes TransportError through unchanged', () => {
    const e = new TransportError('tool_returned_error', 'x', { retryable: false, server: 's' as never });
    expect(classifyError(e, { server: 's' as never })).toBe(e);
  });

  it('classifies timeout-shaped messages as invoke_timeout (retryable)', () => {
    const e = classifyError(new Error('Request timed out after 30000ms'), { server: 's' as never });
    expect(e.kind).toBe('invoke_timeout');
    expect(e.retryable).toBe(true);
  });

  it('classifies spawn-shaped errors (ENOENT) as spawn_failed (retryable)', () => {
    const e = classifyError(new Error("spawn ENOENT bin/fora-mcp-x.mjs"), { server: 's' as never });
    expect(e.kind).toBe('spawn_failed');
    expect(e.retryable).toBe(true);
  });

  it('classifies child-died (EPIPE) as retryable', () => {
    const e = classifyError(new Error('write EPIPE'), { server: 's' as never });
    expect(e.kind).toBe('child_died');
    expect(e.retryable).toBe(true);
  });

  it('classifies parse/protocol errors as non-retryable', () => {
    // The classifier regex matches lowercase keywords (`json`/`parse`/
    // `protocol`); the SDK surfaces lower-cased parse errors so this is
    // the realistic case.
    const e = classifyError(new Error('unexpected token in json'), { server: 's' as never });
    expect(e.kind).toBe('protocol_error');
    expect(e.retryable).toBe(false);
  });

  it('falls back to unknown (non-retryable) for unrecognized shapes', () => {
    const e = classifyError(new Error('something else'), { server: 's' as never });
    expect(e.kind).toBe('unknown');
    expect(e.retryable).toBe(false);
  });
});

describe('readIdempotencyKey', () => {
  it('reads snake_case and camelCase keys', () => {
    expect(readIdempotencyKey({ idempotency_key: 'a' })).toBe('a');
    expect(readIdempotencyKey({ idempotencyKey: 'b' })).toBe('b');
  });

  it('returns undefined for missing, empty, or non-string keys', () => {
    expect(readIdempotencyKey({})).toBeUndefined();
    expect(readIdempotencyKey({ idempotency_key: '' })).toBeUndefined();
    expect(readIdempotencyKey({ idempotency_key: 42 })).toBeUndefined();
    expect(readIdempotencyKey(null)).toBeUndefined();
    expect(readIdempotencyKey('not-an-object')).toBeUndefined();
    expect(readIdempotencyKey(['array'])).toBeUndefined();
  });
});

describe('isMutationTool / isStreamingTool', () => {
  it('flags mutation / write tags', () => {
    expect(isMutationTool(['mutation'])).toBe(true);
    expect(isMutationTool(['write'])).toBe(true);
    expect(isMutationTool(['read'])).toBe(false);
    expect(isMutationTool(undefined)).toBe(false);
  });

  it('flags stream / streaming tags', () => {
    expect(isStreamingTool(['stream'])).toBe(true);
    expect(isStreamingTool(['streaming'])).toBe(true);
    expect(isStreamingTool(['mutation'])).toBe(false);
    expect(isStreamingTool(undefined)).toBe(false);
  });
});
