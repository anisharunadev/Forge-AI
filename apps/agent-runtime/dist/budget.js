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
import { makeError } from './types.js';
export class BudgetExceededError extends Error {
    ceiling;
    spent;
    stage;
    runId;
    constructor(ceiling, spent, stage, runId) {
        super(`budget exceeded at stage "${stage}": spent ${JSON.stringify(spent)} of ${JSON.stringify(ceiling)}`);
        this.ceiling = ceiling;
        this.spent = spent;
        this.stage = stage;
        this.runId = runId;
        this.name = 'BudgetExceededError';
    }
}
export function toBudgetExceededTypedError(err) {
    return makeError({
        code: 'BudgetExceeded',
        message: err.message,
        runId: err.runId,
        stage: err.stage,
        ceiling: err.ceiling,
        spent: err.spent,
    });
}
function addTokens(target, usage) {
    if (typeof usage.tokens === 'number') {
        target.tokens += usage.tokens;
        return;
    }
    if ('inputTokens' in usage || 'outputTokens' in usage) {
        const u = usage;
        target.tokens += (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
    }
}
function addUsd(target, usage) {
    if (typeof usage.usd === 'number')
        target.usd += usage.usd;
}
export class BudgetMeter {
    _spent = { tokens: 0, usd: 0, wallClockMs: 0 };
    ceiling;
    startedAtMs;
    now;
    constructor(args) {
        this.ceiling = args.ceiling;
        this.startedAtMs = args.startedAtMs;
        this.now = args.now;
    }
    spent() {
        return { ...this._spent };
    }
    /**
     * Throw `BudgetExceededError` if any axis would exceed its ceiling if
     * the stage at hand began now. Called *before* each stage.
     */
    checkBeforeStage(stage, runId) {
        const projected = this.project();
        const violations = this.violations(projected);
        if (violations.length === 0)
            return;
        throw new BudgetExceededError(this.ceiling, projected, stage, runId);
    }
    recordPlannerLlm(usage) {
        addTokens(this._spent, usage);
        addUsd(this._spent, usage);
    }
    recordReflectorLlm(usage) {
        addTokens(this._spent, usage);
        addUsd(this._spent, usage);
    }
    recordToolCostHint(hint) {
        addTokens(this._spent, hint);
        addUsd(this._spent, hint);
    }
    /** Update the wall-clock axis with the elapsed ms since the run started. */
    recordStageBoundaryWallClock() {
        this._spent.wallClockMs = Math.max(0, this.now() - this.startedAtMs);
    }
    project() {
        return { ...this._spent, wallClockMs: Math.max(0, this.now() - this.startedAtMs) };
    }
    violations(s) {
        const out = [];
        if (this.ceiling.tokenCeiling !== undefined && s.tokens > this.ceiling.tokenCeiling)
            out.push('tokens');
        if (this.ceiling.usdCeiling !== undefined && s.usd > this.ceiling.usdCeiling)
            out.push('usd');
        if (this.ceiling.wallClockCeilingMs !== undefined &&
            s.wallClockMs > this.ceiling.wallClockCeilingMs)
            out.push('wallClock');
        return out;
    }
}
/** A meter with no ceiling — the default for runs that don't specify one. */
export class UnlimitedBudgetMeter extends BudgetMeter {
    constructor(args) {
        super({ runId: args.runId, ceiling: {}, startedAtMs: args.now(), now: args.now });
    }
    checkBeforeStage() { }
}
//# sourceMappingURL=budget.js.map