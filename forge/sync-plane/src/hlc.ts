/**
 * Hybrid Logical Clock (HLC) — ADR-0010 §3.2 + §4 Tier-2.
 *
 * An HLC is a `(physical_ms, counter, node_id)` triple that combines wall-clock
 * time with a monotonically advancing counter so that we can reason about
 * happens-before ordering across nodes that may disagree on physical time.
 * The implementation follows the Spanner-style HLC ("latest observed assumed"):
 *
 *   - `physical_ms` is the latest observed UTC millisecond (max of local
 *     wall-clock and any HLC we have ever received from a peer).
 *   - `counter` is bumped to break ties when two events share a physical_ms.
 *   - `node_id` is a stable, opaque per-process identifier; it is the
 *     tie-breaker of last resort.
 *
 * Skew tolerance:
 *   - Forward skew (peer's `physical_ms` is ahead of ours by up to
 *     `MAX_SKEW_MS`) is absorbed — we accept the peer's clock and continue.
 *   - Beyond `MAX_SKEW_MS` (5 minutes per AC #3), `merge` throws
 *     `HlcClockSkewError`. The caller is expected to escalate that pair to
 *     the divergence queue per §7.1.
 *
 * Serialization:
 *   - The wire / audit-log form is `"<physical_ms>.<counter>-<node_id>"`
 *     matching the §3.2 example `"1718645112.000-0042"`.
 *
 * Determinism:
 *   - The clock NEVER reads `Date.now()` directly inside business logic.
 *     `Hlc` takes a `physicalClock` function so tests can pin time.
 */

/** ADR-0010 §4 — Tier-2 escalates to Tier-3 when clock skew exceeds this. */
export const MAX_SKEW_MS = 5 * 60 * 1000;

/** Maximum counter value before we roll the physical_ms tick by one. */
export const MAX_COUNTER = 0xffff;

/** Wire form of an HLC: `"<physical_ms>.<counter>-<node_id>"`. */
export type HlcWire = string;

export interface HlcTimestamp {
  readonly physicalMs: number;
  readonly counter: number;
  readonly nodeId: string;
}

export class HlcClockSkewError extends Error {
  readonly localPhysicalMs: number;
  readonly remotePhysicalMs: number;
  readonly skewMs: number;
  constructor(localPhysicalMs: number, remotePhysicalMs: number) {
    const skewMs = Math.abs(remotePhysicalMs - localPhysicalMs);
    super(
      `HLC clock skew of ${skewMs}ms exceeds MAX_SKEW_MS=${MAX_SKEW_MS}ms ` +
        `(local=${localPhysicalMs}, remote=${remotePhysicalMs}). ` +
        `Caller must degrade affected event pair to Tier-3 divergence queue (ADR-0010 §7.1).`,
    );
    this.name = 'HlcClockSkewError';
    this.localPhysicalMs = localPhysicalMs;
    this.remotePhysicalMs = remotePhysicalMs;
    this.skewMs = skewMs;
  }
}

export class HlcParseError extends Error {
  constructor(wire: string, reason: string) {
    super(`HLC parse error for "${wire}": ${reason}`);
    this.name = 'HlcParseError';
  }
}

/**
 * Format an HLC as the canonical wire form (§3.2 example matches).
 * Counter is rendered zero-padded to 4 hex digits so lexicographic ordering
 * of the wire form is identical to numeric ordering for same-physical_ms
 * events; this is what the audit log + `comment_id` tie-break rely on.
 */
export function hlcToWire(ts: HlcTimestamp): HlcWire {
  const counter = ts.counter.toString(16).padStart(4, '0');
  return `${ts.physicalMs}.${counter}-${ts.nodeId}`;
}

/**
 * Parse the canonical wire form. Inverse of `hlcToWire`.
 */
export function hlcFromWire(wire: HlcWire): HlcTimestamp {
  // Format: <physicalMs>.<hexCounter>-<nodeId>
  const dotIdx = wire.indexOf('.');
  if (dotIdx <= 0) throw new HlcParseError(wire, 'missing "." separator');
  const dashIdx = wire.indexOf('-', dotIdx);
  if (dashIdx <= dotIdx) throw new HlcParseError(wire, 'missing "-" separator');

  const physicalStr = wire.slice(0, dotIdx);
  const counterStr = wire.slice(dotIdx + 1, dashIdx);
  const nodeId = wire.slice(dashIdx + 1);

  if (!/^[0-9]+$/.test(physicalStr))
    throw new HlcParseError(wire, 'physical_ms is not an integer');
  if (!/^[0-9a-f]+$/i.test(counterStr))
    throw new HlcParseError(wire, 'counter is not hex');
  if (nodeId.length === 0)
    throw new HlcParseError(wire, 'node_id is empty');

  const physicalMs = Number.parseInt(physicalStr, 10);
  const counter = Number.parseInt(counterStr, 16);
  if (!Number.isFinite(physicalMs) || physicalMs < 0)
    throw new HlcParseError(wire, 'physical_ms out of range');
  if (counter < 0 || counter > MAX_COUNTER)
    throw new HlcParseError(wire, `counter out of range (0..${MAX_COUNTER})`);

  return { physicalMs, counter, nodeId };
}

/**
 * Compare two HLCs. Returns < 0 if a < b, 0 if equal, > 0 if a > b.
 * Order: `physicalMs` then `counter` then lexicographic `nodeId`.
 * The `nodeId` tie-breaker means *equal HLCs from different nodes are never
 * truly equal* — exactly what the §4 Tier-2 tiebreaker promise requires
 * (the §3 "stable `comment_id`/`event_id`" is the layer above this and
 * resolves the remaining ambiguity when the same node emits two events with
 * identical HLC, which our `now()` prevents by construction).
 */
