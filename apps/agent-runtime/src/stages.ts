/**
 * Stage machine.
 *
 * Per §4 of the design doc, the runtime walks:
 *
 *   plan → act → observe → reflect
 *
 * with two extra transitions:
 *
 *   - `replan`: from `reflect` back to `plan` (carries the new plan)
 *   - `abort`:  from any stage (records the typed error and finalizes)
 *
 * No other entry points exist. The stage machine is the *only* callable
 * path between an agent definition and a finished `RunRecord`.
 *
 * 0.2.3 additions:
 *   - CancelToken polled between stages; the run finalises as
 *     `cancelled` if the token fires.
 *   - BudgetMeter checked before each stage; `BudgetExceeded` finalises
 *     the run as `budget_exceeded` and skips the stage.
 *   - Wall-clock recorded at each stage boundary (the 4th budget site).
 *   - Tool handler `costHint` recorded per observation (3rd budget site).
 *   - Planner and reflector `usage` recorded (sites 1 + 2).
 *   - Idempotency store is plumbed into the gateway for handler dedupe
 *     and replay. `idempotency.hit` events stream to the run record.
 */

import { invokeTool } from './gateway.js';
import type { RunRecordSink } from './run-record.js';
import { buildRunRecord } from './run-record.js';
import {
  BudgetMeter,
  BudgetExceededError,
  toBudgetExceededTypedError,
  UnlimitedBudgetMeter,
  type Budget,
} from './budget.js';
import {
  type CancelToken,
  type CancelTokenRegistry,
  InMemoryCancelTokenRegistry,
} from './cancel.js';
import {
  type IdempotencyStore,
  NullIdempotencyStore,
} from './idempotency.js';
import type {
  Observation,
  Plan,
  Reflection,
  RunId,
  RunRecord,
  RunRecordStep,
  SubAgentDefinition,
  TypedError,
} from './types.js';
import { asRunId, makeError } from './types.js';

/** Clock seam; tests inject a fixed clock. */
export type Clock = () => number;

/**
 * @deprecated v0 cancel-registry seam. 0.2.3 callers should use
 * `CancelTokenRegistry` directly via `RuntimeDeps.cancelTokens`.
 * The v0 interface is preserved so the public `Runtime.cancel(runId)`
 * method continues to work after the upgrade.
 */
export interface CancelRegistry {
  request(runId: RunId): void;
  isCancelled(runId: RunId): boolean;
  cancel(runId: RunId): void;
}

export interface RuntimeDeps {
  sink: RunRecordSink;
  now?: Clock;
  /**
   * @deprecated v0 cancel-registry seam. The runtime auto-wraps a
   * `CancelRegistry` into a `CancelTokenRegistry` when no
   * `cancelTokens` is supplied, so v0 callers keep working.
   */
  cancelRegistry?: CancelRegistry;
  /** 0.2.3 cancel-token registry. */
  cancelTokens?: CancelTokenRegistry;
  /** Optional id mint; tests inject deterministic ids. */
  mintRunId?: () => RunId;
  /** Idempotency store for handler dedupe. */
  idempotency?: IdempotencyStore;
}

const DEFAULT_MAX_REPLANS = 3;

/** Result returned by `runtime.invoke`. */
export type InvokeResult =
  | { status: 'succeeded'; runId: RunId; record: RunRecord }
  | { status: 'failed'; runId: RunId; record: RunRecord; error: TypedError }
  | { status: 'aborted'; runId: RunId; record: RunRecord }
  | { status: 'budget_exceeded'; runId: RunId; record: RunRecord; error: TypedError }
  | { status: 'cancelled'; runId: RunId; record: RunRecord; error: TypedError };

interface RunState {
  steps: RunRecordStep[];
  errors: TypedError[];
  replanCycles: number;
  /** All observations across all plan iterations (used by reflect). */
  observations: Observation[];
  currentPlan?: Plan;
}

/**
 * Walk the stage machine once. Pure control flow; the public surface
 * lives in `runtime.ts`.
 *
 * This function does not return early on a planner error. It records
 * the error, surfaces it to the reflect stage (so the reflector can
 * decide whether to replan), and only aborts when the reflector says
 * `done: true` and there is an outstanding error, or when the replan
 * budget is exhausted.
 */
