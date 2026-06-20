/**
 * Allow-list gateway.
 *
 * Per §5 of the design doc, the gateway is the *only* path from sub-agent
 * intent to handler invocation. Direct handler imports are blocked at
 * lint time (the `no-direct-handlers` rule in this package's lint config);
 * runtime code must route through `invokeTool`.
 *
 * The module is private: only `runtime/index.ts` re-exports `invokeTool`,
 * and the file is marked `@internal` so accidental deep imports fail
 * the type checker if they bypass the index barrel.
 *
 * 0.2.3 wiring: idempotency (dedupe + replay), retry with full-jitter
 * backoff, and an `AbortSignal` exposed on `ToolCtx` for handlers that
 * want to short-circuit internal awaits.
 *
 * @internal
 */

import type {
  CancelToken,
  IdempotencyKey,
  Observation,
  RegisteredHandler,
  RunId,
  Stage,
  StepId,
  SubAgentDefinition,
  ToolCtx,
  ToolName,
  TypedError
} from './types.js';
import { asIdempotencyKey, asStepId, makeError } from './types.js';
import { type IdempotencyStore } from './idempotency.js';
import { withRetry, CancelledError, type RetryOpts } from './retry.js';

/** Resolve the allow-list for a given stage. */
export function allowedToolsFor(
  agent: SubAgentDefinition,
  stage: Stage,
): ReadonlySet<ToolName> {
  switch (stage) {
    case 'plan':
      return agent.stagePolicy.plan.allowedTools;
    case 'act':
      return agent.stagePolicy.act.allowedTools;
    case 'observe':
      return agent.stagePolicy.observe.allowedTools;
    case 'reflect':
      return agent.stagePolicy.reflect.allowedTools;
  }
}

/** True iff a tool is allow-listed for the given stage. */
export function isAllowed(
  agent: SubAgentDefinition,
  stage: Stage,
  tool: ToolName,
): boolean {
  return allowedToolsFor(agent, stage).has(tool);
}

/** Args added in 0.2.3; older call sites can omit. */
export interface InvokeToolOpts {
  /** Idempotency store (LRU, in-process). Defaults to a null store. */
  idempotency?: IdempotencyStore;
  /** Cancel token — drives retry backoff abort + signal on `ToolCtx`. */
  cancel?: CancelToken;
  /** Sleep function (test seam for retry). */
  sleep?: (ms: number) => Promise<void>;
  /** TTL for idempotency records (test seam). Defaults to 5 minutes. */
  idempotencyTtlMs?: number;
}

/**
 * The single entry point from sub-agent intent to handler invocation.
 *
 * Pre-conditions (asserted in order, fail closed):
 *   1. The handler is registered for the agent.
 *   2. The tool is in the stage's allow-list.
 *   3. The handler's `toolName` matches the call site's `tool`.
 *
 * On any pre-condition failure a typed error is returned; the stage
 * machine decides what to do (replan / abort / record).
 *
 * 0.2.3 additions:
 *   - Idempotency dedupe at the `(agentId, tool, stepKey)` grain.
 *   - Retry on `RetryableError`, with full-jitter backoff, cancellable.
 *   - `AbortSignal` on the handler's `ToolCtx` for cooperative cancel.
 *   - `costHint` extraction from `ToolResult` output, recorded on the
 *     observation for the budget meter to consume.
 */
export async function invokeTool(args: {
  agent: SubAgentDefinition;
  runId: RunId;
  stage: Stage;
  stepId: StepId;
  tool: ToolName;
  input: unknown;
  now: () => number;
  traceId: string;
  tenantId: string;
  /** Optional per-step idempotency key (overrides the handler's default). */
  idempotencyKey?: IdempotencyKey;
  /** Optional injection seam for tests; 0.2.3 wires default impls. */
  opts?: InvokeToolOpts;
}): Promise<
  | { ok: true; observation: Observation }
  | { ok: false; error: TypedError; observation: Observation }
