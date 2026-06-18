/**
 * Postgres adapter for the `ApprovalsRepo` port.
 *
 * FORA-137 acceptance bar #6a — the integration half of "Persist
 * pending approvals to `agent_run_approvals` first, then issue the
 * interaction." The schema lives in `packages/db-migrator/
 * migrations/0004_agent_run_approvals.sql`; this adapter is the
 * sole writer.
 *
 * Invariants the adapter enforces:
 *
 *   1. The (run_id, gate_kind) EXCLUDE constraint at the DB layer is
 *      the dedupe boundary for stale-target recovery. Re-issue on the
 *      same revision hits the unique and the JS layer recognises it
 *      as a no-op; re-issue on a new revision updates the row in
 *      place (`paperclip_interaction_id` flips, the old id moves to
 *      `superseded_interaction_id`).
 *   2. Soft-delete filter (`deleted_at IS NULL`) is mandatory on every
 *      read. ADR-0009 §6.
 *   3. Tenant gate enforced by joining to `agent_runs`. Cross-tenant
 *      lookups return `null` — the API maps to 404, not 403.
 *   4. The transition guard (`pending → approved/rejected/expired`)
 *      uses `WHERE status = 'pending'` on the UPDATE so a decided
 *      row can't be re-decided. The unique-violation path surfaces
 *      as `ApprovalAlreadyDecidedError` to the router.
 *   5. `markStageWaitingApproval` runs in the same transaction as
 *      `insertPending` so the pair is durable; the router's algorithm
 *      (§4 step 1 + 2) depends on this.
 */
import type { Pool } from 'pg';
import { type ApprovalsRepo } from './ports.js';
import type { GateKind, RoleOfRecord } from './gates.js';
import type { ApprovalRecord, Decision } from './router-types.js';
import type { Stage, TenantId, RunId } from './types.js';
/**
 * A thin `ApprovalsRepo` bound to a `pg.Pool`. The class is stateless
 * — pool transactions are owned per-call so the router's algorithm
 * (insert → mark stage → issue → stamp interaction id) sees the
 * same atomicity guarantees as the in-memory test double.
 */
export declare class PgApprovalsRepo implements ApprovalsRepo {
    private readonly pool;
    constructor(pool: Pool);
    insertPending(args: {
        runId: RunId;
        tenantId: TenantId;
        stage: Stage | null;
        gateKind: GateKind;
        requiredRole: RoleOfRecord;
        expiresAt: Date;
        artefactRefs: ReadonlyArray<{
            kind: string;
            url: string;
            sha256?: string;
        }>;
        reason?: string;
    }): Promise<ApprovalRecord>;
    /**
     * Stage-status transition (FORA-50 §6 + ADR-0008 §4 step 2).
     *
     * The atomicity here matters: the router calls `insertPending` then
     * `markStageWaitingApproval` in sequence. A crash between the two
     * leaves the run with a pending approval but the stage row still
     * `running`. The router's recovery sweep (FORA-134) re-runs the
     * algorithm on boot and finds the approval row; the stage row's
     * status is reconciled by this call being idempotent under
     * `WHERE status IN ('pending','running')`.
     */
    markStageWaitingApproval(args: {
        runId: RunId;
        stage: Stage;
    }): Promise<void>;
    findById(args: {
        approvalId: string;
        tenantId: TenantId;
    }): Promise<ApprovalRecord | null>;
    findPendingByStage(args: {
        runId: RunId;
        stage: Stage;
        tenantId: TenantId;
    }): Promise<ApprovalRecord | null>;
    /**
     * Apply a decision (accept / reject / request_changes). The DB
     * `WHERE status = 'pending'` guard makes a second decision on a
     * terminal row return zero rows; the adapter maps that to
     * `ApprovalAlreadyDecidedError` (HTTP 409).
     */
    applyDecision(args: {
        approvalId: string;
        tenantId: TenantId;
        decision: Decision;
        decidedBy: {
            actor: string;
            role: RoleOfRecord | 'board';
        };
        reason: string;
    }): Promise<ApprovalRecord>;
    /**
     * Expire the row. Per ADR-0008 §4 step 7 the run is also paused,
     * but the run-status update is owned by the stage engine (FORA-135);
     * this adapter only stamps the approval row. The sweeper calls
     * `listPendingForSweep` with `asOf` past the TTL; this method
     * performs the row flip. Like `applyDecision`, the `WHERE
     * status = 'pending'` guard makes a re-expire on a decided row a
     * no-op (monotonic — the in-memory test double enforces the same
     * invariant).
     */
    expire(args: {
        approvalId: string;
        tenantId: TenantId;
        expiredAt: Date;
    }): Promise<ApprovalRecord>;
    extend(args: {
        approvalId: string;
        tenantId: TenantId;
        newExpiresAt: Date;
        extendedBy: string;
    }): Promise<ApprovalRecord>;
    /**
     * Stamp the persisted interaction id (ADR-0008 §4 step 4). The
     * stale-target recovery (§5) calls this with a NEW interaction id;
     * the row's `superseded_interaction_id` is set to the previous
     * id atomically.
     */
    setInteractionId(args: {
        approvalId: string;
        tenantId: TenantId;
        interactionId: string;
    }): Promise<ApprovalRecord>;
    markPagedAt50Percent(args: {
        approvalId: string;
        tenantId: TenantId;
    }): Promise<void>;
    /**
     * Sweeper read. Soft-delete filter is mandatory (ADR-0009 §6). The
     * sweeper passes `asOf`; rows are returned in expiry order so the
     * sweeper pages 50% first and expires 100% last within a single
     * tick (the index supports the order).
     */
    listPendingForSweep(args: {
        tenantId?: TenantId;
        asOf: Date;
        limit: number;
    }): Promise<ReadonlyArray<ApprovalRecord>>;
}
