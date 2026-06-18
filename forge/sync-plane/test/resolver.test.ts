import { describe, expect, it, vi } from 'vitest';
import {
  buildOwnershipTable,
  DivergenceQueue,
  Hlc,
  Resolver,
  type AuditEmitter,
  type HlcTimestamp,
  type ParkedEvent,
  type ResolvedEvent,
  type SyncEvent,
} from '../src/index.js';

function ev<V>(
  field: string,
  platform: SyncEvent['platform'],
  hlc: HlcTimestamp,
  value: V,
  eventId: string,
): SyncEvent<V> {
  return {
    eventId,
    tenantSlug: 'acme',
    paperclipIssueId: 'FORA-1',
    field,
    value,
    platform,
    hlc,
  };
}

function makeHlc(seedMs: number, nodeId = 'node-a'): HlcTimestamp[] {
  let t = seedMs;
  const clock = new Hlc({ nodeId, physicalClock: () => t });
  return Array.from({ length: 10 }, () => {
    const ts = clock.now();
    t += 1;
    return ts;
  });
}

describe('Tier-1 / Tier-2 resolver', () => {
  it('Tier-1 single owner: paperclip beats remote mirror', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(1_000);
    const result = resolver.resolve([
      ev('paperclip.run_status', 'jira', h0!, 'in_progress', 'e1'),
      ev('paperclip.run_status', 'paperclip', h1!, 'done', 'e2'),
    ]);
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      expect(result.tier).toBe(1);
      expect(result.winner.eventId).toBe('e2');
      expect(result.winner.platform).toBe('paperclip');
      expect(result.mirror.map((m) => m.eventId)).toEqual(['e1']);
    }
    expect(queue.size()).toBe(0);
  });

  it('Tier-1 single owner: mirror events do not flip ownership', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1, h2] = makeHlc(2_000);
    const result = resolver.resolve([
      ev('jira.sprint', 'jira', h0!, 'sprint-12', 'e1'),
      ev('jira.sprint', 'github', h1!, 'should-be-mirror', 'e2'),
      ev('jira.sprint', 'paperclip', h2!, 'should-also-mirror', 'e3'),
    ]);
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      expect(result.winner.platform).toBe('jira');
      expect(result.winner.eventId).toBe('e1');
      expect(result.mirror).toHaveLength(2);
    }
  });

  it('Tier-1 creator mode picks the creator platform via context', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(3_000);
    const result = resolver.resolve(
      [
        ev('issue.state', 'jira', h0!, 'In Progress', 'e1'),
        ev('issue.state', 'github', h1!, 'open', 'e2'),
      ],
      { creatorPlatform: 'github' },
    );
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      expect(result.winner.platform).toBe('github');
      expect(result.winner.eventId).toBe('e2');
    }
  });

  it('Tier-1 creator mode falls back when no creatorPlatform in context', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(4_000);
    const result = resolver.resolve([
      ev('issue.status', 'jira', h0!, 'in-progress', 'e1'),
      ev('issue.status', 'paperclip', h1!, 'done', 'e2'),
    ]);
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      // default fallback is paperclip per defaultOwnershipFields()
      expect(result.winner.platform).toBe('paperclip');
    }
  });

  it('Tier-2 HLC LWW picks the later HLC', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1, h2] = makeHlc(5_000);
    const result = resolver.resolve([
      ev('issue.title', 'jira', h0!, 'A', 'e1'),
      ev('issue.title', 'paperclip', h1!, 'A', 'e2'),
      ev('issue.title', 'github', h2!, 'A', 'e3'),
    ]);
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      expect(result.tier).toBe(2);
      expect(result.winner.eventId).toBe('e3');
    }
  });

  it('Tier-2 tiebreak on eventId when HLCs are equal', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const hlc: HlcTimestamp = { physicalMs: 100, counter: 0, nodeId: 'n' };
    // Tie on every HLC field — same value to avoid the drop-data park.
    const result = resolver.resolve([
      ev('comment.body', 'jira', hlc, 'same', 'event-b'),
      ev('comment.body', 'github', hlc, 'same', 'event-a'),
    ]);
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      // lexicographically smallest eventId wins (deterministic).
      expect(result.winner.eventId).toBe('event-a');
    }
  });

  it('Tier-2 restricted writers treat non-writer events as mirror', () => {
    const table = buildOwnershipTable('acme', {
      'issue.body': { mode: 'tier2', writers: ['paperclip', 'jira'] },
    });
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1, h2] = makeHlc(6_000);
    const result = resolver.resolve([
      // github HLC is the latest but github is not in writers → mirror.
      ev('issue.body', 'paperclip', h0!, 'x', 'e1'),
      ev('issue.body', 'jira', h1!, 'x', 'e2'),
      ev('issue.body', 'github', h2!, 'x', 'e3'),
    ]);
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      expect(result.winner.platform).toBe('jira');
      expect(result.winner.eventId).toBe('e2');
      expect(result.mirror.map((m) => m.platform).sort()).toEqual([
        'github',
        'paperclip',
      ]);
    }
  });

  it('Tier-2 parks when LWW would drop user-visible data', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(7_000);
    const result = resolver.resolve([
      ev('issue.title', 'jira', h0!, 'Customer reported bug X', 'e1'),
      ev('issue.title', 'github', h1!, 'Bug: payment timeout', 'e2'),
    ]);
    expect(result.kind).toBe('parked');
    if (result.kind === 'parked') {
      expect(result.tier).toBe(3);
      expect(result.parked.reason).toBe('lww_would_drop_data');
      expect(result.parked.candidates).toHaveLength(2);
    }
    expect(queue.size()).toBe(1);
  });

  it('Tier-2 does NOT park when the loser is empty', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(8_000);
    const result = resolver.resolve([
      ev('issue.title', 'jira', h0!, '', 'e1'),
      ev('issue.title', 'github', h1!, 'A new title', 'e2'),
    ]);
    expect(result.kind).toBe('canonical_write');
    expect(queue.size()).toBe(0);
  });

  it('Tier-2 only-field with all mirrors parks as tier3_only_field', () => {
    const table = buildOwnershipTable('acme', {
      'issue.body': { mode: 'tier2', writers: ['paperclip'] },
    });
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(9_000);
    const result = resolver.resolve([
      ev('issue.body', 'jira', h0!, 'a', 'e1'),
      ev('issue.body', 'github', h1!, 'a', 'e2'),
    ]);
    expect(result.kind).toBe('parked');
    if (result.kind === 'parked') {
      expect(result.parked.reason).toBe('tier3_only_field');
    }
  });

  it('clock skew up to 5 min: Tier-2 still picks a winner via HLC', () => {
    const queue = new DivergenceQueue();
    const table = buildOwnershipTable('acme');
    const resolver = new Resolver(table, queue);
    // Two clocks 4 minutes apart — within tolerance — yield comparable HLCs.
    const clockA = new Hlc({ nodeId: 'a', physicalClock: () => 1_000_000 });
    const clockB = new Hlc({ nodeId: 'b', physicalClock: () => 1_000_000 + 4 * 60_000 });
    const hA = clockA.now();
    const hB = clockB.now();
    const result = resolver.resolve([
      ev('comment.body', 'paperclip', hA, 'msg-from-A', 'eA'),
      ev('comment.body', 'jira', hB, 'msg-from-A', 'eB'), // same value to avoid park
    ]);
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      // B's HLC is 4min ahead of A's, so B wins.
      expect(result.winner.eventId).toBe('eB');
    }
  });

  it('comment vs status ordering: late status loses to earlier status on same field', () => {
    // Tier-1 fields don't compete on HLC across fields, but the resolver
    // works per-field. We assert that two writes on the same status field
    // with different HLCs land in the right order, and a separate comment
    // write resolves independently and earlier-or-later by its own HLC.
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const clock = new Hlc({ nodeId: 'p', physicalClock: () => 100_000 });

    const statusEarly = clock.now();
    const commentMid = clock.now();
    const statusLate = clock.now();

    const statusResult = resolver.resolve(
      [
        ev('issue.status', 'paperclip', statusEarly, 'in_progress', 'e1'),
        ev('issue.status', 'paperclip', statusLate, 'done', 'e2'),
      ],
      { creatorPlatform: 'paperclip' },
    );
    expect(statusResult.kind).toBe('canonical_write');
    if (statusResult.kind === 'canonical_write') {
      expect(statusResult.winner.value).toBe('done');
    }

    const commentResult = resolver.resolve([
      ev('comment.body', 'paperclip', commentMid, 'midway note', 'c1'),
    ]);
    expect(commentResult.kind).toBe('canonical_write');
    if (commentResult.kind === 'canonical_write') {
      expect(commentResult.winner.eventId).toBe('c1');
    }
  });

  it('resolver throws on mixed field / tenant / issue inputs', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(100);
    expect(() =>
      resolver.resolve([
        ev('issue.title', 'jira', h0!, 'x', 'e1'),
        { ...ev('comment.body', 'jira', h1!, 'x', 'e2') },
      ]),
    ).toThrow();
    expect(() => resolver.resolve([])).toThrow();
  });

  it('resolver emits audit hooks via the divergence queue', () => {
    const detected = vi.fn();
    const resolved = vi.fn();
    const audit: AuditEmitter = {
      divergenceDetected: detected as unknown as AuditEmitter['divergenceDetected'],
      divergenceResolved: resolved as unknown as AuditEmitter['divergenceResolved'],
    };
    const queue = new DivergenceQueue({ audit });
    const table = buildOwnershipTable('acme');
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(200);
    const out = resolver.resolve([
      ev('issue.title', 'jira', h0!, 'X', 'e1'),
      ev('issue.title', 'github', h1!, 'Y', 'e2'),
    ]);
    expect(out.kind).toBe('parked');
    expect(detected).toHaveBeenCalledTimes(1);

    if (out.kind === 'parked') {
      const resolvedEvent = queue.resolve({
        id: out.parked.id,
        winnerEventId: 'e2',
        resolutionReason: 'human_chose',
        resolvedAtHlc: h1!,
        resolvedBy: 'admin@acme',
      });
      expect(resolvedEvent.winnerEventId).toBe('e2');
      expect(resolved).toHaveBeenCalledTimes(1);
      expect(queue.size()).toBe(0);
    }
  });

  it('divergence queue rejects unknown id + bad winner', () => {
    const q = new DivergenceQueue();
    expect(() =>
      q.resolve({
        id: 'dvg_nope',
        winnerEventId: 'e1',
        resolutionReason: 'human_chose',
        resolvedAtHlc: { physicalMs: 0, counter: 0, nodeId: 'x' },
        resolvedBy: 'admin',
      }),
    ).toThrow();

    const [h0, h1] = makeHlc(900);
    const parked = q.park({
      tenantSlug: 'acme',
      paperclipIssueId: 'FORA-1',
      field: 'issue.title',
      candidates: [
        { platform: 'jira', value: 'A', hlc: h0!, eventId: 'e1' },
        { platform: 'github', value: 'B', hlc: h1!, eventId: 'e2' },
      ],
      reason: 'semantic_conflict',
      parkedAtHlc: h1!,
      explanation: 'test',
    });
    expect(parked.id).toMatch(/^dvg_/);
    expect(() =>
      q.resolve({
        id: parked.id,
        winnerEventId: 'not-a-candidate',
        resolutionReason: 'human_chose',
        resolvedAtHlc: h1!,
        resolvedBy: 'admin',
      }),
    ).toThrow();
  });

  it('divergence queue parks at least two candidates and lists in HLC order', () => {
    const q = new DivergenceQueue();
    const [h0, h1, h2] = makeHlc(300);
    expect(() =>
      q.park({
        tenantSlug: 'acme',
        paperclipIssueId: 'FORA-1',
        field: 'issue.title',
        candidates: [{ platform: 'jira', value: 'x', hlc: h0!, eventId: 'e1' }],
        reason: 'semantic_conflict',
        parkedAtHlc: h0!,
        explanation: 'only one',
      }),
    ).toThrow();

    const p1 = q.park({
      tenantSlug: 'acme',
      paperclipIssueId: 'FORA-2',
      field: 'issue.title',
      candidates: [
        { platform: 'jira', value: 'A', hlc: h1!, eventId: 'e1' },
        { platform: 'github', value: 'B', hlc: h2!, eventId: 'e2' },
      ],
      reason: 'semantic_conflict',
      parkedAtHlc: h2!,
      explanation: 'second',
    });
    const p2 = q.park({
      tenantSlug: 'acme',
      paperclipIssueId: 'FORA-1',
      field: 'issue.title',
      candidates: [
        { platform: 'jira', value: 'A', hlc: h0!, eventId: 'e3' },
        { platform: 'github', value: 'B', hlc: h1!, eventId: 'e4' },
      ],
      reason: 'lww_would_drop_data',
      parkedAtHlc: h1!,
      explanation: 'first',
    });

    const all = q.list();
    expect(all).toHaveLength(2);
    // sorted by parkedAtHlc ascending — p2 (h1) before p1 (h2).
    expect(all[0]?.id).toBe(p2.id);
    expect(all[1]?.id).toBe(p1.id);

    const filtered = q.list({ paperclipIssueId: 'FORA-1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(p2.id);
  });

  it('resolved events flow into resolvedHistory', () => {
    const q = new DivergenceQueue();
    const [h0, h1] = makeHlc(400);
    const p = q.park({
      tenantSlug: 'acme',
      paperclipIssueId: 'FORA-7',
      field: 'comment.body',
      candidates: [
        { platform: 'jira', value: 'A', hlc: h0!, eventId: 'a' },
        { platform: 'github', value: 'B', hlc: h1!, eventId: 'b' },
      ],
      reason: 'semantic_conflict',
      parkedAtHlc: h1!,
      explanation: 'two writers',
    });
    const r = q.resolve({
      id: p.id,
      winnerEventId: 'b',
      resolutionReason: 'human_chose',
      resolvedAtHlc: h1!,
      resolvedBy: 'admin',
    });
    expect(q.resolvedHistory()).toContain(r);
    expect(q.size()).toBe(0);
  });

  it('typed candidate values flow through park → resolve unchanged', () => {
    const q = new DivergenceQueue();
    const [h0, h1] = makeHlc(500);
    interface Body {
      readonly md: string;
      readonly format: 'gfm' | 'adf';
    }
    const p = q.park<Body>({
      tenantSlug: 'acme',
      paperclipIssueId: 'FORA-99',
      field: 'comment.body',
      candidates: [
        { platform: 'jira', value: { md: 'hello', format: 'adf' }, hlc: h0!, eventId: 'a' },
        { platform: 'github', value: { md: 'world', format: 'gfm' }, hlc: h1!, eventId: 'b' },
      ],
      reason: 'semantic_conflict',
      parkedAtHlc: h1!,
      explanation: 'typed',
    });
    const winner = p.candidates[1]!;
    expect(winner.value.format).toBe('gfm');
    const r = q.resolve<Body>({
      id: p.id,
      winnerEventId: 'b',
      resolutionReason: 'human_chose',
      resolvedAtHlc: h1!,
      resolvedBy: 'admin',
    });
    expect(r.candidates[1]?.value.md).toBe('world');
  });

  it('unknown field falls through to Tier-2 with no writer restriction', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(600);
    const result = resolver.resolve([
      ev('unknown.custom_field', 'jira', h0!, 'same', 'e1'),
      ev('unknown.custom_field', 'github', h1!, 'same', 'e2'),
    ]);
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      expect(result.tier).toBe(2);
      expect(result.winner.eventId).toBe('e2');
    }
  });

  it('single-owner field with only-mirror events still emits a tier-1 winner', () => {
    const table = buildOwnershipTable('acme');
    const queue = new DivergenceQueue();
    const resolver = new Resolver(table, queue);
    const [h0, h1] = makeHlc(700);
    const result = resolver.resolve([
      // No paperclip event present, but the field is owned by paperclip.
      // Resolver picks the latest mirror as the canonical fallback.
      ev('paperclip.assignee_agent_id', 'jira', h0!, 'agent-1', 'e1'),
      ev('paperclip.assignee_agent_id', 'github', h1!, 'agent-1', 'e2'),
    ]);
    expect(result.kind).toBe('canonical_write');
    if (result.kind === 'canonical_write') {
      expect(result.tier).toBe(1);
      expect(result.winner.eventId).toBe('e2');
    }
  });

  it('audit hook on park surfaces ParkedEvent (id + reason)', () => {
    const events: ParkedEvent[] = [];
    const resolved: ResolvedEvent[] = [];
    const audit: AuditEmitter = {
      divergenceDetected(p) {
        events.push(p);
      },
      divergenceResolved(r) {
        resolved.push(r);
      },
    };
    const q = new DivergenceQueue({ audit });
    const table = buildOwnershipTable('acme');
    const resolver = new Resolver(table, q);
    const [h0, h1] = makeHlc(800);
    resolver.resolve([
      ev('issue.title', 'jira', h0!, 'AAA', 'e1'),
      ev('issue.title', 'github', h1!, 'ZZZ', 'e2'),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('lww_would_drop_data');
    expect(events[0]?.id).toMatch(/^dvg_/);
    expect(resolved).toHaveLength(0);
  });
});