export async function runStages(args: {
  agent: SubAgentDefinition;
  runId: RunId;
  tenantId: string;
  traceId: string;
  inputs: import('./types.js').RunInputs;
  deps: RuntimeDeps;
}): Promise<InvokeResult> {
  const now = args.deps.now ?? (() => Date.now());
  // Resolve the cancel-token registry. Prefer the 0.2.3 token registry
  // if supplied; otherwise wrap a v0 `CancelRegistry`; otherwise mint
  // a fresh in-process registry so `runtime.cancel(runId, reason)`
  // still has the documented effect for the lifetime of the run.
  const tokens: CancelTokenRegistry = args.deps.cancelTokens
    ? args.deps.cancelTokens
    : args.deps.cancelRegistry
      ? wrapLegacyRegistry(args.deps.cancelRegistry)
      : new InMemoryCancelTokenRegistry();
  const cancel = tokens.token(args.runId);

  const startedAt = new Date(now()).toISOString();
  const startedAtMs = now();
  const state: RunState = {
    steps: [],
    errors: [],
    replanCycles: 0,
    observations: [],
  };

  const maxReplans = args.inputs.maxReplans ?? DEFAULT_MAX_REPLANS;
  const budgetCeiling: Budget = args.inputs.budget ?? {};
  const budget: BudgetMeter = args.inputs.budget
    ? new BudgetMeter({
        runId: args.runId,
        ceiling: budgetCeiling,
        startedAtMs,
        now,
      })
    : new UnlimitedBudgetMeter({ runId: args.runId, now });

  // Cancellation check before we start.
  if (cancel.isCancelled) {
    return finalizeCancelled(args, state, now, startedAt, cancel, budget, tokens);
  }

  // ---- Main loop: plan → act → observe → reflect, with replan + abort. ----
  let plan: Plan | undefined;
  let done = false;
  let lastReflection: Reflection | undefined;

  // Pre-stage budget check for `plan`. If a ceiling is set, the
  // check throws `BudgetExceeded`. We catch and finalize.
  try {
    budget.checkBeforeStage('plan', args.runId);
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      return finalizeBudgetExceeded(args, state, now, startedAt, e, budget);
    }
    throw e;
  }

  // Stage 1: plan
  await args.deps.sink.append({
    kind: 'stage.entered',
    runId: args.runId,
    stage: 'plan',
    at: new Date(now()).toISOString(),
  });
  try {
    plan = await args.agent.plan(args.inputs);
  } catch (e) {
    if (isCancellation(e, cancel)) {
      return finalizeCancelled(args, state, now, startedAt, cancel, budget, tokens);
    }
    const cause = e instanceof Error ? e.message : String(e);
    const err: TypedError = makeError({
      code: 'HandlerThrew',
      message: 'planner threw',
      handlerId: 'planner',
      runId: args.runId,
      cause,
    });
    state.errors.push(err);
    await args.deps.sink.append({ kind: 'error', runId: args.runId, error: err, at: new Date(now()).toISOString() });
    return finalize(args, state, now, startedAt, 'failed', err, undefined, budget);
  }
  // Record planner LLM usage (budget site 1).
  if (plan.usage) budget.recordPlannerLlm(plan.usage);
  state.currentPlan = plan;
  await args.deps.sink.append({
    kind: 'plan.emitted',
    runId: args.runId,
    planId: plan.planId,
    stepCount: plan.steps.length,
    at: new Date(now()).toISOString(),
  });
  // Stage-boundary wall-clock (budget site 4).
  budget.recordStageBoundaryWallClock();

  while (!done) {
    if (cancel.isCancelled) {
      return finalizeCancelled(args, state, now, startedAt, cancel, budget, tokens);
    }

    // Pre-stage check for `act`.
    try {
      budget.checkBeforeStage('act', args.runId);
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        return finalizeBudgetExceeded(args, state, now, startedAt, e, budget);
      }
      throw e;
    }

    // ---- Stage 2: act ----
    await args.deps.sink.append({
      kind: 'stage.entered',
      runId: args.runId,
      stage: 'act',
      at: new Date(now()).toISOString(),
    });
    const planToRun = state.currentPlan;
    if (!planToRun) {
      const err: TypedError = makeError({
        code: 'HandlerThrew',
        message: 'no plan in state during act',
        handlerId: 'stage-machine',
        runId: args.runId,
        cause: 'invariant violation',
      });
      state.errors.push(err);
      await args.deps.sink.append({ kind: 'error', runId: args.runId, error: err, at: new Date(now()).toISOString() });
      return finalize(args, state, now, startedAt, 'failed', err, lastReflection, budget);
    }

    for (const step of planToRun.steps) {
      // Per-step cancel poll. The gateway *also* checks the cancel
      // token, but checking here keeps the loop responsive when the
      // gateway is mid-retry backoff.
      if (cancel.isCancelled) {
        return finalizeCancelled(args, state, now, startedAt, cancel, budget, tokens);
      }
      const result = await invokeTool({
        agent: args.agent,
        runId: args.runId,
        stage: 'act',
        stepId: step.stepId,
        tool: step.tool,
        input: step.input,
        now,
        traceId: args.traceId,
        tenantId: args.tenantId,
        ...(step.idempotencyKey !== undefined ? { idempotencyKey: step.idempotencyKey } : {}),
        opts: {
          idempotency: args.deps.idempotency ?? new NullIdempotencyStore(),
          cancel,
        },
      });

      state.observations.push(result.observation);
      const recordStep = observationToStep(planToRun.planId, result.observation);
      if (result.observation.idempotencyHit) {
        recordStep.idempotencyHit = result.observation.idempotencyHit;
      }
      state.steps.push(recordStep);

      // Record tool costHint (budget site 3) — only for successful
      // invocations; failed ones are recorded as errors.
      if (result.observation.ok && result.observation.costHint) {
        budget.recordToolCostHint(result.observation.costHint);
      }

      // Emit the idempotency.hit event when the gateway short-circuits.
      if (result.observation.ok && result.observation.idempotencyHit) {
        await args.deps.sink.append({
          kind: 'idempotency.hit',
          runId: args.runId,
          stepId: String(result.observation.stepId),
          tool: String(result.observation.tool),
          key: result.observation.idempotencyHit.key,
          storedAt: result.observation.idempotencyHit.storedAt,
          at: new Date(now()).toISOString(),
        });
      }

      if (!result.ok) {
        state.errors.push(result.error);
        await args.deps.sink.append({
          kind: 'error',
          runId: args.runId,
          error: result.error,
          at: new Date(now()).toISOString(),
        });
        // Surface cancellation immediately. Other errors fall through
        // to observe+reflect so the record captures the failure path.
        if (result.error.code === 'Cancelled') {
          return finalizeCancelled(args, state, now, startedAt, cancel, budget, tokens);
        }
      }
      await args.deps.sink.append({
        kind: 'observation',
        runId: args.runId,
        observation: result.observation,
        at: new Date(now()).toISOString(),
      });
    }
    // Stage-boundary wall-clock after act.
    budget.recordStageBoundaryWallClock();

    // Pre-stage check for `observe`.
    try {
      budget.checkBeforeStage('observe', args.runId);
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        return finalizeBudgetExceeded(args, state, now, startedAt, e, budget);
      }
      throw e;
    }

    // ---- Stage 3: observe ----
    await args.deps.sink.append({
      kind: 'stage.entered',
      runId: args.runId,
      stage: 'observe',
      at: new Date(now()).toISOString(),
    });
    // v0: observe is a no-op pass-through. The observations are already
    // captured; this stage exists so 0.2.3+ can add evaluation / checks
    // without re-shaping the contract.
    budget.recordStageBoundaryWallClock();

    // Pre-stage check for `reflect`.
    try {
      budget.checkBeforeStage('reflect', args.runId);
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        return finalizeBudgetExceeded(args, state, now, startedAt, e, budget);
      }
      throw e;
    }

    // ---- Stage 4: reflect ----
    await args.deps.sink.append({
      kind: 'stage.entered',
      runId: args.runId,
      stage: 'reflect',
      at: new Date(now()).toISOString(),
    });
    let reflection: Reflection;
    try {
      reflection = await args.agent.reflect({
        plan: planToRun,
        observations: state.observations,
      });
    } catch (e) {
      if (isCancellation(e, cancel)) {
        return finalizeCancelled(args, state, now, startedAt, cancel, budget, tokens);
      }
      const cause = e instanceof Error ? e.message : String(e);
      const err: TypedError = makeError({
        code: 'HandlerThrew',
        message: 'reflector threw',
        handlerId: 'reflector',
        runId: args.runId,
        cause,
      });
      state.errors.push(err);
      await args.deps.sink.append({ kind: 'error', runId: args.runId, error: err, at: new Date(now()).toISOString() });
      return finalize(args, state, now, startedAt, 'failed', err, lastReflection, budget);
    }
    // Record reflector LLM usage (budget site 2).
    if (reflection.usage) budget.recordReflectorLlm(reflection.usage);
    lastReflection = reflection;
    await args.deps.sink.append({
      kind: 'reflection',
      runId: args.runId,
      done: reflection.done,
      note: reflection.note,
      at: new Date(now()).toISOString(),
    });
    budget.recordStageBoundaryWallClock();

    // ---- Decide: finish, replan, or abort ----
    if (reflection.done) {
      done = true;
      const hadError = state.errors.length > 0;
      const status: RunRecord['status'] = hadError ? 'failed' : 'succeeded';
      const lastError = state.errors[state.errors.length - 1];
      return finalize(args, state, now, startedAt, status, lastError, reflection, budget);
    }

    if (!reflection.nextPlan) {
      // Reflector says "not done" but gave no plan. That's a contract
      // violation; record it and abort.
      const err: TypedError = makeError({
        code: 'HandlerThrew',
        message: 'reflector returned done=false without nextPlan',
        handlerId: 'reflector',
        runId: args.runId,
        cause: 'invariant violation',
      });
      state.errors.push(err);
      await args.deps.sink.append({ kind: 'error', runId: args.runId, error: err, at: new Date(now()).toISOString() });
      return finalize(args, state, now, startedAt, 'failed', err, reflection, budget);
    }

    if (state.replanCycles >= maxReplans) {
      const err: TypedError = makeError({
        code: 'ReplanBudgetExhausted',
        message: `replan cycle ${state.replanCycles + 1} exceeds maxReplans=${maxReplans}`,
        runId: args.runId,
        maxReplans,
      });
      state.errors.push(err);
      await args.deps.sink.append({ kind: 'error', runId: args.runId, error: err, at: new Date(now()).toISOString() });
      return finalize(args, state, now, startedAt, 'failed', err, reflection, budget);
    }

    // Carry out the replan transition.
    state.replanCycles += 1;
    state.currentPlan = reflection.nextPlan;
    await args.deps.sink.append({
      kind: 'replan',
      runId: args.runId,
      cycle: state.replanCycles,
      at: new Date(now()).toISOString(),
    });
  }

  // Unreachable: the loop returns from finalize() on every path.
  return finalize(args, state, now, startedAt, 'failed', undefined, lastReflection, budget);
}

