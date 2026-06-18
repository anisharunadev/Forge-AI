/**
 * Budget meter — §7 of the design doc.
 *
 * Tracks three axes per run: tokens (input + output), USD, wall-clock ms.
 * Spend is recorded at exactly four sites:
 *
 *   1. Planner LLM result            (recordPlannerLlm)
 *   2. Reflector LLM result          (recordReflectorLlm)
 *   3. Tool handler `costHint`       (recordToolCostHint)
 *   4. Stage-boundary wall-clock     (recordStageBoundaryWallClock)
 *
 * Pre-stage check raises `BudgetExceeded` with `{ ceiling, spent }`
 * snapshots when the run would exceed any axis. After `BudgetExceeded`
 * the stage machine aborts the run; no further stage runs execute.
 *
 * The meter is pure state — no I/O. The stage machine is the only caller.
 */
import { type RunId, type Stage, type TypedError } from './types.js';
export interface Budget {
    /** Token ceiling (input + output). Optional. */
    tokenCeiling?: number;
    /** USD ceiling. Optional. */
    usdCeiling?: number;
    /** Wall-clock ceiling in ms. Optional. */
    wallClockCeilingMs?: number;
}
export interface SpendSnapshot {
    tokens: number;
    usd: number;
    wallClockMs: number;
}
export interface LlmUsage {
    inputTokens?: number;
    outputTokens?: number;
    /** Total tokens (input + output). Optional; the meter sums what's given. */
    tokens?: number;
    usd?: number;
}
export interface ToolCostHint {
    tokens?: number;
    usd?: number;
}
export declare class BudgetExceededError extends Error {
    readonly ceiling: Budget;
    readonly spent: SpendSnapshot;
    readonly stage: Stage;
    readonly runId: RunId;
    constructor(ceiling: Budget, spent: SpendSnapshot, stage: Stage, runId: RunId);
}
export declare function toBudgetExceededTypedError(err: BudgetExceededError): TypedError;
export declare class BudgetMeter {
    private readonly _spent;
    private readonly ceiling;
    private readonly startedAtMs;
    private readonly now;
    constructor(args: {
        runId: RunId;
        ceiling: Budget;
        startedAtMs: number;
        now: () => number;
    });
    spent(): SpendSnapshot;
    /**
     * Throw `BudgetExceededError` if any axis would exceed its ceiling if
     * the stage at hand began now. Called *before* each stage.
     */
    checkBeforeStage(stage: Stage, runId: RunId): void;
    recordPlannerLlm(usage: LlmUsage): void;
    recordReflectorLlm(usage: LlmUsage): void;
    recordToolCostHint(hint: ToolCostHint): void;
    /** Update the wall-clock axis with the elapsed ms since the run started. */
    recordStageBoundaryWallClock(): void;
    private project;
    private violations;
}
/** A meter with no ceiling — the default for runs that don't specify one. */
export declare class UnlimitedBudgetMeter extends BudgetMeter {
    constructor(args: {
        runId: RunId;
        now: () => number;
    });
    checkBeforeStage(): void;
}
