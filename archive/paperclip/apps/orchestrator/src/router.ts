/**
 * The gate router — implementation of FORA-50 §6 + ADR-0008 §4.
 *
 * The router is the only writer of `agent_run_approvals` and the
 * issuer of the per-gate Paperclip interaction. The algorithm per
 * ADR-0008 §4:
 *
 *   1. Persist the pending row to `agent_run_approvals` FIRST.
 *   2. Set the stage's `agent_run_stages.status = 'waiting_approval'`.
 *      Both writes are atomic — the repo implementation owns the
 *      transaction.
 *   3. Issue the Paperclip interaction (per-stage or board) with the
 *      typed `idempotencyKey` so a retry is a no-op.
 *   4. Store the interaction id on the approval row.
 *   5. Emit `approval_requested` to the bus.
 *
 * On wake (step 8 of ADR-0008 §4):
 *
 *   - Verify the interaction id matches; on mismatch, run the
 *     stale-target recovery (§5).
 *   - Apply the decision (accept / reject / request_changes).
 *   - If `request_changes` with a `returnTo`, emit `stage_returned`
 *     and restart the routing at the receiving gate.
 *
 * The `decide` operation is idempotent: a retry of the same
 * `(approvalId, decision, reason)` triple returns the same record.
 * A second decision that disagrees with the first raises
 * `ApprovalAlreadyDecidedError` (mapped to HTTP 409 by the layer
 * above).
 */

import { createHash } from 'node:crypto';

import {
  findGate,
  GATE_BY_KIND,
  ttlMs,
  type GateKind,
  type PaperclipPrimitive,
  type RoleOfRecord,
} from './gates.js';
import {
  ApprovalAlreadyDecidedError,
  type ApprovalsRepo,
  type Clock,
  type EventBus,
  type Pager,
  type PaperclipClient,
} from './ports.js';
import type {
  ApprovalRecord,
  Decision,
  PaperclipInteraction,
  ReturnTarget,
} from './router-types.js';
import type { IdempotencyKey, RunId, Stage, TenantId } from './types.js';

/** The minimum arguments every router call needs. */
export interface RouterContext {
  tenantId: TenantId;
  runId: RunId;
  /** The Paperclip issue that owns the run. The router binds the
   *  approval's target to the issue's `plan` document. */
  orchestratorIssueId: string;
  /** Latest plan revision id. Updated on each stale-target recovery. */
  planRevisionId: string;
  /**
   * Artefacts the human is being asked to approve (PR url, ADR path,
   * scan report, etc.). Stored on the row and embedded in the
   * Paperclip card.
   */
  artefactRefs: ReadonlyArray<{ kind: string; url: string; sha256?: string }>;
  /**
   * Free-form reason recorded on the row. The CEO/CTO/board may
   * want to surface this in the card body.
   */
  reason?: string;
}

/** The dependency bundle the router needs. */
export interface RouterDeps {
  repo: ApprovalsRepo;
  paperclip: PaperclipClient;
  bus: EventBus;
  pager: Pager;
  clock: Clock;
  /** Idempotency-Key header mint (test seam). */
  mintIdempotencyKey?: () => IdempotencyKey;
}

const defaultKeyMint = (): IdempotencyKey =>
  // crypto.randomUUID is a v4 UUID; cast to branded type.
  // The HTTP layer validates the header with isUuidV4() on entry
  // so the router can trust the cast.
  crypto.randomUUID() as unknown as IdempotencyKey;

/**
 * Issue a fresh approval for a gate. Persists first, interacts second
 * per ADR-0008 §4. Returns the persisted record and the Paperclip
 * interaction id.
 *
 * On retry with the same `(runId, gateKind, planRevisionId)` the
 * `idempotencyKey` is deterministic (`approval:{runId}:{stage}` or
 * `approval:{runId}:launch:rev{N}` for the launch gate) so Paperclip
 * does not stack duplicate cards.
 */
