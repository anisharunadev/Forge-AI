/**
 * Tier-3 divergence queue — ADR-0010 §4 + §7.2.
 *
 * The Tier-2 resolver parks events here when LWW *cannot* safely reconcile
 * them (semantic conflict, comment-vs-status interleave, clock-skew window).
 * Sub-task #5 (divergence workbench, FORA-265 blocks) consumes this API to
 * render rows; a human admin then calls `resolve()` to pick a winner.
 *
 * Storage is in-memory for v0.1 — the persistent Postgres implementation
 * lands as part of the Sync Plane service (sub-task #1) which owns the
 * canonical store. The interface here is the **contract** the workbench
 * codes against, so the swap to Postgres is transparent.
 *
 * Audit semantics (§8.1):
 *   - `park()` emits `sync.event.divergence_detected`.
 *   - `resolve()` emits `sync.event.divergence_resolved` with the chosen
 *     winner HLC and reason.
 *
 * Both emission hooks are passed in via `DivergenceQueueOptions.audit` so
 * the queue stays free of audit-pipeline imports.
 */

import { hlcCompare, type HlcTimestamp } from './hlc.js';
import type { Platform } from './ownership.js';

export type ResolutionReason =
  | 'hlc_lww'
  | 'tier1_field_ownership'
  | 'human_chose'
  | 'tenant_precedence';

export interface CandidateValue<V = unknown> {
  readonly platform: Platform;
  readonly value: V;
  readonly hlc: HlcTimestamp;
  /** Stable per-event identifier — used as the final tie-breaker (§4 Tier-2). */
  readonly eventId: string;
}

export interface ParkedEvent<V = unknown> {
  readonly id: string;
  readonly tenantSlug: string;
  readonly paperclipIssueId: string;
  readonly field: string;
  readonly candidates: readonly CandidateValue<V>[];
  /** Why the resolver gave up and parked. */
  readonly reason: 'semantic_conflict' | 'clock_skew' | 'lww_would_drop_data' | 'tier3_only_field';
  readonly parkedAtHlc: HlcTimestamp;
  /** Free-text explanation surfaced to the workbench. */
  readonly explanation: string;
}

export interface ResolvedEvent<V = unknown> extends ParkedEvent<V> {
  readonly winnerEventId: string;
  readonly winnerHlc: HlcTimestamp;
  readonly resolutionReason: ResolutionReason;
  readonly resolvedAtHlc: HlcTimestamp;
  readonly resolvedBy: string;
}

export interface AuditEmitter {
  divergenceDetected(parked: ParkedEvent): void;
  divergenceResolved(resolved: ResolvedEvent): void;
}

export interface DivergenceQueueOptions {
  readonly audit?: AuditEmitter;
  /** Override the id generator (tests). Default produces `dvg_<n>`. */
  readonly idFactory?: () => string;
}

/**
 * In-memory divergence queue. The workbench surface (sub-task #5) talks
 * through this interface; the production swap is a `PgDivergenceQueue` that
 * keeps the same shape.
 */
export class DivergenceQueue {
  private readonly audit: AuditEmitter | undefined;
  private readonly idFactory: () => string;
  private readonly parked = new Map<string, ParkedEvent>();
  private readonly resolved = new Map<string, ResolvedEvent>();
  private seq = 0;

  constructor(options: DivergenceQueueOptions = {}) {
    this.audit = options.audit;
    this.idFactory =
      options.idFactory ?? (() => `dvg_${(++this.seq).toString(10).padStart(6, '0')}`);
  }

  park<V>(input: Omit<ParkedEvent<V>, 'id'>): ParkedEvent<V> {
    if (input.candidates.length < 2)
      throw new Error('divergence requires at least two candidate values');
    const id = this.idFactory();
    const parked: ParkedEvent<V> = { ...input, id };
    this.parked.set(id, parked as ParkedEvent);
    this.audit?.divergenceDetected(parked as ParkedEvent);
    return parked;
  }

  list(filter?: { tenantSlug?: string; paperclipIssueId?: string }): readonly ParkedEvent[] {
    let xs = Array.from(this.parked.values());
    if (filter?.tenantSlug) xs = xs.filter((p) => p.tenantSlug === filter.tenantSlug);
    if (filter?.paperclipIssueId)
      xs = xs.filter((p) => p.paperclipIssueId === filter.paperclipIssueId);
    // Stable order: parkedAtHlc ascending so the workbench shows oldest first.
    return xs.sort((a, b) => hlcCompare(a.parkedAtHlc, b.parkedAtHlc));
  }

  get(id: string): ParkedEvent | undefined {
    return this.parked.get(id);
  }

  /**
   * Resolve a parked event by picking the winner. The workbench supplies
   * `winnerEventId` (which must be one of the candidates), the actor that
   * resolved, and the HLC at which the resolution was decided.
   */
  resolve<V>(input: {
    id: string;
    winnerEventId: string;
    resolutionReason: ResolutionReason;
    resolvedAtHlc: HlcTimestamp;
    resolvedBy: string;
  }): ResolvedEvent<V> {
    const parked = this.parked.get(input.id);
    if (!parked) throw new Error(`unknown parked event: ${input.id}`);
    const winner = parked.candidates.find((c) => c.eventId === input.winnerEventId);
    if (!winner)
      throw new Error(
        `winnerEventId "${input.winnerEventId}" not present in parked candidates`,
      );
    const resolved: ResolvedEvent<V> = {
      ...(parked as ParkedEvent<V>),
      winnerEventId: winner.eventId,
      winnerHlc: winner.hlc,
      resolutionReason: input.resolutionReason,
      resolvedAtHlc: input.resolvedAtHlc,
      resolvedBy: input.resolvedBy,
    };
    this.parked.delete(input.id);
    this.resolved.set(input.id, resolved as ResolvedEvent);
    this.audit?.divergenceResolved(resolved as ResolvedEvent);
    return resolved;
  }

  resolvedHistory(): readonly ResolvedEvent[] {
    return Array.from(this.resolved.values());
  }

  size(): number {
    return this.parked.size;
  }
}
