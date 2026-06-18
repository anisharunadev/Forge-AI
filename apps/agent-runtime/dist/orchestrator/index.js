/**
 * Public surface of the FORA Master Orchestrator — stage transition engine.
 *
 * First-pass CTO module (FORA-135). The greenfield monorepo split called
 * out in FORA-50 spec §2.0 lands in a follow-up sub-task; this barrel is
 * the v0.1.2 surface that future `fora-orchestrator/` will inherit
 * unchanged.
 *
 * What's exported:
 *   - `advanceStage(request, deps)` — the typed gRPC seam (ADR-0007 §6).
 *   - `STAGE_SPINE`, `nextStage`, `isValidNext`, `isValidReturn`,
 *     `classify`, `enumerateTransitionCases` — the pure transition table.
 *   - `step`, `runStateAfterDecision`, `TERMINAL_RUN_STATES` — the run
 *     lifecycle state machine.
 *   - Typed errors (InvalidTransitionError, StageMismatchError, …) for the
 *     gRPC adapter to map to status codes (ADR-0007 §8).
 *   - In-memory port implementations so the engine can be exercised
 *     end-to-end before the Postgres / NATS sub-goals land (FORA-30,
 *     FORA-36).
 *   - All event / decision / stage / run-state types.
 *
 * What's NOT exported (intentional):
 *   - The proto file lives at `proto/orchestrator.proto`; generated stubs
 *     are not committed in this first-pass and the gRPC server adapter is
 *     a follow-up sub-task. The shapes here ARE the wire types the
 *     adapter maps to/from.
 */
export { advanceStage, nextStage as advanceStageNextStage, TERMINAL_STAGE as advanceStageTerminalStage } from './advance-stage.js';
export { STAGE_SPINE, classify, enumerateTransitionCases, indexOfStage, isValidNext, isValidReturn, nextStage, TERMINAL_STAGE, } from './stage-table.js';
export { step, runStateAfterDecision, TERMINAL_RUN_STATES, } from './state-machine.js';
export { asActorId, asEventId, asIdempotencyKey, asRunId, asTenantId, } from './types.js';
export { InvalidDecisionError, InvalidTransitionError, isOrchestratorError, ReturnToInvalidStageError, RunNotFoundError, RunNotRunningError, StageMismatchError, } from './errors.js';
export { InMemoryEventBus, InMemoryIdempotencyStore, InMemoryRunStore, defaultDeps, } from './memory-ports.js';
//# sourceMappingURL=index.js.map