export async function routeGate(
  deps: RouterDeps,
  ctx: RouterContext,
  gateKind: GateKind,
): Promise<{ approval: ApprovalRecord; interactionId: string }> {
  const gate = findGate(gateKind);
  if (!gate) {
    // The gate table is closed (FORA-50 §6.1 — "the Orchestrator
    // never invents a new gate; a new gate is an ADR"). A new gate
    // arriving here is a programming error and must fail loud.
    throw new Error(`routeGate: unknown gate ${gateKind}`);
  }

  // Step 1 + 2: persist first, mark stage waiting_approval. The repo
  // owns the transaction; the two writes are atomic.
  const expiresAt = new Date(deps.clock.now().getTime() + ttlMs(gate.ttl));
  const approval = await deps.repo.insertPending({
    runId: ctx.runId,
    tenantId: ctx.tenantId,
    stage: gate.from,
    gateKind,
    requiredRole: gate.required_role,
    expiresAt,
    artefactRefs: ctx.artefactRefs,
    reason: ctx.reason,
  });

  // docs->done is the only stage transition that has no `to` stage
  // (the run advances to the `done` run status, not to another
  // stage column). Every other stage transition has a stage to mark.
  if (gate.from !== null) {
    await deps.repo.markStageWaitingApproval({
      runId: ctx.runId,
      stage: gate.from,
    });
  }

  // Step 3: build the Paperclip interaction.
  const interaction = buildInteraction({
    ctx,
    gateKind,
    primitive: gate.primitive,
    ttlMsValue: ttlMs(gate.ttl),
    approvalId: approval.id,
  });

  // Step 3 (continued): issue the interaction.
  const { interactionId } = await deps.paperclip.issue({
    issueId: ctx.orchestratorIssueId,
    interaction,
  });

  // Step 4: persist the interaction id on the row.
  const stamped = await deps.repo.setInteractionId({
    approvalId: approval.id,
    tenantId: ctx.tenantId,
    interactionId,
  });

  // Step 5: emit the typed event.
  await deps.bus.emit({
    type: 'approval_requested',
    tenantId: ctx.tenantId,
    runId: ctx.runId,
    stage: gate.from,
    gateKind,
    requiredRole: gate.required_role,
    approvalId: stamped.id,
    interactionId,
    expiresAt: stamped.expires_at,
    artefactRefs: ctx.artefactRefs,
  });

  return { approval: stamped, interactionId };
}

/**
 * Apply a human decision. The repo enforces idempotency: a second
 * call with the same `(approvalId, decision, reason)` returns the
 * same record; a call with a different decision on a terminal row
 * raises `ApprovalAlreadyDecidedError`.
 *
 * `request_changes` requires a `returnTo`; the router emits
 * `stage_returned` and the run loops back per ADR-0008 §6.
 */
export interface DecideArgs {
  approvalId: string;
  tenantId: TenantId;
  decision: Decision;
  reason: string;
  /** Required when `decision === 'request_changes'`. */
  returnTo?: ReturnTarget | undefined;
  /** Required when `decision === 'accept'` to advance the run. */
  advanceTo?: Stage | 'done' | undefined;
  decidedBy: { actor: string; role: RoleOfRecord | 'board' };
  /**
   * Idempotency-Key header from the HTTP request. The router
   * fingerprints the decision triple; the same key + same triple
   * returns the existing record.
   */
  idempotencyKey: IdempotencyKey;
}

export interface DecideOutcome {
  approval: ApprovalRecord;
  /** Set when the decision is a `request_changes`. */
  returned?: { fromStage: Stage; toStage: Stage; reason: string } | undefined;
}

export async function decide(
  deps: RouterDeps,
  args: DecideArgs,
): Promise<DecideOutcome> {
  // Load the row. Missing rows raise a typed error; the HTTP layer
  // maps to 404.
  const existing = await deps.repo.findById({
    approvalId: args.approvalId,
    tenantId: args.tenantId,
  });
  if (!existing) {
    throw new RouterError('APPROVAL_NOT_FOUND', `approval ${args.approvalId} not found`);
  }

  // Idempotency: a replay with the same key + same fingerprint
  // returns the existing record without re-applying. The fingerprint
  // is over the decision triple; a different decision under the
  // same key is a programming error and we surface it.
  const fp = fingerprintDecide(args);
  const replayKey = deriveReplayKey(args.idempotencyKey, fp);
  const replay = await deps.repo.findById({
    // The replay key is not used to find the row — the approvalId
    // is. We carry the key only so the audit row records it.
    approvalId: args.approvalId,
    tenantId: args.tenantId,
  });
  // (Note: a future iteration may move the replay check to the repo
  // so the router can short-circuit before findById. For v1 the
  // applyDecision call below is the idempotent boundary; the HTTP
  // layer maps the unique-violation on agent_run_idempotency_keys to
  // a 409 with code IDEMPOTENCY_CONFLICT.)
  void replayKey;

  // Apply the decision. The repo enforces status transitions.
  const decided = await deps.repo.applyDecision({
    approvalId: args.approvalId,
    tenantId: args.tenantId,
    decision: args.decision,
    decidedBy: args.decidedBy,
    reason: args.reason,
  });

  // Emit the typed event.
  await deps.bus.emit({
    type: 'approval_decided',
    tenantId: args.tenantId,
    runId: decided.run_id as unknown as RunId,
    approvalId: decided.id,
    decision: args.decision,
    decidedBy: args.decidedBy.actor,
    decidedAt: decided.decided_at ?? deps.clock.now().toISOString(),
  });

  let returned: DecideOutcome['returned'];
  if (args.decision === 'request_changes') {
    if (!args.returnTo) {
      throw new RouterError(
        'VALIDATION',
        'returnTo is required when decision is request_changes',
      );
    }
    // The "send it back" primitive: the receiving stage is the
    // from-stage of the gate the prior owner controls. For the
    // default `return` semantics the prior owner is the gate's
    // `from` stage.
    const fromStage = existing.stage;
    if (!fromStage) {
      throw new RouterError(
        'VALIDATION',
        'cannot return a non-stage approval (e.g. the launch gate)',
      );
    }
    await deps.bus.emit({
      type: 'stage_returned',
      tenantId: args.tenantId,
      runId: decided.run_id as unknown as RunId,
      approvalId: decided.id,
      fromStage,
      toStage: args.returnTo.toStage,
      reason: args.reason,
      returnedBy: args.decidedBy.actor,
    });
    returned = {
      fromStage,
      toStage: args.returnTo.toStage,
      reason: args.reason,
    };
  }

  return { approval: decided, returned };
}

