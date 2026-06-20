/**
 * Public surface of @fora/orchestrator.
 *
 * Per FORA-50 §4.1 the public REST surface is:
 *   POST /v1/runs
 *   GET  /v1/runs/{id}
 *   GET  /v1/runs/{id}/stages
 *   POST /v1/runs/{id}/pause | /resume | /cancel
 *
 * This barrel exposes the server factory + the typed public types +
 * the state machine + the recovery hook so the bin entry point can
 * import from a single path. The deeper modules (repo, idempotency,
 * state-machine, rehydrate) are NOT re-exported by default; the lint
 * rule `no-direct-handlers` will block imports from outside the
 * package in v0.2.
 */
export { buildServer, type OrchestratorDeps } from './server.js';
export { loadConfig, type OrchestratorConfig } from './config.js';
export { buildRecoveryTickets, type RecoveryTicket, } from './rehydrate.js';
export type { CreateRunRequest, IdempotencyKey, IdempotencyRecord, LifecycleVerb, OrchestratorError, OrchestratorErrorCode, ProjectId, RunId, RunRecord, RunStatus, Stage, StageDecision, StageRecord, StageStatus, TenantId, TriggerPayload, } from './types.js';
export { STAGES_IN_ORDER, asGoalId, asIdempotencyKey, asProjectId, asRunId, asTenantId, makeOrchestratorError, } from './types.js';
export { canTransition, currentStageOnVerb, isTerminal, nextStatus, } from './state-machine.js';
export { GATES, GATE_BY_KIND, findGate, isStageTransition, pagesAt50Percent, ttlMs, type Approver, type ContinuationPolicy, type EscalationTarget, type GateDefinition, type GateKind, type LaunchGate, type PaperclipPrimitive, type RoleOfRecord, type StageTransition, type TtlTier, } from './gates.js';
export { PgApprovalsRepo } from './approvals-repo-pg.js';
export { type ApprovalRecord, type ApprovalStatus, type Decision, type PaperclipInteraction, type ReturnTarget, } from './router-types.js';
export { type ApprovalsRepo, type Clock, type CostBudget, type EventBus, type Pager, type PaperclipClient, type ApprovalEvent, type RunLifecycleEvent, type StageEngine, ApprovalAlreadyDecidedError, InvalidStageTransitionError, } from './ports.js';
export { type DecideArgs, type DecideOutcome, type RouterContext, type RouterDeps, RouterError, cancelApproval, decide, extendApproval, recoverStaleTarget, routeGate, } from './router.js';
export { type SweepResult, type SweeperDeps, tickSweeper, } from './sweeper.js';
export { PagerDutyClientError, PagerDutyPager, PagerDutyServerError, type PagerDutyPagerConfig, type PagerDutySeverity, type PageReason, severityForReason, } from './pagerduty.js';
export { buildSweeperWorker, type SweeperWorker, type SweeperWorkerDeps, type TenantTickOutcome, } from './sweeper-worker.js';
export { PaperclipHttpClient, PaperclipHttpError, type PaperclipHttpClientConfig, type PaperclipHttpErrorCode, } from './paperclip-client-http.js';
export { InMemoryApprovalsRepo, InMemoryCostBudget, InMemoryStageEngine, RecordingEventBus, RecordingPaperclipClient, RecordingPager, TestClock, } from './test-doubles.js';
export { createEnvCostBudget } from './cost-budget-env.js';
export { NatsApprovalEventBus, connectNatsApprovalEventBus, natsProducerFactoryFor, openNatsConnection, type NatsApprovalEventBusOptions, type NatsConnectionBundle, } from './adapters/event-bus-nats.js';
export { gateForStageTransition, nextStageOrDone, onApprovalDecided, onApprovalExpired, onStageCompleted, } from './gate_wiring.js';
