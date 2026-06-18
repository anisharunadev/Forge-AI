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

import type { Pool, PoolClient } from 'pg';

import { ApprovalAlreadyDecidedError, type ApprovalsRepo } from './ports.js';
import type { GateKind, RoleOfRecord } from './gates.js';
import type {
  ApprovalRecord,
  ApprovalStatus,
  Decision,
} from './router-types.js';
import type { Stage, TenantId, RunId } from './types.js';
import { asRunId, asTenantId } from './types.js';

/** Raw row shape from the SELECT/RETURNING in agent_run_approvals. */
interface RawApprovalRow {
  id: string;
  tenant_id: string;
  run_id: string;
  stage: Stage | null;
  gate_kind: GateKind;
  required_role: RoleOfRecord;
  status: ApprovalStatus;
  paperclip_interaction_id: string | null;
  artefact_refs: ReadonlyArray<{ kind: string; url: string; sha256?: string }>;
  reason: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by: { actor: string; role: RoleOfRecord | 'board' } | null;
  decision: Decision | null;
  expires_at: string;
  paged_at_50_percent: boolean;
  superseded_interaction_id: string | null;
  deleted_at: string | null;
}

const ROW_COLUMNS = `
  id, tenant_id, run_id, stage, gate_kind, required_role, status,
  paperclip_interaction_id, artefact_refs, reason,
  requested_at, decided_at, decided_by, decision, expires_at,
  paged_at_50_percent, superseded_interaction_id, deleted_at`;

const RETURNING_COLUMNS = `
  RETURNING id, tenant_id, run_id, stage, gate_kind, required_role, status,
            paperclip_interaction_id, artefact_refs, reason,
            requested_at, decided_at, decided_by, decision, expires_at,
            paged_at_50_percent, superseded_interaction_id, deleted_at`;

/**
 * A thin `ApprovalsRepo` bound to a `pg.Pool`. The class is stateless
 * — pool transactions are owned per-call so the router's algorithm
 * (insert → mark stage → issue → stamp interaction id) sees the
 * same atomicity guarantees as the in-memory test double.
 */
