/**
 * Master Orchestrator — public type contracts.
 *
 * Per FORA-50 spec §2.2 (run lifecycle state machine), §2.3 (seven-stage
 * spine), §4.2 (gRPC seam), and ADR-0007 (gRPC wire format).
 *
 * This module is the **first-pass** CTO implementation per the FORA-135
 * suggested-owner note ("master-orchestrator planned hire or CTO first-pass").
 * The greenfield monorepo split called out in FORA-50 spec §2.0 lands in a
 * follow-up sub-task (see `proto/orchestrator.proto` header); for now the
 * module lives under `apps/agent-runtime/src/orchestrator/` so it can be
 * unit-tested and exercised end-to-end against the existing TS toolchain.
 *
 * Invariants:
 *   - No `any`. All shapes are structural.
 *   - Branded primitives for IDs (RunId, TenantId, EventId) so an EventId
 *     cannot be assigned to a RunId by accident.
 *   - Discriminated unions for Decision / Event / TypedError so the engine
 *     narrows exhaustively.
 */

// ---------------------------------------------------------------------------
// Brand helpers (mirrors ../types.ts style)
// ---------------------------------------------------------------------------

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type RunId = Brand<string, 'RunId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type EventId = Brand<string, 'EventId'>;
export type ActorId = Brand<string, 'ActorId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

export const asRunId = (s: string): RunId => s as RunId;
export const asTenantId = (s: string): TenantId => s as TenantId;
export const asEventId = (s: string): EventId => s as EventId;
export const asActorId = (s: string): ActorId => s as ActorId;
export const asIdempotencyKey = (s: string): IdempotencyKey => s as IdempotencyKey;

// ---------------------------------------------------------------------------
// Run lifecycle states (FORA-50 spec §2.2)
// ---------------------------------------------------------------------------

/**
 * Run state machine per FORA-50 §2.2. Exactly one state at a time.
 *
 *   created ──▶ running ──▶ waiting_approval ──▶ finished ──▶ done (terminal)
 *                  ▲                 │                ▲
 *                  └────── approve ──┘                │
 *      from any state: paused (operator, resumable) or
 *                      aborted (operator or unrecoverable; terminal)
 */
export type RunState =
  | 'created'
  | 'running'
  | 'waiting_approval'
  | 'finished'
  | 'done'
  | 'paused'
  | 'aborted';

// ---------------------------------------------------------------------------
// Seven-stage spine (FORA-50 spec §2.3 + architecture.md §3)
// ---------------------------------------------------------------------------

/**
 * The seven SDLC stages, in strict order. The Orchestrator refuses to skip a
 * stage (see `STAGE_SPINE`). `done` is a run-state terminal, not a stage.
 */
export type Stage =
  | 'ideation'
  | 'architect'
  | 'dev'
  | 'qa'
  | 'security'
  | 'devops'
  | 'docs';

/**
 * Per-stage status (FORA-50 §3.2). The engine treats `approved` / `rejected`
 * as stage-local decisions; the run-state transitions separately.
 */
export type StageStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'skipped';

// ---------------------------------------------------------------------------
// Decision (ADR-0007 §3 Decision message)
// ---------------------------------------------------------------------------

/**
 * What the stage owner decided at a gate. Per ADR-0007 §3:
 *   - NEXT   — advance to the next spine stage (gate_passed).
 *   - ABORT  — terminate the run (run_aborted); `reason` is required.
 *   - RETURN — send the stage back to a prior spine stage (stage_returned);
 *              `reason` and `returnedToStage` are required.
 *
 * The `return` primitive reuses the rejection routing per FORA-50 §2.3:
 * "Returning a stage to a prior owner uses the same primitive — it is not a
 * separate mechanism."
 */
export type DecisionKind = 'next' | 'abort' | 'return';

export interface DecisionBase {
  /** Human-readable reason; required when kind = 'abort' | 'return'. */
  readonly reason?: string;
}

