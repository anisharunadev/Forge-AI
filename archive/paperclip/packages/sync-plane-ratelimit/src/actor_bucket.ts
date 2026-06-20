/**
 * ActorBucket — per-actor burst control (Layer 4 in the FORA-487
 * orchestrator order; "per-actor burst control" in the charter).
 *
 * Token bucket per `(actor_id, connector_id)`: size=10, refill=5/sec
 * by default. Catches accidental loops (a runaway agent submitting
 * 100 comments per second) before they hit the per-tenant or
 * provider ceilings.
 *
 * Audit emission is `connector.rate_limit.consumed` on allow and
 * `connector.rate_limit.throttled` with `layer: 'actor'` on deny.
 *
 * FORA-487 §"Per-actor burst control".
 * FORA-391 Plan 5 §3.4.
 */

import { TokenBucket } from './token_bucket.js';
import type { ConnectorId } from './provider_ceiling.js';

export interface ActorBucketOpts {
  /** Burst size. Default 10. */
  readonly capacity?: number;
  /** Refill rate per second. Default 5. */
  readonly refill_per_sec?: number;
  /** `now()` injection for tests. */
  readonly now?: () => number;
}

export class ActorBucket {
  private readonly bucket: TokenBucket;
  private readonly capacity: number;
  private readonly refill_per_sec: number;

  constructor(opts: ActorBucketOpts = {}) {
    this.capacity = opts.capacity ?? 10;
    this.refill_per_sec = opts.refill_per_sec ?? 5;
    this.bucket = new TokenBucket({
      capacity: this.capacity,
      refill_per_sec: this.refill_per_sec,
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
  }

  /** Take one token. `false` = throttle. */
  take(): boolean {
    return this.bucket.take();
  }

  /** Read-only accessor for diagnostics / UI. */
  get maxCapacity(): number {
    return this.capacity;
  }

  /** Read-only accessor for diagnostics / UI. */
  get refillRatePerSec(): number {
    return this.refill_per_sec;
  }
}

export class ActorBucketRegistry {
  private readonly buckets = new Map<string, ActorBucket>();
  private readonly opts: ActorBucketOpts;

  constructor(opts: ActorBucketOpts = {}) {
    this.opts = opts;
  }

  /**
   * Take a token from the actor's bucket. The actor must be present
   * on the edit; the caller (orchestrator) supplies the actor_id
   * from the inbound event.
   */
  take(actor_id: string, connector: ConnectorId): boolean {
    const b = this.bucketFor(actor_id, connector);
    return b.take();
  }

  /** Read-only diagnostics for the actor's bucket (current level, capacity). */
  inspect(actor_id: string, connector: ConnectorId): { capacity: number; refill_per_sec: number } {
    const b = this.bucketFor(actor_id, connector);
    return { capacity: b.maxCapacity, refill_per_sec: b.refillRatePerSec };
  }

  private bucketFor(actor_id: string, connector: ConnectorId): ActorBucket {
    const key = `${actor_id}|${connector}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = new ActorBucket(this.opts);
      this.buckets.set(key, b);
    }
    return b;
  }
}