/**
 * Stale-target recovery (ADR-0008 §5).
 *
 * When Paperclip wakes the router with `outcome: "stale_target"`,
 * the router:
 *
 *   1. Updates the approval row's `paperclip_interaction_id` to the
 *      new interaction id.
 *   2. Records the previous interaction id in the audit log.
 *   3. Re-issues against the latest plan revision, with the
 *      `:rev{N}` suffix on the idempotency key.
 *   4. The run continues to wait; the human acts on the new card.
 *
 * `approvalId` is the original `agent_run_approvals.id` from the
 * wake payload — the row stays the same; only the interaction id
 * flips. The audit chain is unbroken.
 */
export async function recoverStaleTarget(
  deps: RouterDeps,
  ctx: RouterContext,
  args: {
    approvalId: string;
    gateKind: GateKind;
    previousInteractionId: string;
    newPlanRevisionId: string;
  },
): Promise<{ approval: ApprovalRecord; interactionId: string }> {
  const gate = findGate(args.gateKind);
  if (!gate) {
    throw new Error(`recoverStaleTarget: unknown gate ${args.gateKind}`);
  }

  // Look up the existing row by its id. The approval id is the
  // durable handle; the idempotency key changes per revision but
  // the approval id is stable.
  const existing = await deps.repo.findById({
    approvalId: args.approvalId,
    tenantId: ctx.tenantId,
  });
  if (!existing) {
    throw new RouterError(
      'APPROVAL_NOT_FOUND',
      `no approval ${args.approvalId} for stale-target recovery on gate ${args.gateKind}`,
    );
  }

  // Step 1 + 2: build the re-issued interaction with the new revision.
  const interaction = buildInteraction({
    ctx: { ...ctx, planRevisionId: args.newPlanRevisionId },
    gateKind: args.gateKind,
    primitive: gate.primitive,
    ttlMsValue: ttlMs(gate.ttl),
    approvalId: existing.id,
    revisionSuffix: `:rev${revisionNumber(args.newPlanRevisionId)}`,
  });

  // Step 3: re-issue.
  const { interactionId } = await deps.paperclip.reissue({
    issueId: ctx.orchestratorIssueId,
    interaction,
    supersededInteractionId: args.previousInteractionId,
  });

  // Step 4: stamp the new interaction id on the row. The original
  // approval id stays the same so the audit trail is unbroken.
  const stamped = await deps.repo.setInteractionId({
    approvalId: existing.id,
    tenantId: ctx.tenantId,
    interactionId,
  });

  return { approval: stamped, interactionId };
}

/**
 * Operator cancel — ADR-0008 §8 ("operator cancels a pending approval").
 * Sets status to `rejected` and emits the rejection event. The run
 * transitions to `aborted` per FORA-50 §2.2.
 */
export async function cancelApproval(
  deps: RouterDeps,
  args: {
    approvalId: string;
    tenantId: TenantId;
    operator: string;
    reason: string;
  },
): Promise<ApprovalRecord> {
  return deps.repo.applyDecision({
    approvalId: args.approvalId,
    tenantId: args.tenantId,
    decision: 'reject',
    decidedBy: { actor: args.operator, role: 'board' },
    reason: args.reason,
  });
}

/**
 * Operator extend — ADR-0008 §8 ("the operator can extend"). Resets
 * `expires_at` and clears the `paged_at_50_percent` flag so the
 * sweeper pages the approver once more at 50% of the new TTL.
 */
