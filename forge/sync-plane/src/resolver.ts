/**
 * Tier-1 / Tier-2 conflict resolver — ADR-0010 §4.
 *
 * Pipeline per write event:
 *
 *   1. Look up the field in the ownership table.
 *   2. If `single`: the owner is authoritative. Writes from any other
 *      platform are *not* dropped — they become mirror events with the
 *      configured `mirrorPolicy`. The owner's value is the canonical write.
 *   3. If `creator`: the owner is the platform that created the issue
 *      (`event.creatorPlatform`); fallback when missing. Same mirror semantics.
 *   4. If `tier2`: select the candidate with the highest HLC; tiebreaker
 *      is the stable `eventId` (§4 last paragraph).
 *      - If `writers` is non-empty, candidates from other platforms are
 *        treated as mirror events and *not* eligible to win.
 *      - If LWW would *drop user-visible data* (the loser has a non-null
 *        body that differs materially from the winner), the resolver parks
 *        the event into the divergence queue (Tier-3) instead of returning
 *        a winner. The caller is then expected to surface it in the
 *        workbench (sub-task #5).
 *
 * Comment-vs-status ordering (AC #3):
 *   The resolver does NOT special-case comment-vs-status; it relies on the
 *   HLC of each candidate. That delivers the right answer when the inbound
 *   adapter emits one HLC per event (a comment write and a status write are
 *   distinct events with distinct HLCs even if they arrive in the same
 *   webhook payload). The audit log records both events in HLC order.
 */

import { hlcCompare, hlcMax, type HlcTimestamp } from './hlc.js';
import {
  type OwnershipRule,
  type OwnershipTable,
  type Platform,
} from './ownership.js';
import {
  DivergenceQueue,
  type CandidateValue,
  type ParkedEvent,
} from './divergence-queue.js';

export interface SyncEvent<V = unknown> {
  readonly eventId: string;
  readonly tenantSlug: string;
  readonly paperclipIssueId: string;
  readonly field: string;
  readonly value: V;
  readonly platform: Platform;
  readonly hlc: HlcTimestamp;
}

export interface IssueContext {
  /** Platform that originally created the issue (drives `creator` mode). */
  readonly creatorPlatform?: Platform;
}

export type ResolutionOutcome<V = unknown> =
  | {
      readonly kind: 'canonical_write';
      readonly tier: 1 | 2;
      readonly winner: SyncEvent<V>;
      readonly mirror: readonly SyncEvent<V>[];
      readonly rule: OwnershipRule;
    }
  | {
      readonly kind: 'parked';
      readonly tier: 3;
      readonly parked: ParkedEvent<V>;
      readonly rule: OwnershipRule;
    };

export interface ResolverOptions {
  /**
   * Predicate that decides whether LWW would drop user-visible data.
   * Defaults to "values differ and both are non-empty strings" — the
   * tightest reasonable definition for a v0.1.
   */
  readonly wouldDropData?: <V>(winner: V, loser: V) => boolean;
}

const defaultWouldDropData = <V,>(winner: V, loser: V): boolean => {
  if (winner === loser) return false;
  // Empty / null / undefined losers cannot drop data.
  const empty = (v: V): boolean =>
    v === null ||
    v === undefined ||
    (typeof v === 'string' && v.trim() === '');
  if (empty(loser)) return false;
  if (empty(winner)) return true; // winning value is empty but loser had real text
  if (typeof winner === 'string' && typeof loser === 'string') {
    // Drop-data heuristic: divergent non-empty strings whose union > 1 char.
    return winner !== loser && (winner.length > 0 || loser.length > 0);
  }
  return winner !== loser;
};

export class Resolver {
  private readonly table: OwnershipTable;
  private readonly queue: DivergenceQueue;
  private readonly wouldDropData: <V>(winner: V, loser: V) => boolean;

  constructor(
    table: OwnershipTable,
    queue: DivergenceQueue,
    options: ResolverOptions = {},
  ) {
    this.table = table;
    this.queue = queue;
    this.wouldDropData = (options.wouldDropData ?? defaultWouldDropData) as <V>(
      winner: V,
      loser: V,
    ) => boolean;
  }

  /**
   * Resolve a batch of concurrent writes for the same `(tenant, issue, field)`.
   * All events MUST share field and tenant; the resolver throws otherwise.
   */
  resolve<V>(events: readonly SyncEvent<V>[], ctx: IssueContext = {}): ResolutionOutcome<V> {
    if (events.length === 0) throw new Error('Resolver.resolve: empty event list');
    const first = events[0]!;
    for (const e of events) {
      if (e.field !== first.field)
        throw new Error(
          `Resolver.resolve: mixed fields ("${first.field}" vs "${e.field}")`,
        );
      if (e.tenantSlug !== first.tenantSlug)
        throw new Error(
          `Resolver.resolve: mixed tenants ("${first.tenantSlug}" vs "${e.tenantSlug}")`,
        );
      if (e.paperclipIssueId !== first.paperclipIssueId)
        throw new Error(
          `Resolver.resolve: mixed issues ("${first.paperclipIssueId}" vs "${e.paperclipIssueId}")`,
        );
    }
    const rule = this.lookup(first.field);

    if (rule.mode === 'single') {
      return this.resolveSingle(events, rule.owner, rule);
    }
    if (rule.mode === 'creator') {
      const owner = ctx.creatorPlatform ?? rule.fallback;
      return this.resolveSingle(events, owner, rule);
    }
    return this.resolveTier2(events, rule);
  }

