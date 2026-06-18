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
import type { RunRecordSink } from './run-record.js';
import { type CancelTokenRegistry, InMemoryCancelTokenRegistry } from './cancel.js';
import { type IdempotencyStore } from './idempotency.js';
import type { RunId, RunRecord, SubAgentDefinition, TypedError } from './types.js';
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
/** Result returned by `runtime.invoke`. */
export type InvokeResult = {
    status: 'succeeded';
    runId: RunId;
    record: RunRecord;
} | {
    status: 'failed';
    runId: RunId;
    record: RunRecord;
    error: TypedError;
} | {
    status: 'aborted';
    runId: RunId;
    record: RunRecord;
} | {
    status: 'budget_exceeded';
    runId: RunId;
    record: RunRecord;
    error: TypedError;
} | {
    status: 'cancelled';
    runId: RunId;
    record: RunRecord;
    error: TypedError;
};
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
export declare function runStages(args: {
    agent: SubAgentDefinition;
    runId: RunId;
    tenantId: string;
    traceId: string;
    inputs: import('./types.js').RunInputs;
    deps: RuntimeDeps;
}): Promise<InvokeResult>;
/** Re-export so the runtime index can hand the cancel registry back. */
export { InMemoryCancelTokenRegistry };
/** Build a default-constructed runId. */
export declare function defaultRunId(): RunId;