function observationToStep(planId: string, o: Observation): RunRecordStep {
  const base: RunRecordStep = {
    stepId: o.stepId,
    planId,
    tool: o.tool,
    handlerId: '',
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(o.durationMs).toISOString(),
    durationMs: o.durationMs,
    ok: o.ok,
    stage: 'act',
  };
  if (o.ok) {
    return { ...base, output: o.output };
  }
  return { ...base, errorOutput: o.errorOutput };
}

async function finalize(
  args: { agent: SubAgentDefinition; runId: RunId; tenantId: string; traceId: string; deps: RuntimeDeps },
  state: RunState,
  now: Clock,
  startedAt: string,
  status: RunRecord['status'],
  error: TypedError | undefined,
  reflection: Reflection | undefined,
  budget: BudgetMeter,
): Promise<InvokeResult> {
  const finishedAt = new Date(now()).toISOString();
  // Re-stamp the step start/finish times from observations.
  const steps = state.steps.map((s, i) => {
    const obs = state.observations[i];
    if (!obs) return s;
    return {
      ...s,
      startedAt: new Date(now() - obs.durationMs).toISOString(),
      finishedAt: new Date(now()).toISOString(),
    };
  });
  // Final wall-clock tick.
  budget.recordStageBoundaryWallClock();
  const record: RunRecord = buildRunRecord(
    reflection !== undefined
      ? {
          runId: args.runId,
          agentId: args.agent.agentId,
          tenantId: args.tenantId,
          traceId: args.traceId,
          startedAt,
          finishedAt,
          status,
          steps,
          replanCycles: state.replanCycles,
          errors: state.errors,
          finalReflection: reflection,
          budget: serializeBudget(budget),
        }
      : {
          runId: args.runId,
          agentId: args.agent.agentId,
          tenantId: args.tenantId,
          traceId: args.traceId,
          startedAt,
          finishedAt,
          status,
          steps,
          replanCycles: state.replanCycles,
          errors: state.errors,
          budget: serializeBudget(budget),
        },
  );
  await args.deps.sink.finalize(record);
  await args.deps.sink.append({
    kind: 'finished',
    runId: args.runId,
    status,
    at: finishedAt,
  });
  if (status === 'succeeded') return { status: 'succeeded', runId: args.runId, record };
  if (status === 'aborted') return { status: 'aborted', runId: args.runId, record };
  if (status === 'budget_exceeded') {
    return {
      status: 'budget_exceeded',
      runId: args.runId,
      record,
      error: error ?? toBudgetExceededTypedError(new BudgetExceededError(
        { tokenCeiling: 0 }, budget.spent(), 'plan', args.runId,
      )),
    };
  }
  if (status === 'cancelled') {
    return {
      status: 'cancelled',
      runId: args.runId,
      record,
      error: error ?? makeError({ code: 'Cancelled', message: 'cancelled', runId: args.runId, reason: 'cancelled' }),
    };
  }
  return {
    status: 'failed',
    runId: args.runId,
    record,
    error: error ?? makeError({ code: 'HandlerThrew', message: 'unknown failure', handlerId: 'stage-machine', runId: args.runId, cause: 'no error captured' }),
  };
}