export type Decision =
  | (DecisionBase & { readonly kind: 'next' })
  | (DecisionBase & {
      readonly kind: 'abort';
      readonly reason: string;
    })
  | (DecisionBase & {
      readonly kind: 'return';
      readonly reason: string;
      readonly returnedToStage: Stage;
    });

// ---------------------------------------------------------------------------
// Run header (FORA-50 §3.1 agent_runs row)
// ---------------------------------------------------------------------------

export interface RunHeader {
  readonly runId: RunId;
  readonly tenantId: TenantId;
  readonly goalId: string;
  readonly projectId: string;
  readonly status: RunState;
  readonly currentStage: Stage;
  readonly triggeredBy: { readonly type: string; readonly actor: string; readonly payloadRef?: string };
  readonly costCeilingUsd: number;
  readonly costSpentUsd: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

// ---------------------------------------------------------------------------
// AdvanceStage request/response (ADR-0007 §3 AdvanceStageRequest / StageDecision)
// ---------------------------------------------------------------------------

export interface AdvanceStageRequest {
  readonly runId: RunId;
  readonly tenantId: TenantId;
  readonly fromStage: Stage;
  /**
   * `StageTarget` is `Stage | 'done'`; the 'done' sentinel is the valid
   * `next` target for `fromStage='docs'` (the last gate, FORA-50 §2.3).
   * For `return` / `abort` the engine narrows the target to `Stage` /
   * ignores it respectively.
   */
  readonly toStage: import('./stage-table.js').StageTarget;
  readonly decision: Decision;
  readonly idempotencyKey: IdempotencyKey;
  /** Optional actor for audit. Defaults to 'system' when omitted. */
  readonly requestedBy?: ActorId;
}

export interface StageDecisionResponse {
  readonly runId: RunId;
  readonly currentStage: Stage;
  readonly status: RunState;
  readonly eventIds: ReadonlyArray<EventId>;
}

// ---------------------------------------------------------------------------
// Typed events emitted to the bus (FORA-50 spec §5.1)
// ---------------------------------------------------------------------------

export interface OrchestratorEventBase {
  readonly eventId: EventId;
  readonly runId: RunId;
  readonly tenantId: TenantId;
  readonly occurredAt: string;
  readonly v: '1.0.0';
}

export interface GatePassedEvent extends OrchestratorEventBase {
  readonly type: 'gate_passed';
  readonly fromStage: Stage;
  readonly toStage: Stage;
  readonly actor: ActorId;
}

export interface StageReturnedEvent extends OrchestratorEventBase {
  readonly type: 'stage_returned';
  readonly fromStage: Stage;
  readonly toStage: Stage;
  readonly reason: string;
  readonly actor: ActorId;
}

export interface RunAbortedEvent extends OrchestratorEventBase {
  readonly type: 'run_aborted';
  readonly reason: string;
  readonly lastStage: Stage;
  readonly actor: ActorId;
}

export interface InvalidTransitionEvent extends OrchestratorEventBase {
  readonly type: 'invalid_transition';
  readonly fromStage: Stage;
  /** `StageTarget` so we can record attempted `done` calls (always invalid except from docs). */
  readonly toStage: import('./stage-table.js').StageTarget;
  readonly requestedBy: ActorId;
  readonly reason: string;
}

export interface ErrorEvent extends OrchestratorEventBase {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
  readonly stage: Stage | null;
  readonly retryable: boolean;
}

export type OrchestratorEvent =
  | GatePassedEvent
  | StageReturnedEvent
  | RunAbortedEvent
  | InvalidTransitionEvent
  | ErrorEvent;

// ---------------------------------------------------------------------------
// Typed errors (FORA-50 §4.1 error envelope, ADR-0007 §8 typed gRPC errors)
// ---------------------------------------------------------------------------

export type OrchestratorErrorCode =
  | 'INVALID_TRANSITION'
  | 'STAGE_MISMATCH'
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_RUNNING'
  | 'INVALID_DECISION'
  | 'RETURN_TO_INVALID_STAGE';

export interface OrchestratorError {
  readonly code: OrchestratorErrorCode;
  readonly message: string;
  readonly requestId?: string;
}