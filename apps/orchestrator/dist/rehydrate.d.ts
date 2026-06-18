/**
 * Boot-time crash recovery — FORA-134 acceptance criterion #4.
 *
 * "On Orchestrator restart, an in-flight run resumes from the last
 *  persisted stage."
 *
 * The rehydration contract is read-only: it lists every non-terminal
 * run for a tenant and returns the last persisted stage per run.
 * The actual resume is the stage engine's job (FORA-135, not in this
 * sub-task); the Orchestrator hands the engine a `RecoveryTicket`
 * per run, and the engine decides what to re-execute.
 *
 * Acceptance:
 *   - A run with status='created' (header written, stages seeded,
 *     no stage started) returns its first stage: `ideation` with
 *     status='pending'.
 *   - A run with status='running' and current_stage='qa' returns the
 *     qa stage row with its persisted status (running / pending /
 *     waiting_approval) so the engine can resume mid-stage.
 *   - A soft-deleted run is invisible — the read path's soft-delete
 *     filter in repo.ts is the single source of truth.
 */
import type { Pool } from 'pg';
import type { RunRecord, StageRecord, TenantId } from './types.js';
export interface RecoveryTicket {
    run: RunRecord;
    /**
     * The seven stage rows for the run, in canonical order. The
     * "current" stage is the one matching `run.current_stage`.
     */
    stages: ReadonlyArray<StageRecord>;
    /**
     * The stage the engine should resume from. Equals
     * `run.current_stage` for non-terminal runs.
     */
    resumeFrom: StageRecord;
}
/**
 * Build the recovery ticket set for a tenant on boot. Returns one
 * ticket per active run. The list is consumed by the stage engine's
 * recovery loop in FORA-135; this function is the read-side.
 */
export declare function buildRecoveryTickets(pool: Pool, tenantId: TenantId): Promise<ReadonlyArray<RecoveryTicket>>;
