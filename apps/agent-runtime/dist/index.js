/**
 * Public surface of the FORA Agent Runtime.
 *
 * Per §9 of the design doc, the public surface is:
 *   - `createRuntime(opts)` — the factory
 *   - `Runtime.registerAgent(definition)` — boot-time validated
 *   - `Runtime.invoke(agentId, inputs)` — runs the stage machine
 *   - `Runtime.cancel(runId, reason?)` — external cancel entry (0.2.3)
 *
 * 0.2.3 surfaces:
 *   - Retry policy (`RetryableError`, `withRetry`, `computeBackoff`).
 *   - Idempotency store (`LruIdempotencyStore`, `IdempotencyStore`).
 *   - Budget meter (`BudgetMeter`, `BudgetExceededError`, `Budget`).
 *   - Cancellation token (`InMemoryCancelTokenRegistry`, `CancelToken`).
 *
 * 0.1.2 surfaces (FORA-135, Master Orchestrator stage transition engine):
 *   - `advanceStage(request, deps)` — the typed gRPC seam per ADR-0007.
 *   - The seven-stage spine + run-lifecycle state machine + invalid
 *     transition guard + return primitive + idempotency replay.
 *
 * Consumers import from this barrel. The deeper modules (`gateway`,
 * `validator`, `run-record`, `stages`, `retry`, `idempotency`, `budget`,
 * `cancel`) are intentionally NOT re-exported here; the lint rule
 * `no-direct-handlers` blocks imports of handler internals from outside
 * the runtime package.
 */
export { createRuntime } from './runtime.js';
export { AgentAlreadyRegisteredError, UnknownAgentError, IdempotencyMissingError } from './runtime.js';
export { asAgentId, asIdempotencyKey, asRunId, asStepId, asToolName, asToolResult, makeError, } from './types.js';
export { FileSystemRunRecordSink, InMemoryRunRecordSink, } from './run-record.js';
// ---- 0.2.3 surfaces --------------------------------------------------------
// Retry
export { RetryableError, CancelledError, computeBackoff, isRetryable, toCancelledTypedError, withRetry, } from './retry.js';
// Idempotency
export { LruIdempotencyStore, NullIdempotencyStore, } from './idempotency.js';
// Budget
export { BudgetExceededError, BudgetMeter, UnlimitedBudgetMeter, toBudgetExceededTypedError, } from './budget.js';
// Cancel
export { InMemoryCancelTokenRegistry, } from './cancel.js';
// ---- 0.1.2 surfaces (FORA-135 Master Orchestrator stage engine) -------------
export { 
// Stage transition engine (the typed gRPC seam)
advanceStage, 
// Pure helpers
classify, enumerateTransitionCases, isValidNext, isValidReturn, nextStage, step, runStateAfterDecision, 
// Constants
STAGE_SPINE, TERMINAL_STAGE, TERMINAL_RUN_STATES, 
// Typed errors
InvalidDecisionError, InvalidTransitionError, ReturnToInvalidStageError, RunNotFoundError, RunNotRunningError, StageMismatchError, isOrchestratorError, 
// In-memory ports for first-pass wiring (CTO ship; production swaps to
// FORA-30 Postgres + FORA-36 NATS per ADR-0006 / ADR-0007)
InMemoryEventBus, InMemoryIdempotencyStore, InMemoryRunStore, defaultDeps, } from './orchestrator/index.js';
//# sourceMappingURL=index.js.map