/**
 * Retry policy — §6 of the design doc.
 *
 *   - Backoff: `min(max, base * factor^attempt)`
 *   - With `fullJitter`, the actual sleep is `random(0, min(max, base * factor^attempt))`.
 *   - Retryable: transport, HTTP 5xx, HTTP 429, timeout — surfaced by the
 *     handler as a `RetryableError` or any subclass of it.
 *   - Non-retryable: validation errors, `NotAllowed`, `IdempotencyMissing`.
 *     These are `TypedError` codes the gateway emits, or a non-Retryable throw.
 *   - Cancellation propagates: while waiting between attempts, a cancelled
 *     token aborts the retry immediately and surfaces as `Cancelled`.
 */

import { makeError, type CancelToken, type RunId, type TypedError } from './types.js';

export interface BackoffOpts {
  /** Initial delay in ms. */
  base: number;
  /** Growth factor (>= 1). */
  factor: number;
  /** Hard cap in ms. */
  max: number;
  /** When true, sleep is `random(0, min(max, base * factor^attempt))`. */
  fullJitter: boolean;
  /** Source of randomness (test seam). */
  random?: () => number;
  /** Clock used to compute `now` (test seam). */
  now?: () => number;
}

/** Pure backoff math, no I/O. Returns the sleep duration in ms. */
export function computeBackoff(attempt: number, opts: BackoffOpts): number {
  if (attempt < 0) return 0;
  // `Math.pow` is bounded by `max` below; no overflow risk for sane bases.
  const raw = opts.base * Math.pow(opts.factor, attempt);
  const ceiling = Math.min(opts.max, raw);
  if (!opts.fullJitter) return ceiling;
  const rand = opts.random ? opts.random() : Math.random();
  // Clamp rand to [0, 1) defensively.
  const r = rand < 0 ? 0 : rand >= 1 ? 0.999_999_999 : rand;
  return Math.floor(r * ceiling);
}

export interface RetryOpts {
  /** Maximum number of attempts (>= 1). */
  maxAttempts: number;
  /** Backoff schedule. */
  backoff: BackoffOpts;
  /** Sleep function (test seam). Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Cancel token. The retry loop aborts early if the run is cancelled. */
  cancel: CancelToken;
}

/** Marker class for retryable failures. Handlers throw this to opt into retry. */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly cause: 'transport' | 'http-5xx' | 'http-429' | 'timeout' | 'unknown' = 'unknown',
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** Classify a thrown error or typed error as retryable or terminal. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof RetryableError) return true;
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (code === 'NotAllowed' || code === 'IdempotencyMissing') return false;
  }
  return false;
}

/**
 * Run `fn` with retry. Returns the first non-retryable result. Throws the
 * final retryable error when the attempt budget is exhausted, wrapped as a
 * `TypedError` with code `HandlerThrew`. Throws a `Cancelled` typed error if
 * the cancel token fires during a backoff sleep.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOpts,
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt += 1) {
    if (opts.cancel.isCancelled) {
      throw new CancelledError(opts.cancel.reason ?? 'cancelled');
    }
    try {
      return await fn(attempt);
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      if (!isRetryable(e)) throw e;
      lastErr = e;
      const isLast = attempt === opts.maxAttempts - 1;
      if (isLast) break;
      const delay = computeBackoff(attempt, opts.backoff);
      if (delay > 0) {
        // Race the sleep against the cancel signal so we don't sleep
        // through a cancellation request.
        await raceWithCancel(sleep, delay, opts.cancel);
      }
    }
  }
  // Budget exhausted; surface the last retryable cause.
  const cause = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw makeError({
    code: 'HandlerThrew',
    message: `retry budget exhausted after ${opts.maxAttempts} attempts`,
    handlerId: 'retry',
    runId: '' as RunId,
    cause,
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function raceWithCancel(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  cancel: CancelToken,
): Promise<void> {
  if (cancel.isCancelled) {
    throw new CancelledError(cancel.reason ?? 'cancelled');
  }
  const timer = sleep(ms);
  // The cancel token resolves on cancellation; if it resolves first we
  // unblock the sleep by short-circuiting. We never reject the sleep
  // promise — the timer will resolve on its own.
  if (cancel.whenCancelled) {
    await Promise.race([timer, cancel.whenCancelled]);
    if (cancel.isCancelled) {
      throw new CancelledError(cancel.reason ?? 'cancelled');
    }
  } else {
    await timer;
  }
}

/** Typed error for cancellation. Maps to the `Cancelled` code in `types.ts`. */
export class CancelledError extends Error {
  constructor(public readonly reason: string) {
    super(`cancelled: ${reason}`);
    this.name = 'CancelledError';
  }
}

export function toCancelledTypedError(runId: RunId, reason: string): TypedError {
  return makeError({ code: 'Cancelled', message: `run cancelled: ${reason}`, runId, reason });
}
