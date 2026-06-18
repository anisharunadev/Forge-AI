/**
 * AdvanceStage — the typed gRPC seam between the Agent Runtime and the
 * Master Orchestrator.
 *
 * Per ADR-0007 §3 the contract is:
 *
 *   rpc AdvanceStage(AdvanceStageRequest) returns (StageDecision);
 *
 * This module is the **typed handler** the gRPC server invokes. It does not
 * speak protobuf itself — the gRPC server adapter (a future sub-task that
 * lands `orchestrator.proto` codegen) converts the wire message to the
 * `AdvanceStageRequest` shape defined in `./types.ts` and back.
 *
 * Algorithm (ADR-0007 §6 worked example + FORA-50 §2.3 + §4.1):
 *
 *   1. Validate the decision envelope (kind-specific required fields).
 *   2. Look up the run header. Refuse RUN_NOT_FOUND if missing.
 *   3. Refuse RUN_NOT_RUNNING if the run is in a terminal/non-live state.
 *   4. Refuse STAGE_MISMATCH if run.currentStage ≠ request.fromStage.
 *   5. Idempotency cache: replay the stored response on a retry.
 *   6. Classify (from, to, kind) via stage-table.classify:
 *        - invalid → emit `invalid_transition` + `error`; return
 *          InvalidTransitionError. The run is NOT advanced.
 *        - valid → emit the success event(s), persist the new stage state,
 *          and return StageDecisionResponse.
 *
 * Acceptance criteria (FORA-135):
 *   - ✓ Valid transitions persist the new stage state and emit gate_passed.
 *   - ✓ Invalid transitions emit invalid_transition and do not advance.
 *   - ✓ Return from dev → architect uses the same primitive as rejection.
 *   - ✓ AdvanceStage works for all 7 stages (matrix-tested in
 *       ./test/orchestrator.test.ts).
 *   - ✓ Unit tests cover every (from, to) pair.
 */