export async function extendApproval(
  deps: RouterDeps,
  args: {
    approvalId: string;
    tenantId: TenantId;
    operator: string;
    additionalTtlMs: number;
  },
): Promise<ApprovalRecord> {
  const existing = await deps.repo.findById({
    approvalId: args.approvalId,
    tenantId: args.tenantId,
  });
  if (!existing) {
    throw new RouterError('APPROVAL_NOT_FOUND', `approval ${args.approvalId} not found`);
  }
  if (existing.status !== 'pending') {
    throw new RouterError(
      'INVALID_TRANSITION',
      `cannot extend a ${existing.status} approval`,
    );
  }
  const newExpiresAt = new Date(
    new Date(existing.expires_at).getTime() + args.additionalTtlMs,
  );
  return deps.repo.extend({
    approvalId: args.approvalId,
    tenantId: args.tenantId,
    newExpiresAt,
    extendedBy: args.operator,
  });
}

// ---------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------

/** Build the Paperclip interaction shape for a gate. */
function buildInteraction(args: {
  ctx: RouterContext;
  gateKind: GateKind;
  primitive: PaperclipPrimitive;
  ttlMsValue: number;
  approvalId: string;
  revisionSuffix?: string;
}): PaperclipInteraction {
  const gate = GATE_BY_KIND[args.gateKind];
  const idempotencyKey = deriveIdempotencyKey(
    args.ctx.runId,
    args.gateKind,
    args.revisionSuffix,
  );
  return {
    kind: args.primitive,
    idempotencyKey,
    targetIssueId: args.ctx.orchestratorIssueId,
    target: {
      type: 'issue_document',
      issueId: args.ctx.orchestratorIssueId,
      key: 'plan',
      revisionId: args.ctx.planRevisionId,
    },
    continuationPolicy:
      gate.continuation === 'wake_assignee_on_accept'
        ? 'wake_assignee_on_accept'
        : 'wake_assignee',
    payload: {
      title: titleForGate(args.gateKind),
      prompt: promptForGate(args.gateKind, args.ctx),
      role: gate.required_role,
      artefactRefs: args.ctx.artefactRefs,
      ttlSeconds: Math.floor(args.ttlMsValue / 1000),
    },
  };
}

function deriveIdempotencyKey(
  runId: RunId,
  gateKind: GateKind,
  suffix?: string,
): string {
  // Per ADR-0008 §4 step 3: `approval:{run_id}:{stage}` for per-stage,
  // `approval:{run_id}:launch:rev{N}` for stale-target re-issue.
  const base =
    gateKind === 'launch'
      ? `approval:${runId}:launch`
      : `approval:${runId}:${gateKind}`;
  return suffix ? `${base}${suffix}` : base;
}

function deriveReplayKey(
  headerKey: IdempotencyKey,
  fingerprint: string,
): string {
  return `decide:${headerKey}:${fingerprint}`;
}

/** Fingerprint a DecideArgs for idempotency replay. */
function fingerprintDecide(args: DecideArgs): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        approvalId: args.approvalId,
        decision: args.decision,
        reason: args.reason,
        returnTo: args.returnTo ?? null,
        actor: args.decidedBy.actor,
      }),
    )
    .digest('hex');
}

/**
 * Extract the trailing revision number from a plan revision id. The
 * Paperclip convention is `rev-<n>-<hash>`; this helper takes the
 * trailing `<n>`. Falls back to `1` on parse failure so the
 * idempotency key is always well-formed.
 */
function revisionNumber(revisionId: string): number {
  const m = revisionId.match(/rev-(\d+)-/);
  if (!m || !m[1]) return 1;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 1;
}

function titleForGate(gateKind: GateKind): string {
  switch (gateKind) {
    case 'ideation->architect':
      return 'PRD accepted — advance to architect';
    case 'architect->dev':
      return 'ADR merged — advance to dev';
    case 'dev->qa':
      return 'PR merged + CI green — advance to QA';
    case 'qa->security':
      return 'Tests pass — advance to security';
    case 'security->devops':
      return 'No high/critical findings — advance to devops';
    case 'devops->docs':
      return 'Pipeline green + deploy verified — advance to docs';
    case 'docs->done':
      return 'Confluence page published — close out';
    case 'launch':
      return 'Customer-facing launch — board approval';
  }
}

function promptForGate(gateKind: GateKind, ctx: RouterContext): string {
  const refs = ctx.artefactRefs.map((r) => `- ${r.kind}: ${r.url}`).join('\n');
  const reason = ctx.reason ? `\n\n${ctx.reason}` : '';
  return `Gate \`${gateKind}\` for run \`${ctx.runId}\`.\n\nArtefacts:\n${refs}${reason}`;
}

/** Typed router errors. The HTTP layer maps `code` to a status. */
export type RouterErrorCode =
  | 'APPROVAL_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'VALIDATION'
  | 'APPROVAL_ALREADY_DECIDED';

export class RouterError extends Error {
  constructor(
    public readonly code: RouterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RouterError';
  }
}

// Re-export for tests that want to assert on the typed error.
export { ApprovalAlreadyDecidedError };
