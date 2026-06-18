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
import type { CancelToken, IdempotencyKey, Observation, RunId, Stage, StepId, SubAgentDefinition, ToolName, TypedError } from './types.js';
import { asIdempotencyKey } from './types.js';
import { type IdempotencyStore } from './idempotency.js';
/** Resolve the allow-list for a given stage. */
export declare function allowedToolsFor(agent: SubAgentDefinition, stage: Stage): ReadonlySet<ToolName>;
/** True iff a tool is allow-listed for the given stage. */
export declare function isAllowed(agent: SubAgentDefinition, stage: Stage, tool: ToolName): boolean;
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
export declare function invokeTool(args: {
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
}): Promise<{
    ok: true;
    observation: Observation;
} | {
    ok: false;
    error: TypedError;
    observation: Observation;
}>;
/**
 * The stepId is supplied by the planner. We mint one here only if the
 * caller forgot — strictly an aid for callers, not a code path the stage
 * machine ever exercises.
 */
export declare function ensureStepId(s: string | undefined, fallback: string): StepId;
/** Re-export the cast helper so the public surface stays canonical. */
export { asIdempotencyKey };