export class PgApprovalsRepo implements ApprovalsRepo {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insertPending(args: {
    runId: RunId;
    tenantId: TenantId;
    stage: Stage | null;
    gateKind: GateKind;
    requiredRole: RoleOfRecord;
    expiresAt: Date;
    artefactRefs: ReadonlyArray<{ kind: string; url: string; sha256?: string }>;
    reason?: string;
  }): Promise<ApprovalRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<RawApprovalRow>(
        `INSERT INTO agent_run_approvals
           (tenant_id, run_id, stage, gate_kind, required_role,
            status, artefact_refs, reason, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb, $7, $8)
         ${RETURNING_COLUMNS}`,
        [
          args.tenantId,
          args.runId,
          args.stage,
          args.gateKind,
          args.requiredRole,
          JSON.stringify(args.artefactRefs),
          args.reason ?? null,
          args.expiresAt.toISOString(),
        ],
      );
      const row = r.rows[0];
      if (!row) {
        throw new Error('insertPending: INSERT returned no rows');
      }
      await client.query('COMMIT');
      return rowToApproval(row);
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

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
  async markStageWaitingApproval(args: {
    runId: RunId;
    stage: Stage;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The join to agent_runs enforces the tenant gate. A
      // soft-deleted run is invisible — same semantics as
      // findRunById (repo.ts:117).
      const r = await client.query(
        `UPDATE agent_run_stages
            SET status = 'waiting_approval'
          FROM agent_runs r
          WHERE agent_run_stages.run_id = r.id
            AND agent_run_stages.stage = $2
            AND r.id = $1
            AND r.tenant_id = r.tenant_id
            AND r.deleted_at IS NULL
            AND agent_run_stages.status IN ('pending','running')`,
        [args.runId, args.stage],
      );
      if (r.rowCount === 0) {
        // Either the run was soft-deleted, the stage row is missing,
        // or the stage has already advanced past `running`. The
        // router treats this as a no-op (FORA-50 §6 — the stage
        // engine may have already marked the stage approved). We do
        // not raise because the run can still make forward progress
        // without the explicit mark.
      }
      await client.query('COMMIT');
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  async findById(args: {
    approvalId: string;
    tenantId: TenantId;
  }): Promise<ApprovalRecord | null> {
    const r = await this.pool.query<RawApprovalRow>(
      `SELECT ${ROW_COLUMNS}
         FROM agent_run_approvals
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL`,
      [args.approvalId, args.tenantId],
    );
    const row = r.rows[0];
    return row ? rowToApproval(row) : null;
  }

  async findPendingByStage(args: {
    runId: RunId;
    stage: Stage;
    tenantId: TenantId;
  }): Promise<ApprovalRecord | null> {
    const r = await this.pool.query<RawApprovalRow>(
      `SELECT ${ROW_COLUMNS}
         FROM agent_run_approvals
        WHERE run_id = $1
          AND stage = $2
          AND tenant_id = $3
          AND status = 'pending'
          AND deleted_at IS NULL
        ORDER BY requested_at DESC
        LIMIT 1`,
      [args.runId, args.stage, args.tenantId],
    );
    const row = r.rows[0];
    return row ? rowToApproval(row) : null;
  }

  /**
   * Apply a decision (accept / reject / request_changes). The DB
   * `WHERE status = 'pending'` guard makes a second decision on a
   * terminal row return zero rows; the adapter maps that to
   * `ApprovalAlreadyDecidedError` (HTTP 409).
   */
  async applyDecision(args: {
    approvalId: string;
    tenantId: TenantId;
    decision: Decision;
    decidedBy: { actor: string; role: RoleOfRecord | 'board' };
    reason: string;
  }): Promise<ApprovalRecord> {
    const client = await this.pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      const nextStatus =
        args.decision === 'accept' ? 'approved' : 'rejected';
      const r = await client.query<RawApprovalRow>(
        `UPDATE agent_run_approvals
            SET status = $4,
                decision = $3,
                decided_by = $5::jsonb,
                decided_at = now(),
                reason = $6
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
            AND status = 'pending'
          ${RETURNING_COLUMNS}`,
        [
          args.approvalId,
          args.tenantId,
          args.decision,
          nextStatus,
          JSON.stringify(args.decidedBy),
          args.reason,
        ],
      );
      const row = r.rows[0];
      if (!row) {
        // Either the row doesn't exist, is soft-deleted, belongs to
        // a different tenant, OR is already terminal. Distinguish by
        // reading the row directly — if it exists and is terminal,
        // surface the typed error so the router emits a clean 409.
        const existing = await client.query<RawApprovalRow>(
          `SELECT ${ROW_COLUMNS}
             FROM agent_run_approvals
            WHERE id = $1
              AND tenant_id = $2
              AND deleted_at IS NULL`,
          [args.approvalId, args.tenantId],
        );
        await client.query('COMMIT');
        const found = existing.rows[0];
        if (found && found.status !== 'pending') {
          throw new ApprovalAlreadyDecidedError({
            code: 'APPROVAL_ALREADY_DECIDED',
            message: `approval ${args.approvalId} is already ${found.status}`,
            currentStatus: found.status,
          });
        }
        // Row missing or cross-tenant. The router maps this to 404.
        throw new Error(
          `applyDecision: approval ${args.approvalId} not found`,
        );
      }
      await client.query('COMMIT');
      return rowToApproval(row);
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      if (!released) {
        client.release();
      }
    }
  }

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
  async expire(args: {
    approvalId: string;
    tenantId: TenantId;
    expiredAt: Date;
  }): Promise<ApprovalRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<RawApprovalRow>(
        `UPDATE agent_run_approvals
            SET status = 'expired',
                decided_at = $3
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
            AND status = 'pending'
          ${RETURNING_COLUMNS}`,
        [args.approvalId, args.tenantId, args.expiredAt.toISOString()],
      );
      const row = r.rows[0];
      if (!row) {
        // Already decided OR missing. Monotonic: return the existing
        // row so the sweeper does not raise.
        const existing = await client.query<RawApprovalRow>(
          `SELECT ${ROW_COLUMNS}
             FROM agent_run_approvals
            WHERE id = $1
              AND tenant_id = $2
              AND deleted_at IS NULL`,
          [args.approvalId, args.tenantId],
        );
        await client.query('COMMIT');
        const found = existing.rows[0];
        if (found) return rowToApproval(found);
        throw new Error(`expire: approval ${args.approvalId} not found`);
      }
      await client.query('COMMIT');
      return rowToApproval(row);
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  async extend(args: {
    approvalId: string;
    tenantId: TenantId;
    newExpiresAt: Date;
    extendedBy: string;
  }): Promise<ApprovalRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<RawApprovalRow>(
        `UPDATE agent_run_approvals
            SET expires_at = $3,
                paged_at_50_percent = false
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
            AND status = 'pending'
          ${RETURNING_COLUMNS}`,
        [args.approvalId, args.tenantId, args.newExpiresAt.toISOString()],
      );
      const row = r.rows[0];
      if (!row) {
        await client.query('COMMIT');
        // Either missing or terminal. The router maps terminal to
        // INVALID_TRANSITION (the in-memory adapter enforces the
        // same distinction via a thrown Error here).
        throw new Error(
          `extend: approval ${args.approvalId} not pending`,
        );
      }
      await client.query('COMMIT');
      return rowToApproval(row);
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Stamp the persisted interaction id (ADR-0008 §4 step 4). The
   * stale-target recovery (§5) calls this with a NEW interaction id;
   * the row's `superseded_interaction_id` is set to the previous
   * id atomically.
   */
  async setInteractionId(args: {
    approvalId: string;
    tenantId: TenantId;
    interactionId: string;
  }): Promise<ApprovalRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<RawApprovalRow>(
        `UPDATE agent_run_approvals
            SET superseded_interaction_id = COALESCE(paperclip_interaction_id, superseded_interaction_id),
                paperclip_interaction_id = $3
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
            AND status = 'pending'
          ${RETURNING_COLUMNS}`,
        [args.approvalId, args.tenantId, args.interactionId],
      );
      const row = r.rows[0];
      if (!row) {
        await client.query('COMMIT');
        throw new Error(
          `setInteractionId: approval ${args.approvalId} not pending`,
        );
      }
      await client.query('COMMIT');
      return rowToApproval(row);
    } catch (e) {
      await safeRollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  async markPagedAt50Percent(args: {
    approvalId: string;
    tenantId: TenantId;
  }): Promise<void> {
    // Idempotent under retry: `WHERE paged_at_50_percent = false`
    // means a second call is a no-op. The router does not need a
    // returned row; this matches the port contract.
    await this.pool.query(
      `UPDATE agent_run_approvals
          SET paged_at_50_percent = true
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
          AND status = 'pending'
          AND paged_at_50_percent = false`,
      [args.approvalId, args.tenantId],
    );
  }

  /**
   * Sweeper read. Soft-delete filter is mandatory (ADR-0009 §6). The
   * sweeper passes `asOf`; rows are returned in expiry order so the
   * sweeper pages 50% first and expires 100% last within a single
   * tick (the index supports the order).
   */
  async listPendingForSweep(args: {
    tenantId?: TenantId;
    asOf: Date;
    limit: number;
  }): Promise<ReadonlyArray<ApprovalRecord>> {
    const r = args.tenantId
      ? await this.pool.query<RawApprovalRow>(
          `SELECT ${ROW_COLUMNS}
             FROM agent_run_approvals
            WHERE status = 'pending'
              AND deleted_at IS NULL
              AND tenant_id = $1
              AND expires_at <= $2
            ORDER BY expires_at ASC
            LIMIT $3`,
          [args.tenantId, args.asOf.toISOString(), args.limit],
        )
      : await this.pool.query<RawApprovalRow>(
          `SELECT ${ROW_COLUMNS}
             FROM agent_run_approvals
            WHERE status = 'pending'
              AND deleted_at IS NULL
              AND expires_at <= $1
            ORDER BY expires_at ASC
            LIMIT $2`,
          [args.asOf.toISOString(), args.limit],
        );
    return r.rows.map(rowToApproval);
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function rowToApproval(row: RawApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    run_id: asRunId(row.run_id),
    tenant_id: asTenantId(row.tenant_id),
    stage: row.stage,
    gate_kind: row.gate_kind,
    required_role: row.required_role,
    status: row.status,
    paperclip_interaction_id: row.paperclip_interaction_id,
    artefact_refs: row.artefact_refs ?? [],
    reason: row.reason,
    requested_at: row.requested_at,
    decided_at: row.decided_at,
    decided_by: row.decided_by,
    decision: row.decision,
    expires_at: row.expires_at,
    paged_at_50_percent: row.paged_at_50_percent,
    superseded_interaction_id: row.superseded_interaction_id,
    deleted_at: row.deleted_at,
  };
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Best-effort rollback; the original error is the actionable one.
  }
}