async function finalizeCancelled(
  args: { agent: SubAgentDefinition; runId: RunId; tenantId: string; traceId: string; deps: RuntimeDeps },
  state: RunState,
  now: Clock,
  startedAt: string,
  cancel: CancelToken,
  budget: BudgetMeter,
  tokens: CancelTokenRegistry,
): Promise<InvokeResult> {
  void tokens; // keep the reference for symmetry; registry is process-local
  const reason = cancel.reason ?? 'cancelled';
  const err: TypedError = makeError({
    code: 'Cancelled',
    message: `run cancelled: ${reason}`,
    runId: args.runId,
    reason,
  });
  state.errors.push(err);
  await args.deps.sink.append({
    kind: 'error',
    runId: args.runId,
    error: err,
    at: new Date(now()).toISOString(),
  });
  return finalize(args, state, now, startedAt, 'cancelled', err, undefined, budget);
}

async function finalizeBudgetExceeded(
  args: { agent: SubAgentDefinition; runId: RunId; tenantId: string; traceId: string; deps: RuntimeDeps },
  state: RunState,
  now: Clock,
  startedAt: string,
  e: BudgetExceededError,
  budget: BudgetMeter,
): Promise<InvokeResult> {
  const err = toBudgetExceededTypedError(e);
  state.errors.push(err);
  await args.deps.sink.append({
    kind: 'error',
    runId: args.runId,
    error: err,
    at: new Date(now()).toISOString(),
  });
  return finalize(args, state, now, startedAt, 'budget_exceeded', err, undefined, budget);
}

