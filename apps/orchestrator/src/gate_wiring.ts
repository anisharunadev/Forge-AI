/**
 * Gate wiring — the seam between the FORA-135 stage engine and the
 * FORA-137 gate router.
 *
 * Per FORA-173 the wiring is the only place that bridges the two
 * event vocabularies (FORA-50 §5.1):
 *
 *   Forward path  (engine → router)
 *     stage_completed ──► look up next gate ──► routeGate(deps, ctx, next)
 *                       │
 *                       └─► emit approval_requested event
 *
 *   Reverse path  (router → engine)
 *     approval_decided{accept}          ──► engine.advance(...)
 *     approval_decided{request_changes} ──► engine.reEnter(...) (stage_returned)
 *     approval_decided{reject}          ──► engine.pauseRun(...)
 *     approval_expired                  ──► engine.pauseRun(...)
 *
 * The wiring is event-driven: it consumes bus events and applies the
 * typed transition to the engine. The router has ALREADY mutated the
 * persisted row + emitted `approval_decided` before the wiring sees
 * the event, so the wiring never calls `decide()` — it only forwards
 * the verdict to the engine.
 *
 * Acceptance (FORA-173):
 *   - Walk a run through the seven stages; every gate issues a
 *     confirmation and the engine advances only on accept.
 *   - A `stage_returned` event re-enters the prior stage with the
 *     same RunContext (idempotent per ADR-0001 §2.3).
 *   - An `approval_expired` event pauses the run; the run is
 *     resumable on a new approval.
 */

import {
  GATE_BY_KIND,
  type GateKind,
  type StageTransition,
} from './gates.js';
import { routeGate, type RouterContext, type RouterDeps } from './router.js';
import type {
  ApprovalEvent,
  CostBudget,
  EventBus,
  StageEngine,
} from './ports.js';
import { type RunId, type Stage, type TenantId } from './types.js';

/**
 * The gate that follows a completed stage. The seven stage
 * transitions are the per-stage gates; the launch gate is only
 * issued once the docs stage accepts (the launch is a separate
 * top-level approval after `run = done`, not a stage transition).
 *
 * `docs → done` is the seventh transition (the gate `docs->done`).
 */
export function gateForStageTransition(
  from: Stage,
  to: Stage | 'done',
): StageTransition | null {
  if (to === 'done') {
    return from === 'docs' ? 'docs->done' : null;
  }
  const key = `${from}->${to}` as StageTransition;
  return key in GATE_BY_KIND ? key : null;
}

// ---------------------------------------------------------------------------
// Forward path: stage_completed → routeGate
// ---------------------------------------------------------------------------

/**
 * Handle a `stage_completed` event from the engine. The wiring
 * looks up the next gate and calls `routeGate`. A `stage_completed`
 * with `toStage = 'done'` has no following gate (the run reached
 * `done`); the wiring is a no-op in that case.
 *
 * FORA-528 (0.1.b): before `routeGate` is called, the wiring asks
 * the `CostBudget` port for the tenant's current spend + ceiling.
 * If `spentUsd >= ceilingUsd`, the wiring emits
 * `gate_failed_cost_ceiling` on the bus and returns `null` (no
 * gate, no approval row, no `approval_requested` event). The run
 * stays in `args.fromStage`; the operator must wait for the next
 * billing cycle or raise the ceiling to resume.
 *
 * Returns the `{ approvalId, interactionId, gateKind }` from
 * `routeGate` so the caller (the NATS consumer) can stamp the audit
 * log.
 */
export async function onStageCompleted(
  deps: { router: RouterDeps; bus: EventBus; costBudget: CostBudget },
  args: {
    tenantId: TenantId;
    runId: RunId;
    fromStage: Stage;
    toStage: Stage | 'done';
    artefactRefs: ReadonlyArray<{ kind: string; url: string; sha256?: string }>;
    ctx: Omit<RouterContext, 'artefactRefs'> & {
      artefactRefs?: ReadonlyArray<{ kind: string; url: string; sha256?: string }>;
    };
  },
): Promise<{ approvalId: string; interactionId: string; gateKind: GateKind } | null> {
  if (args.toStage === 'done') {
    // The engine's terminal advance. The launch gate (board
    // approval) is a separate event the engine emits after
    // `done`; the wiring does not route it here.
    return null;
  }
  const gateKind = gateForStageTransition(args.fromStage, args.toStage);
  if (!gateKind) {
    // An unknown (from, to) pair. The engine should never emit one
    // (state-machine.ts guards it); surface as a typed error so a
    // drift fails loud.
    throw new Error(
      `onStageCompleted: no gate for transition ${args.fromStage} → ${args.toStage}`,
    );
  }

  // Active cost-ceiling check (FORA-528 / FORA-110 0.1.b). The
  // Cost agent owns the underlying spend aggregation; this is
  // the policy boundary that refuses to advance. A null
  // `spentUsd` is impossible — the port returns a number.
  const { spentUsd, ceilingUsd } = await deps.costBudget.currentSpendUsd({
    tenantId: args.tenantId,
  });
  if (spentUsd >= ceilingUsd) {
    await deps.bus.emit({
      type: 'gate_failed_cost_ceiling',
      tenantId: args.tenantId,
      runId: args.runId,
      fromStage: args.fromStage,
      toStage: args.toStage,
      gateKind,
      spentUsd,
      ceilingUsd,
      reason: 'over_budget',
      emittedAt: new Date().toISOString(),
    });
    // No routeGate, no approval row, no approval_requested event.
    // The run stays in `args.fromStage`.
    return null;
  }

  const ctx: RouterContext = {
    tenantId: args.tenantId,
    runId: args.runId,
    orchestratorIssueId: args.ctx.orchestratorIssueId,
    planRevisionId: args.ctx.planRevisionId,
    artefactRefs: args.artefactRefs,
    ...(args.ctx.reason !== undefined ? { reason: args.ctx.reason } : {}),
  };

  const { approval, interactionId } = await routeGate(deps.router, ctx, gateKind);

  // routeGate already emits `approval_requested` (ADR-0008 §4 step 5),
  // so the wiring does not re-emit it — the bus event was already
  // published by the time `routeGate` returned.
  void deps.bus;

  return { approvalId: approval.id, interactionId, gateKind };
}