> {
  const startedAt = args.now();
  const handler = findHandler(args.agent, args.tool);
  if (!handler) {
    const err: TypedError = {
      code: 'NotAllowed',
      message: `tool "${args.tool}" is not in stage "${args.stage}" allow-list`,
      tool: args.tool,
      stage: args.stage,
      runId: args.runId,
    };
    const observation: Observation = {
      stepId: args.stepId,
      tool: args.tool,
      output: null,
      ok: false,
      errorOutput: err,
      durationMs: args.now() - startedAt,
    };
    return { ok: false, error: makeError(err), observation };
  }
  // Belt + suspenders: handler.toolName must match the call site.
  if (handler.toolName !== args.tool) {
    const err: TypedError = {
      code: 'NotAllowed',
      message: `handler "${handler.handlerId}" is registered for tool "${handler.toolName}" but call site requested "${args.tool}"`,
      tool: args.tool,
      stage: args.stage,
      runId: args.runId,
    };
    const observation: Observation = {
      stepId: args.stepId,
      tool: args.tool,
      output: null,
      ok: false,
      errorOutput: err,
      durationMs: args.now() - startedAt,
    };
    return { ok: false, error: makeError(err), observation };
  }

  // Resolve the effective idempotency key for this step. Precedence:
  //   1. Per-step key from the planner (highest).
  //   2. Handler-level key from registration.
  const stepKey: IdempotencyKey | undefined =
    args.idempotencyKey ?? handler.idempotencyKey;

  const store = args.opts?.idempotency;
  // Dedupe check. The store is keyed by (agentId, tool, key). On a hit we
  // replay the cached result *without* invoking the handler.
  if (store && stepKey) {
    const hit = store.get(args.agent.agentId, String(args.tool), String(stepKey));
    if (hit) {
      const observation: Observation = {
        stepId: args.stepId,
        tool: args.tool,
        output: hit.output,
        ok: true,
        durationMs: args.now() - startedAt,
        idempotencyKey: stepKey,
        idempotencyHit: {
          key: stepKey,
          storedAt: new Date(hit.storedAt).toISOString(),
        },
      };
      return { ok: true, observation };
    }
  }

  // Build an AbortController that mirrors the cancel token. The signal is
  // exposed on `ToolCtx`; handlers that await on it can short-circuit.
  const ac = new AbortController();
  const cancel = args.opts?.cancel;
  if (cancel) {
    if (cancel.isCancelled) ac.abort(new Error(cancel.reason ?? 'cancelled'));
    else {
      void cancel.whenCancelled.then(() => {
        ac.abort(new Error(cancel.reason ?? 'cancelled'));
      });
    }
  }

  const ctx: ToolCtx = {
    runId: args.runId,
    agentId: args.agent.agentId,
    stage: args.stage,
    stepId: args.stepId,
    traceId: args.traceId,
    tenantId: args.tenantId,
    signal: ac.signal,
  };

  // Retry policy. Default: one attempt. Handlers may opt in via
  // `handler.retry`. The loop is cancellable and surfaces `Cancelled`.
  const baseSleep = args.opts?.sleep;
  const cancelToken = cancel ?? neverCancelledToken();
  const retry: RetryOpts = handler.retry
    ? {
        maxAttempts: handler.retry.maxAttempts,
        backoff: handler.retry.backoff,
        ...(baseSleep ? { sleep: baseSleep } : {}),
        cancel: cancelToken,
      }
    : {
        maxAttempts: 1,
        backoff: { base: 0, factor: 1, max: 0, fullJitter: false },
        ...(baseSleep ? { sleep: baseSleep } : {}),
        cancel: cancelToken,
      };

  try {
    const out = await withRetry(() => Promise.resolve(handler.invoke(args.input, ctx)), retry);
    // Extract `costHint` if the handler returned a `ToolResult`.
    const costHint = extractCostHint(out);
    // Cache the successful output. Failed invocations are *not* cached.
    if (store && stepKey) {
      store.set(
        args.agent.agentId,
        String(args.tool),
        String(stepKey),
        out,
        args.opts?.idempotencyTtlMs ?? 5 * 60 * 1000,
      );
    }
    const observation: Observation = {
      stepId: args.stepId,
      tool: args.tool,
      output: out,
      ok: true,
      durationMs: args.now() - startedAt,
      ...(stepKey !== undefined ? { idempotencyKey: stepKey } : {}),
      ...(costHint ? { costHint } : {}),
    };
    return { ok: true, observation };
  } catch (e) {
    if (e instanceof CancelledError) {
      const err: TypedError = {
        code: 'Cancelled',
        message: `tool "${args.tool}" cancelled: ${e.reason}`,
        runId: args.runId,
        reason: e.reason,
      };
      const observation: Observation = {
        stepId: args.stepId,
        tool: args.tool,
        output: null,
        ok: false,
        errorOutput: err,
        durationMs: args.now() - startedAt,
        ...(stepKey !== undefined ? { idempotencyKey: stepKey } : {}),
      };
      return { ok: false, error: makeError(err), observation };
    }
    const cause = e instanceof Error ? e.message : String(e);
    const err: TypedError = {
      code: 'HandlerThrew',
      message: `handler "${handler.handlerId}" threw`,
      handlerId: handler.handlerId,
      runId: args.runId,
      cause,
    };
    const observation: Observation = {
      stepId: args.stepId,
      tool: args.tool,
      output: null,
      ok: false,
      errorOutput: err,
      durationMs: args.now() - startedAt,
      ...(stepKey !== undefined ? { idempotencyKey: stepKey } : {}),
    };
    return { ok: false, error: makeError(err), observation };
  }
}

function findHandler(
  agent: SubAgentDefinition,
  tool: ToolName,
): RegisteredHandler | undefined {
  for (const h of agent.handlers.values()) {
    if (h.toolName === tool) return h;
  }
  return undefined;
}

function extractCostHint(out: unknown): { tokens?: number; usd?: number } | undefined {
  if (out && typeof out === 'object' && 'output' in (out as Record<string, unknown>)) {
    const hint = (out as { costHint?: { tokens?: number; usd?: number } }).costHint;
    if (hint && (typeof hint.tokens === 'number' || typeof hint.usd === 'number')) {
      return hint;
    }
  }
  return undefined;
}

function neverCancelledToken(): CancelToken {
  return {
    get isCancelled() { return false; },
    whenCancelled: new Promise<{ reason: string }>(() => { /* never */ }),
    get reason() { return undefined; },
  };
}

/**
 * The stepId is supplied by the planner. We mint one here only if the
 * caller forgot — strictly an aid for callers, not a code path the stage
 * machine ever exercises.
 */
export function ensureStepId(s: string | undefined, fallback: string): StepId {
  return s !== undefined ? asStepId(s) : asStepId(fallback);
}

/** Re-export the cast helper so the public surface stays canonical. */
export { asIdempotencyKey };
