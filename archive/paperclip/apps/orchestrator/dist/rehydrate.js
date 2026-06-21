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
 *   - A run that violates an internal invariant (no stage rows, or
 *     current_stage outside the seven canonical stages) is skipped
 *     AND logged at warn level so an operator can detect the break.
 *     The skip is silent no longer (FORA-134.1 §5).
 */
import { listActiveRunsForRecovery, listStages } from './repo.js';
import { STAGES_IN_ORDER } from './types.js';
const noopLogger = () => undefined;
/**
 * Build the recovery ticket set for a tenant on boot. Returns one
 * ticket per active run. The list is consumed by the stage engine's
 * recovery loop in FORA-135; this function is the read-side.
 *
 * Data-integrity violations (missing stage rows, current_stage outside
 * the seven canonical stages) are skipped AND emitted at warn level
 * via `logger`. Pass a pino-shaped logger in production; tests can
 * pass a spy. The default logger is a no-op so existing call sites
 * that do not wire one keep working.
 */
export async function buildRecoveryTickets(pool, tenantId, logger = noopLogger) {
    const runs = await listActiveRunsForRecovery(pool, tenantId);
    const tickets = [];
    for (const run of runs) {
        const stages = await listStages(pool, tenantId, run.id);
        if (!stages || stages.length === 0) {
            // The run header exists but no stage rows. This is an
            // invariant violation — `createRun` always seeds the seven
            // rows in one transaction. Log + skip; a future integrity
            // worker will reconcile.
            logger({
                level: 'warn',
                msg: 'rehydrate: skipping run with no stage rows (invariant violation)',
                tenant_id: tenantId,
                run_id: run.id,
                status: run.status,
                current_stage: run.current_stage,
            });
            continue;
        }
        const resumeFrom = stages.find((s) => s.stage === run.current_stage);
        if (!resumeFrom) {
            // The header's current_stage is not in the seven canonical
            // stages; the only valid value that is not in the list is
            // 'done', which is terminal and should not appear in the
            // active set. Log + skip; the integrity worker handles it.
            logger({
                level: 'warn',
                msg: 'rehydrate: skipping run with current_stage outside the seven canonical stages',
                tenant_id: tenantId,
                run_id: run.id,
                status: run.status,
                current_stage: run.current_stage,
                canonical_stages: STAGES_IN_ORDER,
            });
            continue;
        }
        tickets.push({ run, stages, resumeFrom });
    }
    return tickets;
}
//# sourceMappingURL=rehydrate.js.map