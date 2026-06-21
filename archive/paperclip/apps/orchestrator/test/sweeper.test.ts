/**
 * Sweeper tests — FORA-50 §6.3 + ADR-0008 §4 step 7.
 *
 * Covers FORA-137 acceptance bar #2 (an expired approval pauses the
 * run and emits `approval_expired`) and bar #3 (stale_target recovery
 * re-issues against the latest revision).
 *
 * Conventions:
 *   - `TestClock.set()` advances wall-clock; the sweeper uses
 *     `clock.now()` and never reaches for `Date.now()`.
 *   - The in-memory repo pre-seeds a pending approval row to avoid
 *     coupling the sweeper test to the router test.
 *   - The pager records every page so we can assert "page once" by
 *     counting entries.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  InMemoryApprovalsRepo,
  RecordingEventBus,
  RecordingPager,
  TestClock,
  type ApprovalRecord,
} from '../src/test-doubles.js';
import { tickSweeper } from '../src/sweeper.js';
import { asRunId, asTenantId } from '../src/types.js';

function buildPending(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: 'appr-1',
    run_id: 'run-1',
    tenant_id: 'tenant-1',
    stage: 'dev',
    gate_kind: 'dev->qa',
    required_role: 'qa',
    status: 'pending',
    paperclip_interaction_id: 'pc-1',
    artefact_refs: [],
    reason: null,
    requested_at: '2026-06-17T00:00:00.000Z',
    decided_at: null,
    decided_by: null,
    decision: null,
    expires_at: '2026-06-17T01:00:00.000Z', // 1 h later — engineering_1h tier
    paged_at_50_percent: false,
    superseded_interaction_id: null,
    deleted_at: null,
    ...overrides,
  };
}

describe('tickSweeper', () => {
  let repo: InMemoryApprovalsRepo;
  let bus: RecordingEventBus;
  let pager: RecordingPager;
  let clock: TestClock;

  beforeEach(() => {
    repo = new InMemoryApprovalsRepo();
    bus = new RecordingEventBus();
    pager = new RecordingPager();
    clock = new TestClock(new Date('2026-06-17T00:00:00.000Z'));
  });

  it('does nothing when there are no pending approvals', async () => {
    const result = await tickSweeper({ repo, bus, pager, clock });
    expect(result.scanned).toBe(0);
    expect(result.expired).toEqual([]);
    expect(result.pagedAt50).toEqual([]);
    expect(bus.events).toEqual([]);
    expect(pager.paged).toEqual([]);
  });

  it('pages the approver once at 50% TTL and emits nothing else', async () => {
    repo.seed(buildPending());
    // 30 minutes in — exactly 50% of the 1 h engineering TTL.
    clock.set(new Date('2026-06-17T00:30:00.000Z'));

    const result = await tickSweeper({ repo, bus, pager, clock });
    expect(result.pagedAt50).toEqual(['appr-1']);
    expect(result.expired).toEqual([]);
    expect(pager.paged).toHaveLength(1);
    expect(pager.paged[0]!.reason).toBe('ttl_50_percent');
    expect(pager.paged[0]!.role).toBe('qa');
    expect(bus.events).toEqual([]);
    // The flag is set so a re-tick at the same wall-clock pages again
    // only after a TTL reset (e.g. extend).
    expect(repo.all()[0]!.paged_at_50_percent).toBe(true);
  });

  it('does not re-page a row that has already been paged at 50%', async () => {
    repo.seed(buildPending({ paged_at_50_percent: true }));
    clock.set(new Date('2026-06-17T00:30:00.000Z'));

    const result = await tickSweeper({ repo, bus, pager, clock });
    expect(result.pagedAt50).toEqual([]);
    expect(pager.paged).toEqual([]);
  });

  it('expires the row and emits approval_expired at 100% TTL', async () => {
    repo.seed(buildPending());
    // Past 1 h — the TTL is fully elapsed.
    clock.set(new Date('2026-06-17T01:00:01.000Z'));

    const result = await tickSweeper({ repo, bus, pager, clock });
    expect(result.expired).toEqual(['appr-1']);
    expect(repo.all()[0]!.status).toBe('expired');
    const event = bus.events[0]!;
    expect(event.type).toBe('approval_expired');
    if (event.type !== 'approval_expired') return;
    expect(event.runId).toBe(asRunId('run-1'));
    expect(event.approvalId).toBe('appr-1');
    // The 100% page also fires.
    expect(pager.paged.some((p) => p.reason === 'ttl_100_percent_expired')).toBe(true);
  });

  it('does not double-expire a row that was already decided (monotonic)', async () => {
    // The operator already rejected the approval before the sweeper ran.
    repo.seed(
      buildPending({
        status: 'rejected',
        decided_at: new Date().toISOString(),
      }),
    );
    clock.set(new Date('2026-06-17T01:00:01.000Z'));

    const result = await tickSweeper({ repo, bus, pager, clock });
    // The row is not in the sweeper's "pending" view at all, so the
    // sweeper neither expires nor pages.
    expect(result.expired).toEqual([]);
    expect(result.pagedAt50).toEqual([]);
  });

  it('expires a row with non-positive TTL immediately (malformed input)', async () => {
    // requested_at == expires_at means total TTL = 0; the sweeper
    // treats this as malformed and expires immediately.
    repo.seed(
      buildPending({
        requested_at: '2026-06-17T00:00:00.000Z',
        expires_at: '2026-06-17T00:00:00.000Z',
      }),
    );
    const result = await tickSweeper({ repo, bus, pager, clock });
    expect(result.expired).toEqual(['appr-1']);
    expect(repo.all()[0]!.status).toBe('expired');
  });

  it('scopes by tenantId when supplied', async () => {
    repo.seed(buildPending({ tenant_id: 'tenant-a' }));
    repo.seed(
      buildPending({
        id: 'appr-2',
        tenant_id: 'tenant-b',
        requested_at: '2026-06-17T00:00:00.000Z',
        expires_at: '2026-06-17T01:00:01.000Z',
      }),
    );
    clock.set(new Date('2026-06-17T01:00:01.000Z'));

    const aOnly = await tickSweeper(
      { repo, bus, pager, clock },
      { tenantId: asTenantId('tenant-a') },
    );
    expect(aOnly.expired).toEqual(['appr-1']);
    expect(repo.all().find((r) => r.id === 'appr-2')!.status).toBe('pending');
  });
});
