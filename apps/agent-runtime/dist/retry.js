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
import { makeError } from './types.js';
/** Pure backoff math, no I/O. Returns the sleep duration in ms. */
export function computeBackoff(attempt, opts) {
    if (attempt < 0)
        return 0;
    // `Math.pow` is bounded by `max` below; no overflow risk for sane bases.
    const raw = opts.base * Math.pow(opts.factor, attempt);
    const ceiling = Math.min(opts.max, raw);
    if (!opts.fullJitter)
        return ceiling;
    const rand = opts.random ? opts.random() : Math.random();
    // Clamp rand to [0, 1) defensively.
    const r = rand < 0 ? 0 : rand >= 1 ? 0.999_999_999 : rand;
    return Math.floor(r * ceiling);
}
/** Marker class for retryable failures. Handlers throw this to opt into retry. */
export class RetryableError extends Error {
    cause;
    httpStatus;
    constructor(message, cause = 'unknown', httpStatus) {
        super(message);
        this.cause = cause;
        this.httpStatus = httpStatus;
        this.name = 'RetryableError';
    }
}
/** Classify a thrown error or typed error as retryable or terminal. */
export function isRetryable(e) {
    if (e instanceof RetryableError)
        return true;
    if (e && typeof e === 'object') {
        const code = e.code;
        if (code === 'NotAllowed' || code === 'IdempotencyMissing')
            return false;
    }
    return false;
}
/**
 * Run `fn` with retry. Returns the first non-retryable result. Throws the
 * final retryable error when the attempt budget is exhausted, wrapped as a
 * `TypedError` with code `HandlerThrew`. Throws a `Cancelled` typed error if
 * the cancel token fires during a backoff sleep.
 */
export async function withRetry(fn, opts) {
    const sleep = opts.sleep ?? defaultSleep;
    let lastErr;
    for (let attempt = 0; attempt < opts.maxAttempts; attempt += 1) {
        if (opts.cancel.isCancelled) {
            throw new CancelledError(opts.cancel.reason ?? 'cancelled');
        }
        try {
            return await fn(attempt);
        }
        catch (e) {
            if (e instanceof CancelledError)
                throw e;
            if (!isRetryable(e))
                throw e;
            lastErr = e;
            const isLast = attempt === opts.maxAttempts - 1;
            if (isLast)
                break;
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
        runId: '',
        cause,
    });
}
function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function raceWithCancel(sleep, ms, cancel) {
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
    }
    else {
        await timer;
    }
}
/** Typed error for cancellation. Maps to the `Cancelled` code in `types.ts`. */
export class CancelledError extends Error {
    reason;
    constructor(reason) {
        super(`cancelled: ${reason}`);
        this.reason = reason;
        this.name = 'CancelledError';
    }
}
export function toCancelledTypedError(runId, reason) {
    return makeError({ code: 'Cancelled', message: `run cancelled: ${reason}`, runId, reason });
}
//# sourceMappingURL=retry.js.map