// ---------------------------------------------------------------------------
// Reverse path: approval_decided → engine
// ---------------------------------------------------------------------------

/**
 * Handle an `approval_decided` event from the router. The router
 * has already applied the decision and stamped the row; the wiring
 * forwards the verdict to the engine:
 *
 *   - `accept`           → engine.advance(toStage)
 *   - `reject`           → engine.pauseRun()
 *   - `request_changes`  → engine.reEnter(returnTo) (the "send it
 *                          back" primitive)
 *
 * The caller (NATS consumer) passes the persisted row's `stage` as
 * `fromStage` and the `returnTo.toStage` for `request_changes`. Both
 * come from `findById` on the approvals repo before the wiring fires.
 */
export async function onApprovalDecided(
  deps: { engine: StageEngine },
  args: {
    event: Extract<ApprovalEvent, { type: 'approval_decided' }>;
    /** The stage the gate was guarding (row.stage). */
    fromStage: Stage;
    /** Required when the decision is `request_changes`. */
    returnTo?: { toStage: Stage };
  },
): Promise<void> {
  const { event } = args;

  if (event.decision === 'accept') {
    // Accept → advance the engine. The `toStage` is the next stage in
    // the spine; the engine's `toStage = 'done'` corresponds to the
    // `docs->done` gate (the seventh transition).
    const toStage = nextStageOrDone(args.fromStage);
    await deps.engine.advance({
      tenantId: event.tenantId,
      runId: event.runId,
      fromStage: args.fromStage,
      toStage,
      idempotencyKey: `advance:${event.runId}:${event.approvalId}:${toStage}`,
    });
    return;
  }

  if (event.decision === 'reject') {
    // Reject → pause the run. The router already stamped
    // `approval_rejected`; the engine pauses the run header so the
    // operator can extend or cancel.
    await deps.engine.pauseRun({
      tenantId: event.tenantId,
      runId: event.runId,
      approvalId: event.approvalId,
    });
    return;
  }

  // decision === 'request_changes' → re-enter the prior stage.
  if (!args.returnTo) {
    throw new Error(
      'onApprovalDecided: request_changes decision missing returnTo (caller must load from the persisted row)',
    );
  }
  await deps.engine.reEnter({
    tenantId: event.tenantId,
    runId: event.runId,
    fromStage: args.fromStage,
    toStage: args.returnTo.toStage,
    reason: `returned by ${event.decidedBy}`,
    idempotencyKey: `reenter:${event.runId}:${event.approvalId}:${args.returnTo.toStage}`,
  });
}

// ---------------------------------------------------------------------------
// Reverse path: approval_expired → engine.pauseRun
// ---------------------------------------------------------------------------

/**
 * Handle an `approval_expired` event from the sweeper. The router
 * already stamped the row to `expired` and emitted the event; the
 * engine pauses the run header so it shows as `paused` in the
 * header view. The run is resumable: an `extend` on the same
 * approval row resumes via `advance` once the human accepts.
 */
export async function onApprovalExpired(
  deps: { engine: StageEngine; bus: EventBus },
  args: {
    event: Extract<ApprovalEvent, { type: 'approval_expired' }>;
  },
): Promise<void> {
  await deps.engine.pauseRun({
    tenantId: args.event.tenantId,
    runId: args.event.runId,
    approvalId: args.event.approvalId,
  });
  await deps.bus.emit({
    type: 'run_paused',
    tenantId: args.event.tenantId,
    runId: args.event.runId,
    approvalId: args.event.approvalId,
    reason: 'approval_expired',
    pausedAt: args.event.expiredAt,
  });
}

// ---------------------------------------------------------------------------
// Stage spine helper
// ---------------------------------------------------------------------------

/**
 * The next stage in the spine. `docs` advances to `done` (terminal).
 * Used by `onApprovalDecided{accept}` to compute the engine's `toStage`
 * from the row's `fromStage` without re-deriving from the gate table.
 */
export function nextStageOrDone(from: Stage): Stage | 'done' {
  switch (from) {
    case 'ideation':
      return 'architect';
    case 'architect':
      return 'dev';
    case 'dev':
      return 'qa';
    case 'qa':
      return 'security';
    case 'security':
      return 'devops';
    case 'devops':
      return 'docs';
    case 'docs':
      return 'done';
  }
}