export function hlcCompare(a: HlcTimestamp, b: HlcTimestamp): number {
  if (a.physicalMs !== b.physicalMs) return a.physicalMs - b.physicalMs;
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.nodeId < b.nodeId) return -1;
  if (a.nodeId > b.nodeId) return 1;
  return 0;
}

export function hlcEqual(a: HlcTimestamp, b: HlcTimestamp): boolean {
  return hlcCompare(a, b) === 0;
}

export interface HlcConfig {
  readonly nodeId: string;
  /**
   * Returns the current UTC time in ms. Defaults to `() => Date.now()`.
   * Tests inject a fake clock so behaviour is deterministic.
   */
  readonly physicalClock?: () => number;
  /**
   * Override the maximum allowed skew. Defaults to `MAX_SKEW_MS` (5 min).
   */
  readonly maxSkewMs?: number;
}

/**
 * A live HLC clock. Owns the current `(physicalMs, counter)` state.
 *
 *  - `now()` returns the next monotonically increasing local HLC.
 *  - `observe(remote)` merges a peer HLC into local state (Spanner-style).
 *    Throws `HlcClockSkewError` if the absolute skew between the remote and
 *    the local wall-clock exceeds `maxSkewMs` — the caller is then
 *    responsible for routing the offending event pair to Tier-3.
 */
export class Hlc {
  readonly nodeId: string;
  private readonly clock: () => number;
  private readonly maxSkewMs: number;
  private lastPhysical: number;
  private lastCounter: number;

  constructor(cfg: HlcConfig) {
    if (!cfg.nodeId) throw new Error('Hlc.nodeId is required');
    this.nodeId = cfg.nodeId;
    this.clock = cfg.physicalClock ?? (() => Date.now());
    this.maxSkewMs = cfg.maxSkewMs ?? MAX_SKEW_MS;
    this.lastPhysical = 0;
    this.lastCounter = 0;
  }

  /** Snapshot the current `(physicalMs, counter)` without advancing. */
  snapshot(): HlcTimestamp {
    return {
      physicalMs: this.lastPhysical,
      counter: this.lastCounter,
      nodeId: this.nodeId,
    };
  }

  /**
   * Emit a new HLC for a *local* event.
   *
   *   pt   = wall-clock now
   *   if pt > lastPhysical: lastPhysical = pt; lastCounter = 0
   *   else:                  lastCounter += 1   (with overflow → physical tick)
   */
  now(): HlcTimestamp {
    const pt = this.clock();
    if (pt > this.lastPhysical) {
      this.lastPhysical = pt;
      this.lastCounter = 0;
    } else {
      this.lastCounter += 1;
      if (this.lastCounter > MAX_COUNTER) {
        // Roll forward by one ms; counter resets. Preserves monotonicity.
        this.lastPhysical += 1;
        this.lastCounter = 0;
      }
    }
    return {
      physicalMs: this.lastPhysical,
      counter: this.lastCounter,
      nodeId: this.nodeId,
    };
  }

  /**
   * Merge a remote HLC into local state and emit a new HLC for the *receive*
   * event. Order, per Spanner-style HLC:
   *
   *   pt   = wall-clock now
   *   newPhysical = max(pt, lastPhysical, remote.physicalMs)
   *   if newPhysical == lastPhysical == remote.physicalMs:
   *     counter = max(lastCounter, remote.counter) + 1
   *   else if newPhysical == lastPhysical:
   *     counter = lastCounter + 1
   *   else if newPhysical == remote.physicalMs:
   *     counter = remote.counter + 1
   *   else:
   *     counter = 0
   *
   * Throws `HlcClockSkewError` when |remote.physicalMs - pt| > maxSkewMs.
   */
  observe(remote: HlcTimestamp): HlcTimestamp {
    const pt = this.clock();
    const skew = Math.abs(remote.physicalMs - pt);
    if (skew > this.maxSkewMs) {
      throw new HlcClockSkewError(pt, remote.physicalMs);
    }
    const newPhysical = Math.max(pt, this.lastPhysical, remote.physicalMs);
    let newCounter: number;
    if (
      newPhysical === this.lastPhysical &&
      newPhysical === remote.physicalMs
    ) {
      newCounter = Math.max(this.lastCounter, remote.counter) + 1;
    } else if (newPhysical === this.lastPhysical) {
      newCounter = this.lastCounter + 1;
    } else if (newPhysical === remote.physicalMs) {
      newCounter = remote.counter + 1;
    } else {
      newCounter = 0;
    }
    if (newCounter > MAX_COUNTER) {
      this.lastPhysical = newPhysical + 1;
      this.lastCounter = 0;
    } else {
      this.lastPhysical = newPhysical;
      this.lastCounter = newCounter;
    }
    return {
      physicalMs: this.lastPhysical,
      counter: this.lastCounter,
      nodeId: this.nodeId,
    };
  }
}

/**
 * Pure merge of two HLCs without owning a clock. Useful when the resolver
 * has two events from peers and needs to choose a winner without advancing
 * any local state.
 *
 * Returns the *winning* HLC by ordering. If equal under `hlcCompare`,
 * returns `a` (so the caller's natural left-to-right preference holds when
 * we are merging an in-flight event onto an existing canonical value).
 */
export function hlcMax(a: HlcTimestamp, b: HlcTimestamp): HlcTimestamp {
  return hlcCompare(a, b) >= 0 ? a : b;
}
