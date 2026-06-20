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
export type { Runtime, RuntimeOpts } from './runtime.js';
export { AgentAlreadyRegisteredError, UnknownAgentError, IdempotencyMissingError } from './runtime.js';

// ---- Re-exports for the public surface -------------------------------------

export type {
  AgentId,
  CancelToken,
  IdempotencyKey,
  Observation,
  Plan,
  PlanStep,
  Reflection,
  RegisteredHandler,
  RunId,
  RunInputs,
  RunRecord,
  RunRecordStep,
  SideEffect,
  Stage,
  StagePolicy,
  StepId,
  SubAgentDefinition,
  ToolCtx,
  ToolHandler,
  ToolName,
  ToolResult,
  TypedError,
} from './types.js';
export {
  asAgentId,
  asIdempotencyKey,
  asRunId,
  asStepId,
  asToolName,
  asToolResult,
  makeError,
} from './types.js';
export type { InvokeResult } from './stages.js';
export {
  FileSystemRunRecordSink,
  InMemoryRunRecordSink,
  type RunRecordEvent,
  type RunRecordSink,
} from './run-record.js';

// ---- 0.2.3 surfaces --------------------------------------------------------

// Retry
export {
  RetryableError,
  CancelledError,
  computeBackoff,
  isRetryable,
  toCancelledTypedError,
  withRetry,
  type BackoffOpts,
  type RetryOpts,
} from './retry.js';

// Idempotency
export {
  LruIdempotencyStore,
  NullIdempotencyStore,
  type IdempotencyRecord,
  type IdempotencyStore,
} from './idempotency.js';

// Budget
export {
  BudgetExceededError,
  BudgetMeter,
  UnlimitedBudgetMeter,
  toBudgetExceededTypedError,
  type Budget,
  type LlmUsage,
  type SpendSnapshot,
  type ToolCostHint,
} from './budget.js';

// Cancel
export {
  InMemoryCancelTokenRegistry,
  type CancelTokenRegistry,
} from './cancel.js';

// ---- 0.1.2 surfaces (FORA-135 Master Orchestrator stage engine) -------------

export {
  // Stage transition engine (the typed gRPC seam)
  advanceStage,
  // Pure helpers
  classify,
  enumerateTransitionCases,
  isValidNext,
  isValidReturn,
  nextStage,
  step,
  runStateAfterDecision,
  // Constants
  STAGE_SPINE,
  TERMINAL_STAGE,
  TERMINAL_RUN_STATES,
  // Typed errors
  InvalidDecisionError,
  InvalidTransitionError,
  ReturnToInvalidStageError,
  RunNotFoundError,
  RunNotRunningError,
  StageMismatchError,
  isOrchestratorError,
  // In-memory ports for first-pass wiring (CTO ship; production swaps to
  // FORA-30 Postgres + FORA-36 NATS per ADR-0006 / ADR-0007)
  InMemoryEventBus,
  InMemoryIdempotencyStore,
  InMemoryRunStore,
  defaultDeps,
} from './orchestrator/index.js';
export type {
  AdvanceStageRequest,
  ActorId,
  Classification,
  Decision,
  DecisionKind,
  ErrorEvent,
  EventBusPort,
  EventId,
  GatePassedEvent,
  IdempotencyPort,
  InvalidTransitionEvent,
  OrchestratorDeps,
  OrchestratorError,
  OrchestratorErrorCode,
  OrchestratorEvent,
  OrchestratorEventBase,
  RunAbortedEvent,
  RunEvent,
  RunHeader,
  RunState,
  RunStorePort,
  StageDecisionResponse,
  StageReturnedEvent,
  StageStatus,
  StageTarget,
  TenantId,
  TerminalStage,
  TransitionCase,
  TransitionVerdict,
} from './orchestrator/index.js';

// ---- 0.3.5 surface (FORA-48 §3.5 / FORA-448 — per-tenant scope guard) -
//
// The production wire-up for the per-tenant scope guard. Consumers
// construct the `McpRouter` via `buildProductionMcpRouter`; the two
// adapters fail closed on transport failure so a cross-tenant
// request never reaches the upstream MCP.
export {
  buildProductionMcpRouter,
  type BuildProductionMcpRouterOptions,
} from './mcp_scope_guard.js';
