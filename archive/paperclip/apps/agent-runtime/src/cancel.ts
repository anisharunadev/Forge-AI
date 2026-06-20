/**
 * Cancellation token — §7 of the design doc.
 *
 *   cancelToken = { isCancelled, whenCancelled: Promise<{ reason }> }
 *
 *   - `runtime.cancel(runId, reason)` is the external entry point. It
 *     marks the run as cancelled and resolves `whenCancelled` with the
 *     reason.
 *   - The stage machine polls `isCancelled` between awaits and surfaces
 *     a `Cancelled` typed error. The retry loop also checks the token
 *     to short-circuit backoff sleeps.
 *
 * The registry is in-process; the design is pluggable so a future
 * distributed control plane (Redis, NATS) can replace the storage.
 */

import type { RunId } from './types.js';

export interface CancelToken {
  /** Synchronous check; cheap. */
  readonly isCancelled: boolean;
  /**
   * Resolves when the run is cancelled. Resolves with the reason string.
   * If the run is already cancelled at the time of access, the
   * `whenCancelled` promise has *already* resolved.
   */
  readonly whenCancelled: Promise<{ reason: string }>;
  /** The reason, if cancelled. */
  readonly reason: string | undefined;
}

interface TokenEntry {
  resolve: (v: { reason: string }) => void;
  promise: Promise<{ reason: string }>;
  reason?: string;
  cancelled: boolean;
}

export interface CancelTokenRegistry {
  /** Get or create the token for `runId`. */
  token(runId: RunId): CancelToken;
  /** External entry point — `runtime.cancel(runId, reason)`. */
  request(runId: RunId, reason: string): void;
  /** True iff a cancel has been requested and acknowledged for this run. */
  isCancelled(runId: RunId): boolean;
  /** Test seam: drop all tokens. */
  reset(): void;
}

export class InMemoryCancelTokenRegistry implements CancelTokenRegistry {
  private readonly tokens = new Map<RunId, TokenEntry>();

  token(runId: RunId): CancelToken {
    let entry = this.tokens.get(runId);
    if (!entry) {
      let resolve!: (v: { reason: string }) => void;
      const promise = new Promise<{ reason: string }>((r) => {
        resolve = r;
      });
      entry = { resolve, promise, cancelled: false };
      this.tokens.set(runId, entry);
    }
    const e = entry;
    return {
      get isCancelled() { return e.cancelled; },
      get whenCancelled() { return e.promise; },
      get reason() { return e.reason; },
    };
  }

  request(runId: RunId, reason: string): void {
    const entry = this.tokens.get(runId) ?? this.ensureEntry(runId);
    if (entry.cancelled) return;
    entry.cancelled = true;
    entry.reason = reason;
    entry.resolve({ reason });
  }

  isCancelled(runId: RunId): boolean {
    return this.tokens.get(runId)?.cancelled === true;
  }

  reset(): void {
    this.tokens.clear();
  }

  private ensureEntry(runId: RunId): TokenEntry {
    let resolve!: (v: { reason: string }) => void;
    const promise = new Promise<{ reason: string }>((r) => {
      resolve = r;
    });
    const entry: TokenEntry = { resolve, promise, cancelled: false };
    this.tokens.set(runId, entry);
    return entry;
  }
}
