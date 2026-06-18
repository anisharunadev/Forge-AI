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
import { type GateKind, type RoleOfRecord } from './gates.js';
import { ApprovalAlreadyDecidedError, type ApprovalsRepo, type Clock, type EventBus, type Pager, type PaperclipClient } from './ports.js';
import type { ApprovalRecord, Decision, ReturnTarget } from './router-types.js';
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
    artefactRefs: ReadonlyArray<{
        kind: string;
        url: string;
        sha256?: string;
    }>;
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
export declare function routeGate(deps: RouterDeps, ctx: RouterContext, gateKind: GateKind): Promise<{
    approval: ApprovalRecord;
    interactionId: string;
}>;
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
    decidedBy: {
        actor: string;
        role: RoleOfRecord | 'board';
    };
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
    returned?: {
        fromStage: Stage;
        toStage: Stage;
        reason: string;
    } | undefined;
}
export declare function decide(deps: RouterDeps, args: DecideArgs): Promise<DecideOutcome>;
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
export declare function recoverStaleTarget(deps: RouterDeps, ctx: RouterContext, args: {
    approvalId: string;
    gateKind: GateKind;
    previousInteractionId: string;
    newPlanRevisionId: string;
}): Promise<{
    approval: ApprovalRecord;
    interactionId: string;
}>;
/**
 * Operator cancel — ADR-0008 §8 ("operator cancels a pending approval").
 * Sets status to `rejected` and emits the rejection event. The run
 * transitions to `aborted` per FORA-50 §2.2.
 */
export declare function cancelApproval(deps: RouterDeps, args: {
    approvalId: string;
    tenantId: TenantId;
    operator: string;
    reason: string;
}): Promise<ApprovalRecord>;
/**
 * Operator extend — ADR-0008 §8 ("the operator can extend"). Resets
 * `expires_at` and clears the `paged_at_50_percent` flag so the
 * sweeper pages the approver once more at 50% of the new TTL.
 */
export declare function extendApproval(deps: RouterDeps, args: {
    approvalId: string;
    tenantId: TenantId;
    operator: string;
    additionalTtlMs: number;
}): Promise<ApprovalRecord>;
/** Typed router errors. The HTTP layer maps `code` to a status. */
export type RouterErrorCode = 'APPROVAL_NOT_FOUND' | 'INVALID_TRANSITION' | 'VALIDATION' | 'APPROVAL_ALREADY_DECIDED';
export declare class RouterError extends Error {
    readonly code: RouterErrorCode;
    constructor(code: RouterErrorCode, message: string);
}
export { ApprovalAlreadyDecidedError };