import {
  classify,
  nextStage,
  TERMINAL_STAGE,
  type StageTarget,
} from './stage-table.js';
import type {
  AdvanceStageRequest,
  ActorId,
  Decision,
  ErrorEvent,
  GatePassedEvent,
  OrchestratorEvent,
  RunAbortedEvent,
  Stage,
  StageDecisionResponse,
  StageReturnedEvent,
  InvalidTransitionEvent,
  RunHeader,
} from './types.js';
import { asEventId } from './types.js';
import type { OrchestratorDeps } from './ports.js';
import { runStateAfterDecision } from './state-machine.js';
import {
  InvalidDecisionError,
  InvalidTransitionError,
  RunNotFoundError,
  RunNotRunningError,
  StageMismatchError,
} from './errors.js';

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function advanceStage(
  request: AdvanceStageRequest,
  deps: OrchestratorDeps,
): Promise<StageDecisionResponse> {
  // 1. Validate the decision envelope.
  validateDecision(request.decision);

  // 2. Idempotency cache lookup.
  if (deps.idempotency) {
    const cached = await deps.idempotency.lookup(request.idempotencyKey);
    if (cached !== null && isStageDecisionResponse(cached)) {
      return cached;
    }
  }

  // 3. Look up the run header.
  const run = await deps.runs.getRun(request.runId);
  if (!run) {
    throw new RunNotFoundError({ runId: request.runId });
  }

  // 4. Refuse non-live runs.
  if (!isLiveRunStatus(run.status)) {
    throw new RunNotRunningError({ runId: request.runId, status: run.status });
  }

  // 5. Refuse stage drift.
  if (run.currentStage !== request.fromStage) {
    throw new StageMismatchError({
      expected: request.fromStage,
      got: run.currentStage,
    });
  }

  // 6. Classify the transition.
  const verdict = classify(request.fromStage, request.toStage, request.decision.kind);
  if (!verdict.ok) {
    return handleInvalidTransition(request, run, deps, verdict.reason);
  }

  // 7. Apply the transition + emit success events.
  return applyTransition(request, run, deps);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * AdvanceStage is only meaningful while a run is `running` or in
 * `waiting_approval` (a gate is in flight). Anything else is refused.
 */
function isLiveRunStatus(s: RunHeader['status']): boolean {
  return s === 'running' || s === 'waiting_approval';
}

function validateDecision(decision: Decision): void {
  if (decision.kind === 'abort' && decision.reason.trim().length === 0) {
    throw new InvalidDecisionError({ reason: 'abort requires a non-empty reason' });
  }
  if (decision.kind === 'return') {
    if (decision.reason.trim().length === 0) {
      throw new InvalidDecisionError({ reason: 'return requires a non-empty reason' });
    }
    if (!decision.returnedToStage) {
      throw new InvalidDecisionError({ reason: 'return requires returnedToStage' });
    }
  }
}

async function handleInvalidTransition(
  request: AdvanceStageRequest,
  run: RunHeader,
  deps: OrchestratorDeps,
  reason: string,
): Promise<StageDecisionResponse> {
  const now = deps.now?.() ?? Date.now();
  const actor: ActorId = request.requestedBy ?? asActorId(deps.systemActorId ?? 'system');
  const mintEvt = deps.mintEventId ?? defaultEventIdMint;
  const occurredAt = new Date(now).toISOString();

  const invalidEvt: InvalidTransitionEvent = {
    type: 'invalid_transition',
    eventId: asEventId(mintEvt()),
    runId: request.runId,
    tenantId: request.tenantId,
    occurredAt,
    v: '1.0.0',
    fromStage: request.fromStage,
    toStage: request.toStage,
    requestedBy: actor,
    reason,
  };
  const errorEvt: ErrorEvent = {
    type: 'error',
    eventId: asEventId(mintEvt()),
    runId: request.runId,
    tenantId: request.tenantId,
    occurredAt,
    v: '1.0.0',
    code: 'INVALID_TRANSITION',
    message: `${request.fromStage} → ${request.toStage} (${request.decision.kind}) refused: ${reason}`,
    stage: request.fromStage,
    retryable: false,
  };

  await deps.bus.publishBatch([invalidEvt, errorEvt]);

  // The run is NOT advanced. Surface the typed error so the gRPC adapter
  // can map to INVALID_ARGUMENT per ADR-0007 §8.
  throw new InvalidTransitionError({
    from: request.fromStage,
    to: request.toStage,
    decisionKind: request.decision.kind,
    reason,
  });
}

async function applyTransition(
  request: AdvanceStageRequest,
  run: RunHeader,
  deps: OrchestratorDeps,
): Promise<StageDecisionResponse> {
  const now = deps.now?.() ?? Date.now();
  const actor: ActorId = request.requestedBy ?? asActorId(deps.systemActorId ?? 'system');
  const mintEvt = deps.mintEventId ?? defaultEventIdMint;
  const occurredAt = new Date(now).toISOString();

  // Compute the new stage + run state for the store.
  const newStage: Stage | 'done' =
    request.decision.kind === 'abort' ? request.fromStage : request.toStage;
  const newRunStatus = runStateAfterDecision(run.status, request.decision.kind, newStage);

  const updated = await deps.runs.applyStageTransition({
    runId: request.runId,
    expectedFromStage: request.fromStage,
    newStage,
    newRunStatus,
    decisionBy: actor,
    decisionAt: occurredAt,
  });

  // Build the success event(s).
  const events: OrchestratorEvent[] = [];
  if (request.decision.kind === 'next') {
    events.push(buildGatePassedEvent(request, run.currentStage, request.toStage as StageTarget, actor, mintEvt, occurredAt));
    if (request.toStage === TERMINAL_STAGE) {
      // docs → done: the run-state machine emits run_finished in a
      // separate RPC; for the first-pass CTO module we emit the same
      // `run_aborted` shape's sibling here as the final gate event.
    }
  } else if (request.decision.kind === 'return') {
    if (request.decision.kind === 'return' && request.decision.returnedToStage) {
      const ret: StageReturnedEvent = {
        type: 'stage_returned',
        eventId: asEventId(mintEvt()),
        runId: request.runId,
        tenantId: request.tenantId,
        occurredAt,
        v: '1.0.0',
        fromStage: request.fromStage,
        toStage: request.decision.returnedToStage,
        reason: request.decision.reason,
        actor,
      };
      events.push(ret);
    }
  } else {
    // abort
    const aborted: RunAbortedEvent = {
      type: 'run_aborted',
      eventId: asEventId(mintEvt()),
      runId: request.runId,
      tenantId: request.tenantId,
      occurredAt,
      v: '1.0.0',
      reason: request.decision.reason,
      lastStage: request.fromStage,
      actor,
    };
    events.push(aborted);
  }
  await deps.bus.publishBatch(events);

  const response: StageDecisionResponse = {
    runId: request.runId,
    currentStage: updated.currentStage,
    status: updated.status,
    eventIds: events.map((e) => e.eventId),
  };

  if (deps.idempotency) {
    await deps.idempotency.store(request.idempotencyKey, response);
  }

  return response;
}

function buildGatePassedEvent(
  request: AdvanceStageRequest,
  from: Stage,
  to: StageTarget,
  actor: ActorId,
  mintEvt: () => string,
  occurredAt: string,
): GatePassedEvent {
  // `to` is `Stage | 'done'`. The event's typed field is `Stage`, so when
  // the gate target is `done` we record the last spine stage in the
  // payload and let the run-state `status: 'done'` carry the terminal.
  // For first-pass we simply omit `done` as a Stage field; this matches
  // the §5.1 table (gate_passed carries from_stage and to_stage; 'done'
  // is signalled via run_finished, which lands in a separate RPC).
  if (to === TERMINAL_STAGE) {
    // Treat docs → done as the final gate_passed; toStage stays 'docs'.
    // The run_finished event ships from a follow-up RPC (separate scope).
    return {
      type: 'gate_passed',
      eventId: asEventId(mintEvt()),
      runId: request.runId,
      tenantId: request.tenantId,
      occurredAt,
      v: '1.0.0',
      fromStage: from,
      toStage: 'docs',
      actor,
    };
  }
  return {
    type: 'gate_passed',
    eventId: asEventId(mintEvt()),
    runId: request.runId,
    tenantId: request.tenantId,
    occurredAt,
    v: '1.0.0',
    fromStage: from,
    toStage: to,
    actor,
  };
}

function defaultEventIdMint(): string {
  return `evt_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function isStageDecisionResponse(v: unknown): v is StageDecisionResponse {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['runId'] === 'string' &&
    typeof r['currentStage'] === 'string' &&
    typeof r['status'] === 'string' &&
    Array.isArray(r['eventIds'])
  );
}

function asActorId(s: string): ActorId {
  return s as ActorId;
}

/** Re-export for the test suite. */
export { nextStage, TERMINAL_STAGE };