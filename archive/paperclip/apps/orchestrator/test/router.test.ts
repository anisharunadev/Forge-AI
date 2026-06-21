/**
 * Router happy-path tests — ADR-0008 §4 algorithm.
 *
 * Covers:
 *   - routeGate persists first, interacts second.
 *   - The idempotencyKey follows the spec (`approval:{run_id}:{stage}`
 *     for per-stage, `approval:{run_id}:launch` for the launch gate).
 *   - The stale_target recovery (§5) re-issues against the latest
 *     revision with the `:rev{N}` suffix.
 *   - The return primitive emits `stage_returned` with the prior stage.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  InMemoryApprovalsRepo,
  RecordingEventBus,
  RecordingPager,
  RecordingPaperclipClient,
  TestClock,
} from '../src/test-doubles.js';
import {
  cancelApproval,
  extendApproval,
  decide,
  recoverStaleTarget,
  routeGate,
  RouterError,
} from '../src/router.js';
import {
  asIdempotencyKey,
  asRunId,
  asTenantId,
  type IdempotencyKey,
  type RunId,
  type TenantId,
} from '../src/types.js';

const TENANT: TenantId = asTenantId('tenant-1');
const RUN: RunId = asRunId('run-1');
const ORCHESTRATOR_ISSUE = 'issue-orchestrator-1';
const PLAN_REVISION_1 = 'rev-1-deadbeef';
const PLAN_REVISION_2 = 'rev-2-cafebabe';
const KEY: IdempotencyKey = asIdempotencyKey(
  '00000000-0000-4000-8000-000000000001',
);

function buildDeps(clock = new TestClock()) {
  // Pass the same clock to the in-memory repo so `requested_at` is
  // stamped from the test clock (not real Date.now()). This makes
  // `expires_at - requested_at` equal the TTL tier exactly.
  const repo = new InMemoryApprovalsRepo(clock);
  const paperclip = new RecordingPaperclipClient();
  const bus = new RecordingEventBus();
  const pager = new RecordingPager();
  return { repo, paperclip, bus, pager, clock };
}

function buildCtx(overrides: Partial<Parameters<typeof routeGate>[1]> = {}) {
  return {
    tenantId: TENANT,
    runId: RUN,
    orchestratorIssueId: ORCHESTRATOR_ISSUE,
    planRevisionId: PLAN_REVISION_1,
    artefactRefs: [
      { kind: 'pr', url: 'https://github.com/fora/repo/pull/42' },
    ],
    reason: 'PR merged + CI green',
    ...overrides,
  };
}

describe('routeGate', () => {
  let deps: ReturnType<typeof buildDeps>;
  let ctx: ReturnType<typeof buildCtx>;

  beforeEach(() => {
    deps = buildDeps();
    ctx = buildCtx();
  });

  it('persists the pending row BEFORE issuing the interaction', async () => {
    const events: string[] = [];
    // Wrap the repo so we can record the call order.
    const originalInsert = deps.repo.insertPending.bind(deps.repo);
    deps.repo.insertPending = async (a) => {
      events.push('insertPending');
      return originalInsert(a);
    };
    const originalIssue = deps.paperclip.issue.bind(deps.paperclip);
    deps.paperclip.issue = async (a) => {
      events.push('paperclip.issue');
      return originalIssue(a);
    };

    await routeGate(deps, ctx, 'dev->qa');
    expect(events).toEqual(['insertPending', 'paperclip.issue']);
  });

  it('emits approval_requested with the typed event shape', async () => {
    const { approval, interactionId } = await routeGate(deps, ctx, 'dev->qa');

    expect(deps.bus.events).toHaveLength(1);
    const event = deps.bus.events[0]!;
    expect(event.type).toBe('approval_requested');
    if (event.type !== 'approval_requested') return;
    expect(event.runId).toBe(RUN);
    expect(event.gateKind).toBe('dev->qa');
    expect(event.requiredRole).toBe('qa');
    expect(event.approvalId).toBe(approval.id);
    expect(event.interactionId).toBe(interactionId);
    expect(event.artefactRefs).toEqual(ctx.artefactRefs);
  });

  it('uses the per-stage idempotencyKey: approval:{run_id}:{stage}', async () => {
    await routeGate(deps, ctx, 'qa->security');
    expect(deps.paperclip.issued).toHaveLength(1);
    expect(deps.paperclip.issued[0]!.interaction.idempotencyKey).toBe(
      `approval:${RUN}:qa->security`,
    );
  });

  it('uses the launch gate idempotencyKey: approval:{run_id}:launch', async () => {
    await routeGate(deps, ctx, 'launch');
    expect(deps.paperclip.issued).toHaveLength(1);
    expect(deps.paperclip.issued[0]!.interaction.idempotencyKey).toBe(
      `approval:${RUN}:launch`,
    );
  });

  it('throws on an unknown gate (programming error)', async () => {
    await expect(
      // Cast to bypass the type guard; we want to assert the runtime
      // safety net on a new gate arriving at the router.
      routeGate(deps, ctx, 'unknown' as Parameters<typeof routeGate>[2]),
    ).rejects.toThrow(/unknown gate/);
  });

  it('sets expires_at per the TTL tier', async () => {
    const { approval } = await routeGate(deps, ctx, 'dev->qa');
    // dev->qa is the engineering_1h tier (1 h).
    const expected =
      deps.clock.now().getTime() + 60 * 60 * 1000;
    const actual = new Date(approval.expires_at).getTime();
    expect(actual).toBe(expected);
  });
});

describe('decide', () => {
  let deps: ReturnType<typeof buildDeps>;
  let ctx: ReturnType<typeof buildCtx>;

  beforeEach(async () => {
    deps = buildDeps();
    ctx = buildCtx();
    await routeGate(deps, ctx, 'dev->qa');
  });

  it('accept transitions the approval to approved and emits approval_decided', async () => {
    const approvalId = deps.repo.all()[0]!.id;
    const out = await decide(deps, {
      approvalId,
      tenantId: TENANT,
      decision: 'accept',
      reason: 'lgtm',
      advanceTo: 'qa',
      decidedBy: { actor: 'dev-owner', role: 'qa' },
      idempotencyKey: KEY,
    });
    expect(out.approval.status).toBe('approved');
    expect(out.approval.decision).toBe('accept');
    expect(deps.bus.events.map((e) => e.type)).toEqual([
      'approval_requested',
      'approval_decided',
    ]);
  });

  it('reject transitions the approval to rejected', async () => {
    const approvalId = deps.repo.all()[0]!.id;
    const out = await decide(deps, {
      approvalId,
      tenantId: TENANT,
      decision: 'reject',
      reason: 'CI red on main',
      decidedBy: { actor: 'qa-lead', role: 'qa' },
      idempotencyKey: KEY,
    });
    expect(out.approval.status).toBe('rejected');
    expect(out.approval.decision).toBe('reject');
  });

  it('request_changes with returnTo emits stage_returned and returns the routing', async () => {
    const approvalId = deps.repo.all()[0]!.id;
    const out = await decide(deps, {
      approvalId,
      tenantId: TENANT,
      decision: 'request_changes',
      reason: 'CTO says: re-open the plan',
      returnTo: { toStage: 'architect', requiredRole: 'cto' },
      decidedBy: { actor: 'cto', role: 'cto' },
      idempotencyKey: KEY,
    });
    expect(out.returned).toEqual({
      fromStage: 'dev',
      toStage: 'architect',
      reason: 'CTO says: re-open the plan',
    });
    const lastEvent = deps.bus.events[deps.bus.events.length - 1]!;
    expect(lastEvent.type).toBe('stage_returned');
  });

  it('request_changes without returnTo raises VALIDATION', async () => {
    const approvalId = deps.repo.all()[0]!.id;
    await expect(
      decide(deps, {
        approvalId,
        tenantId: TENANT,
        decision: 'request_changes',
        reason: 'unspecified',
        decidedBy: { actor: 'qa-lead', role: 'qa' },
        idempotencyKey: KEY,
      }),
    ).rejects.toBeInstanceOf(RouterError);
  });
});

describe('recoverStaleTarget (ADR-0008 §5)', () => {
  let deps: ReturnType<typeof buildDeps>;
  let ctx: ReturnType<typeof buildCtx>;

  beforeEach(async () => {
    deps = buildDeps();
    ctx = buildCtx();
    await routeGate(deps, ctx, 'dev->qa');
  });

  it('re-issues against the new revision with :rev{N} suffix on the idempotencyKey', async () => {
    const row = deps.repo.all()[0]!;
    const previousInteractionId = row.paperclip_interaction_id!;
    const out = await recoverStaleTarget(deps, ctx, {
      approvalId: row.id,
      gateKind: 'dev->qa',
      previousInteractionId,
      newPlanRevisionId: PLAN_REVISION_2,
    });
    expect(out.interactionId).not.toBe(previousInteractionId);
    expect(deps.paperclip.reissued).toHaveLength(1);
    expect(deps.paperclip.reissued[0]!.interaction.idempotencyKey).toBe(
      `approval:${RUN}:dev->qa:rev2`,
    );
    expect(deps.paperclip.reissued[0]!.supersededInteractionId).toBe(
      previousInteractionId,
    );
    // The row's interaction id is updated; the audit chain unbroken.
    const updated = deps.repo.all()[0]!;
    expect(updated.id).toBe(row.id);
    expect(updated.paperclip_interaction_id).toBe(out.interactionId);
    expect(updated.superseded_interaction_id).toBe(previousInteractionId);
  });

  it('raises APPROVAL_NOT_FOUND for an unknown approvalId', async () => {
    await expect(
      recoverStaleTarget(deps, ctx, {
        approvalId: 'appr-does-not-exist',
        gateKind: 'dev->qa',
        previousInteractionId: 'pc-x',
        newPlanRevisionId: PLAN_REVISION_2,
      }),
    ).rejects.toThrow(/APPROVAL_NOT_FOUND|no approval/i);
  });
});

describe('cancelApproval + extendApproval', () => {
  let deps: ReturnType<typeof buildDeps>;
  let ctx: ReturnType<typeof buildCtx>;

  beforeEach(async () => {
    deps = buildDeps();
    ctx = buildCtx();
    await routeGate(deps, ctx, 'dev->qa');
  });

  it('cancelApproval sets the approval to rejected', async () => {
    const approvalId = deps.repo.all()[0]!.id;
    const out = await cancelApproval(deps, {
      approvalId,
      tenantId: TENANT,
      operator: 'sre',
      reason: 'run aborted at the operator level',
    });
    expect(out.status).toBe('rejected');
  });

  it('extendApproval pushes the TTL forward and clears the paged flag', async () => {
    const approvalId = deps.repo.all()[0]!.id;
    // Simulate that the sweeper already paged at 50%.
    deps.repo.all()[0]!.paged_at_50_percent = true;
    const originalExpires = new Date(
      deps.repo.all()[0]!.expires_at,
    ).getTime();
    const out = await extendApproval(deps, {
      approvalId,
      tenantId: TENANT,
      operator: 'sre',
      additionalTtlMs: 30 * 60 * 1000, // 30 minutes
    });
    const newExpires = new Date(out.expires_at).getTime();
    expect(newExpires).toBeGreaterThan(originalExpires);
    expect(out.paged_at_50_percent).toBe(false);
  });

  it('extendApproval on a terminal row raises INVALID_TRANSITION', async () => {
    const approvalId = deps.repo.all()[0]!.id;
    await cancelApproval(deps, {
      approvalId,
      tenantId: TENANT,
      operator: 'sre',
      reason: 'test',
    });
    await expect(
      extendApproval(deps, {
        approvalId,
        tenantId: TENANT,
        operator: 'sre',
        additionalTtlMs: 60_000,
      }),
    ).rejects.toBeInstanceOf(RouterError);
  });
});