  private lookup(field: string): OwnershipRule {
    const r = this.table.fields.get(field);
    if (r) return r;
    // Unknown field → Tier-2 with no writer restriction (free-text).
    return { mode: 'tier2', writers: [] };
  }

  private resolveSingle<V>(
    events: readonly SyncEvent<V>[],
    owner: Platform,
    rule: OwnershipRule,
  ): ResolutionOutcome<V> {
    const ownerEvents = events.filter((e) => e.platform === owner);
    const mirror = events.filter((e) => e.platform !== owner);
    if (ownerEvents.length === 0) {
      // No writer from the owner — pick the latest mirror as the
      // "translated mirror_state" so the resolver always has a winner.
      // The resolver tags this with `tier: 1` because the rule is Tier-1.
      const winner = mirror.reduce(
        (acc, e) =>
          acc === undefined || hlcCompare(e.hlc, acc.hlc) > 0 ? e : acc,
        undefined as SyncEvent<V> | undefined,
      )!;
      const others = mirror.filter((e) => e.eventId !== winner.eventId);
      return { kind: 'canonical_write', tier: 1, winner, mirror: others, rule };
    }
    // Owner writes: pick the latest owner event by HLC.
    const winner = ownerEvents.reduce((acc, e) =>
      acc === undefined || hlcCompare(e.hlc, acc.hlc) > 0 ? e : acc,
    );
    const others = [
      ...mirror,
      ...ownerEvents.filter((e) => e.eventId !== winner.eventId),
    ];
    return { kind: 'canonical_write', tier: 1, winner, mirror: others, rule };
  }

  private resolveTier2<V>(
    events: readonly SyncEvent<V>[],
    rule: Extract<OwnershipRule, { mode: 'tier2' }>,
  ): ResolutionOutcome<V> {
    const eligible =
      rule.writers.length === 0
        ? events
        : events.filter((e) => rule.writers.includes(e.platform));
    const mirror =
      rule.writers.length === 0
        ? []
        : events.filter((e) => !rule.writers.includes(e.platform));

    if (eligible.length === 0) {
      // All events are mirror-only. Park as Tier-3 because we have nothing
      // authoritative to write back.
      return this.park(events, 'tier3_only_field', rule);
    }

    // Pick winner by HLC, tiebreak on eventId.
    const sorted = [...eligible].sort((a, b) => {
      const c = hlcCompare(b.hlc, a.hlc); // descending HLC
      if (c !== 0) return c;
      // Lex order on eventId for total ordering (§4 last paragraph).
      if (a.eventId < b.eventId) return -1;
      if (a.eventId > b.eventId) return 1;
      return 0;
    });
    const winner = sorted[0]!;
    const losers = sorted.slice(1);

    // If the winner would drop user-visible data from any loser, park.
    for (const loser of losers) {
      if (this.wouldDropData(winner.value, loser.value)) {
        return this.park(events, 'lww_would_drop_data', rule);
      }
    }
    const others = [...mirror, ...losers];
    return { kind: 'canonical_write', tier: 2, winner, mirror: others, rule };
  }

  private park<V>(
    events: readonly SyncEvent<V>[],
    reason: ParkedEvent['reason'],
    rule: OwnershipRule,
  ): ResolutionOutcome<V> {
    const candidates: CandidateValue<V>[] = events.map((e) => ({
      platform: e.platform,
      value: e.value,
      hlc: e.hlc,
      eventId: e.eventId,
    }));
    const parkedAtHlc = events
      .map((e) => e.hlc)
      .reduce((a, b) => hlcMax(a, b));
    const first = events[0]!;
    const parked = this.queue.park<V>({
      tenantSlug: first.tenantSlug,
      paperclipIssueId: first.paperclipIssueId,
      field: first.field,
      candidates,
      reason,
      parkedAtHlc,
      explanation: buildExplanation(reason, candidates),
    });
    return { kind: 'parked', tier: 3, parked, rule };
  }
}

function buildExplanation<V>(
  reason: ParkedEvent['reason'],
  candidates: readonly CandidateValue<V>[],
): string {
  const lines = candidates.map(
    (c) =>
      `  - platform=${c.platform} eventId=${c.eventId} hlc=${c.hlc.physicalMs}.${c.hlc.counter}-${c.hlc.nodeId}`,
  );
  return `Tier-3 parked (${reason}). Candidates:\n${lines.join('\n')}`;
}
