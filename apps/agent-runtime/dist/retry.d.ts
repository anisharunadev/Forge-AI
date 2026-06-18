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
import { type CancelToken, type RunId, type TypedError } from './types.js';
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
export declare function computeBackoff(attempt: number, opts: BackoffOpts): number;
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
export declare class RetryableError extends Error {
    readonly cause: 'transport' | 'http-5xx' | 'http-429' | 'timeout' | 'unknown';
    readonly httpStatus?: number | undefined;
    constructor(message: string, cause?: 'transport' | 'http-5xx' | 'http-429' | 'timeout' | 'unknown', httpStatus?: number | undefined);
}
/** Classify a thrown error or typed error as retryable or terminal. */
export declare function isRetryable(e: unknown): boolean;
/**
 * Run `fn` with retry. Returns the first non-retryable result. Throws the
 * final retryable error when the attempt budget is exhausted, wrapped as a
 * `TypedError` with code `HandlerThrew`. Throws a `Cancelled` typed error if
 * the cancel token fires during a backoff sleep.
 */
export declare function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOpts): Promise<T>;
/** Typed error for cancellation. Maps to the `Cancelled` code in `types.ts`. */
export declare class CancelledError extends Error {
    readonly reason: string;
    constructor(reason: string);
}
export declare function toCancelledTypedError(runId: RunId, reason: string): TypedError;
