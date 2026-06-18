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
import { listActiveRunsForRecovery, listStages } from './repo.js';
/**
 * Build the recovery ticket set for a tenant on boot. Returns one
 * ticket per active run. The list is consumed by the stage engine's
 * recovery loop in FORA-135; this function is the read-side.
 */
export async function buildRecoveryTickets(pool, tenantId) {
    const runs = await listActiveRunsForRecovery(pool, tenantId);
    const tickets = [];
    for (const run of runs) {
        const stages = await listStages(pool, tenantId, run.id);
        if (!stages || stages.length === 0) {
            // The run header exists but no stage rows. This is an
            // invariant violation — `createRun` always seeds the seven
            // rows in one transaction. The honest move is to log and
            // skip; a future integrity worker will reconcile.
            continue;
        }
        const resumeFrom = stages.find((s) => s.stage === run.current_stage);
        if (!resumeFrom) {
            // The header's current_stage is not in the seven canonical
            // stages; the only valid value that is not in the list is
            // 'done', which is terminal and should not appear in the
            // active set. Skip; the integrity worker handles it.
            continue;
        }
        tickets.push({ run, stages, resumeFrom });
    }
    return tickets;
}
//# sourceMappingURL=rehydrate.js.map