function isCancellation(e: unknown, cancel: CancelToken): boolean {
  if (cancel.isCancelled) return true;
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (code === 'Cancelled') return true;
  }
  return false;
}

function serializeBudget(budget: BudgetMeter): RunRecord['budget'] {
  return { ceiling: {}, spent: budget.spent() };
}

/**
 * Wrap a v0 `CancelRegistry` in a `CancelTokenRegistry`. The legacy
 * registry has no notion of "token", so the wrapped token resolves
 * synchronously the moment `request` is called. This preserves the v0
 * cancel contract while letting the 0.2.3 code share one cancel
 * surface.
 */
function wrapLegacyRegistry(legacy: CancelRegistry): CancelTokenRegistry {
  const inner = new InMemoryCancelTokenRegistry();
  return {
    token(runId: RunId): CancelToken {
      const tok = inner.token(runId);
      // If the legacy registry has already cancelled, mirror that
      // state. We do this on every token lookup to keep parity with
      // the legacy "fire and forget" semantics.
      if (legacy.isCancelled(runId) && !tok.isCancelled) {
        inner.request(runId, 'cancelled');
      }
      return tok;
    },
    request(runId: RunId, reason: string): void {
      legacy.request(runId);
      inner.request(runId, reason);
    },
    isCancelled(runId: RunId): boolean {
      return legacy.isCancelled(runId) || inner.isCancelled(runId);
    },
    reset(): void {
      // Legacy `CancelRegistry` has no `reset`; we only clear the
      // inner token registry.
      inner.reset();
    },
  };
}

/** Re-export so the runtime index can hand the cancel registry back. */
export { InMemoryCancelTokenRegistry };

/** Build a default-constructed runId. */
export function defaultRunId(): RunId {
  return asRunId(`run_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`);
}
