/**
 * @fora/mcp-transport — retry policy
 *
 * Exponential-backoff retry per FORA-48 §3.4. Capped at `maxAttempts` (default
 * 3 — 1 initial + 2 retries). Backoff schedule starts at `backoffMinMs` (50)
 * and grows by `backoffFactor` (4) until it hits `backoffMaxMs` (2 000):
 *
 *   attempt 1: 0 ms (immediate)
 *   attempt 2: 50 ms
 *   attempt 3: 200 ms
 *   attempt 4+: 800 / 2000 (capped)
 *
 * The retry budget is consumed by *transient* failures only — spawn failures,
 * child died mid-call, invoke timeouts. Non-retryable errors (protocol
 * violations, tool-returned `isError: true`) bubble immediately. Mutations
 * without an idempotency key are also non-retryable — we cannot safely
 * re-issue a write that may have succeeded on the first try.
 */

import { TransportError, type TransportErrorKind } from './types.js';
import type { ToolName, ServerName } from '@fora/mcp-router';

export interface RetryPolicyOptions {
  readonly maxAttempts: number;
  readonly backoffMinMs: number;
  readonly backoffMaxMs: number;
  readonly backoffFactor: number;
  /** Returns ms since epoch. Defaults to `Date.now`. */
  readonly clock?: () => number;
  /** Async sleep — defaults to `setTimeout`-based sleep. */
  readonly sleeper?: (ms: number) => Promise<void>;
  /** Hook for tests — fired when a retry is about to happen. */
  readonly onRetry?: (info: {
    attempt: number;
    delay_ms: number;
    error: TransportError;
  }) => void;
}

/**
 * Compute the delay (ms) before the next attempt. Attempt 0 = initial call
 * (no delay). Subsequent attempts apply backoff.
 */
export function computeBackoffMs(
  attempt: number,
  opts: { backoffMinMs: number; backoffMaxMs: number; backoffFactor: number },
): number {
  if (attempt <= 0) return 0;
  const raw = opts.backoffMinMs * Math.pow(opts.backoffFactor, attempt - 1);
  return Math.min(opts.backoffMaxMs, Math.round(raw));
}

/**
 * Decide whether `err` is retryable. Plain JS errors with `retryable=false`
 * (e.g. `TypeError`) are not; `TransportError` carries its own classification.
 *
 * Mutation tools without an `idempotency_key` are NOT retried — re-issuing a
 * write that may have partially succeeded is unsafe. The caller is expected
 * to pass the key explicitly via `args.idempotency_key` for retried calls.
 */
export function isRetryable(
  err: unknown,
  ctx: { toolName?: ToolName; isMutation: boolean; hasIdempotencyKey: boolean },
): boolean {
  if (err instanceof TransportError) {
    if (!err.retryable) return false;
    // Mutations without idempotency are never retried.
    if (ctx.isMutation && !ctx.hasIdempotencyKey) return false;
    return true;
  }
  // Unknown errors — default to non-retryable; surface as upstream_error.
  return false;
}

/**
 * Retry-aware execution of an async operation.
 *
 * `op` is called per attempt; on retryable failure, sleeps `computeBackoffMs`
 * and tries again up to `maxAttempts` total invocations.
 */
export async function runWithRetry<T>(
  op: (attempt: number) => Promise<T>,
  policy: RetryPolicyOptions,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await op(attempt);
    } catch (err: unknown) {
      lastErr = err;
      if (attempt >= policy.maxAttempts) break;
      if (!(err instanceof TransportError) || !err.retryable) break;
      const delay = computeBackoffMs(attempt, policy);
      if (policy.onRetry) {
        policy.onRetry({ attempt, delay_ms: delay, error: err });
      }
      if (delay > 0 && policy.sleeper) {
        await policy.sleeper(delay);
      }
    }
  }
  throw lastErr;
}

/**
 * Classify a raw transport / stdio error into a typed `TransportErrorKind`.
 * Pulled out so tests can exercise the heuristics directly.
 */
export function classifyError(
  err: unknown,
  ctx: { server: ServerName; tool?: ToolName },
): TransportError {
  if (err instanceof TransportError) return err;

  const message = err instanceof Error ? err.message : String(err);

  if (/timed?\s*out|ETIMEDOUT|AbortError/.test(message)) {
    return new TransportError('invoke_timeout', message, {
      retryable: true,
      server: ctx.server,
      ...(ctx.tool ? { tool: ctx.tool } : {}),
      cause: err,
    });
  }

  if (/spawn|ENOENT|EACCES/.test(message)) {
    return new TransportError('spawn_failed', message, {
      retryable: true,
      server: ctx.server,
      ...(ctx.tool ? { tool: ctx.tool } : {}),
      cause: err,
    });
  }

  if (/ECONNRESET|EPIPE|child process exited|process exited/.test(message)) {
    return new TransportError('child_died', message, {
      retryable: true,
      server: ctx.server,
      ...(ctx.tool ? { tool: ctx.tool } : {}),
      cause: err,
    });
  }

  if (/protocol|json|parse/.test(message)) {
    return new TransportError('protocol_error', message, {
      retryable: false,
      server: ctx.server,
      ...(ctx.tool ? { tool: ctx.tool } : {}),
      cause: err,
    });
  }

  return new TransportError('unknown', message, {
    retryable: false,
    server: ctx.server,
    ...(ctx.tool ? { tool: ctx.tool } : {}),
    cause: err,
  });
}

/** Extract the idempotency key from an args map, if present. */
export function readIdempotencyKey(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const rec = args as Record<string, unknown>;
  const k = rec['idempotency_key'] ?? rec['idempotencyKey'];
  if (typeof k === 'string' && k.length > 0) return k;
  return undefined;
}

/** True when the tool descriptor tags the call as a mutation. */
export function isMutationTool(tags: readonly string[] | undefined): boolean {
  if (!tags) return false;
  return tags.includes('mutation') || tags.includes('write');
}

/** True when the tool descriptor opts into streaming responses. */
export function isStreamingTool(tags: readonly string[] | undefined): boolean {
  if (!tags) return false;
  return tags.includes('stream') || tags.includes('streaming');
}