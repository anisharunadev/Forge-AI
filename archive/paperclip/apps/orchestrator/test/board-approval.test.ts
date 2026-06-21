/**
 * Board-approval tests — FORA-137 acceptance bar #5.
 *
 * "A board approval is recorded as `request_board_approval` and the
 * run does not advance until the approval record exists."
 *
 * The bar has two halves:
 *   1. The router issues `request_board_approval` for the launch gate
 *      (not `request_confirmation`).
 *   2. The interaction is issued only AFTER the pending row is
 *      persisted to `agent_run_approvals`. A retry that finds the
 *      row already present is a no-op.
 *
 * Acceptance: this test exercises both halves. The launch gate is
 * the only `board` gate; the run does not advance on issue (the
 * advance happens on accept, which the test also exercises).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  InMemoryApprovalsRepo,
  RecordingEventBus,
  RecordingPager,
  RecordingPaperclipClient,
  TestClock,
} from '../src/test-doubles.js';
import { decide, routeGate } from '../src/router.js';
import { asIdempotencyKey, asRunId, asTenantId } from '../src/types.js';

const TENANT = asTenantId('tenant-1');
const RUN = asRunId('run-1');
const KEY = asIdempotencyKey('00000000-0000-4000-8000-000000000003');

function buildDeps() {
  const clock = new TestClock();
  return {
    repo: new InMemoryApprovalsRepo(clock),
    paperclip: new RecordingPaperclipClient(),
    bus: new RecordingEventBus(),
    pager: new RecordingPager(),
    clock,
  };
}

const ctx = {
  tenantId: TENANT,
  runId: RUN,
  orchestratorIssueId: 'issue-board-1',
  planRevisionId: 'rev-1-board',
  artefactRefs: [
    { kind: 'release_notes', url: 'https://confluence.example/x' },
  ],
  reason: 'v1.0 launch',
};

describe('board approval gate', () => {
  let deps: ReturnType<typeof buildDeps>;

  beforeEach(() => {
    deps = buildDeps();
  });

  it('issues a request_board_approval interaction (not request_confirmation)', async () => {
    await routeGate(deps, ctx, 'launch');
    expect(deps.paperclip.issued).toHaveLength(1);
    const interaction = deps.paperclip.issued[0]!.interaction;
    expect(interaction.kind).toBe('request_board_approval');
    expect(interaction.continuationPolicy).toBe('wake_assignee_on_accept');
  });

  it('persists the pending row before issuing the interaction', async () => {
    const events: string[] = [];
    const origInsert = deps.repo.insertPending.bind(deps.repo);
    deps.repo.insertPending = async (a) => {
      events.push('insertPending');
      return origInsert(a);
    };
    const origIssue = deps.paperclip.issue.bind(deps.paperclip);
    deps.paperclip.issue = async (a) => {
      events.push('paperclip.issue');
      return origIssue(a);
    };
    await routeGate(deps, ctx, 'launch');
    expect(events).toEqual(['insertPending', 'paperclip.issue']);
    // The row exists with the right role + primitive mirror.
    expect(deps.repo.all()).toHaveLength(1);
    const row = deps.repo.all()[0]!;
    expect(row.required_role).toBe('board');
    expect(row.status).toBe('pending');
  });

  it('does NOT advance the run on issue; the run waits on the approval row', async () => {
    await routeGate(deps, ctx, 'launch');
    // The run does not advance until decide(accept). The router
    // only returns the persisted record + interaction id; the
    // stage engine (FORA-135) reads the approval's status to know
    // whether to advance.
    const row = deps.repo.all()[0]!;
    expect(row.status).toBe('pending');
    // No `gate_passed` / `approval_decided` events yet.
    expect(
      deps.bus.events.some((e) => e.type === 'approval_decided'),
    ).toBe(false);
  });

  it('accept transitions the approval to approved and the row records the decision', async () => {
    await routeGate(deps, ctx, 'launch');
    const approvalId = deps.repo.all()[0]!.id;
    const out = await decide(deps, {
      approvalId,
      tenantId: TENANT,
      decision: 'accept',
      reason: 'board approves v1.0 launch',
      decidedBy: { actor: 'board', role: 'board' },
      idempotencyKey: KEY,
    });
    expect(out.approval.status).toBe('approved');
    expect(out.approval.decision).toBe('accept');
    expect(out.approval.decided_by?.role).toBe('board');
  });

  it('uses the launch idempotencyKey: approval:{run_id}:launch', async () => {
    await routeGate(deps, ctx, 'launch');
    expect(deps.paperclip.issued[0]!.interaction.idempotencyKey).toBe(
      `approval:${RUN}:launch`,
    );
  });

  it('uses the 24 h board TTL on the persisted row', async () => {
    await routeGate(deps, ctx, 'launch');
    const row = deps.repo.all()[0]!;
    const ttlMs =
      new Date(row.expires_at).getTime() -
      new Date(row.requested_at).getTime();
    expect(ttlMs).toBe(24 * 60 * 60 * 1000);
  });
});
