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
export {
  buildRecoveryTickets,
  type RecoveryTicket,
} from './rehydrate.js';

// Public types — the public API contract for downstream callers.
export type {
  CreateRunRequest,
  IdempotencyKey,
  IdempotencyRecord,
  LifecycleVerb,
  OrchestratorError,
  OrchestratorErrorCode,
  ProjectId,
  RunId,
  RunRecord,
  RunStatus,
  Stage,
  StageDecision,
  StageRecord,
  StageStatus,
  TenantId,
  TriggerPayload,
} from './types.js';
export {
  STAGES_IN_ORDER,
  asGoalId,
  asIdempotencyKey,
  asProjectId,
  asRunId,
  asTenantId,
  makeOrchestratorError,
} from './types.js';

// State-machine predicates — useful for callers that want to render
// the lifecycle UI without re-implementing the guard.
export {
  canTransition,
  currentStageOnVerb,
  isTerminal,
  nextStatus,
} from './state-machine.js';

// ---- 0.1.4 — Human-approval router (FORA-137) ---------------------------
//
// The router is the only writer of `agent_run_approvals` and the issuer
// of the per-gate Paperclip interaction. The typed gate table is the
// single source of truth for the (gate → role → TTL → primitive → wake)
// mapping; ADR-0008 is the algorithm. The sweeper is the TTL contract.
export {
  GATES,
  GATE_BY_KIND,
  findGate,
  isStageTransition,
  pagesAt50Percent,
  ttlMs,
  type Approver,
  type ContinuationPolicy,
  type EscalationTarget,
  type GateDefinition,
  type GateKind,
  type LaunchGate,
  type PaperclipPrimitive,
  type RoleOfRecord,
  type StageTransition,
  type TtlTier,
} from './gates.js';
// 0.1.4.a — Postgres adapter for `ApprovalsRepo`. See FORA-168.
export { PgApprovalsRepo } from './approvals-repo-pg.js';
export {
  type ApprovalRecord,
  type ApprovalStatus,
  type Decision,
  type PaperclipInteraction,
  type ReturnTarget,
} from './router-types.js';
export {
  type ApprovalsRepo,
  type Clock,
  type EventBus,
  type Pager,
  type PaperclipClient,
  type ApprovalEvent,
  type RunLifecycleEvent,
  type StageEngine,
  ApprovalAlreadyDecidedError,
  InvalidStageTransitionError,
} from './ports.js';
export {
  type DecideArgs,
  type DecideOutcome,
  type RouterContext,
  type RouterDeps,
  RouterError,
  cancelApproval,
  decide,
  extendApproval,
  recoverStaleTarget,
  routeGate,
} from './router.js';
export {
  type SweepResult,
  type SweeperDeps,
  tickSweeper,
} from './sweeper.js';
// 0.1.4.d — PagerDuty V2 Events API adapter for the Pager port. See FORA-171.
export {
  PagerDutyClientError,
  PagerDutyPager,
  PagerDutyServerError,
  type PagerDutyPagerConfig,
  type PagerDutySeverity,
  type PageReason,
  severityForReason,
} from './pagerduty.js';
// 0.1.4.e — Cron sweeper worker + decide / return HTTP wrappers (FORA-172).
export {
  buildSweeperWorker,
  type SweeperWorker,
  type SweeperWorkerDeps,
  type TenantTickOutcome,
} from './sweeper-worker.js';
// 0.1.4.b — Paperclip HTTP client adapter. See FORA-169 / FORA-177.
export {
  PaperclipHttpClient,
  PaperclipHttpError,
  type PaperclipHttpClientConfig,
  type PaperclipHttpErrorCode,
} from './paperclip-client-http.js';

// Test doubles — public so the eval tests and downstream packages
// can reuse them. The production adapters (Postgres, NATS, PagerDuty,
// Paperclip HTTP) are follow-up sub-tasks.
export {
  InMemoryApprovalsRepo,
  InMemoryStageEngine,
  RecordingEventBus,
  RecordingPaperclipClient,
  RecordingPager,
  TestClock,
} from './test-doubles.js';

// 0.1.4.c — NATS adapter for the approval-event slice of the bus (FORA-170).
// Per ADR-0006 §3.1 the adapter publishes to
// `fora.events.<tenant_id>.<event_type>.v1` and the Orchestrator is the
// only writer (architecture.md §2.1). The substrate (NATS JetStream +
// per-tenant subject ACLs + consumer-side dedupe) lives in
// `@fora/event-bus`; this adapter is the orchestrator-local glue that
// maps the gate router's `ApprovalEvent` union onto the substrate's
// typed-event payloads.
export {
  NatsApprovalEventBus,
  connectNatsApprovalEventBus,
  natsProducerFactoryFor,
  openNatsConnection,
  type NatsApprovalEventBusOptions,
  type NatsConnectionBundle,
} from './adapters/event-bus-nats.js';

// 0.1.4.f — Stage engine wiring (FORA-173). The seam between the
// FORA-135 stage engine and the FORA-137 gate router. See
// `docs/architecture/adr-0007-grpc-orchestrator-runtime.md` for the
// gRPC adapter (follow-up).
export {
  gateForStageTransition,
  nextStageOrDone,
  onApprovalDecided,
  onApprovalExpired,
  onStageCompleted,
} from './gate_wiring.js';
