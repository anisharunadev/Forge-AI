/**
 * Unit tests for the budget meter (FORA-145 §7).
 *
 *   - The four sites record into the meter.
 *   - The pre-stage check raises `BudgetExceeded` on each axis.
 *   - The check is *before* the stage; an exceeded meter does not
 *     pay for additional stage work.
 */

import { describe, it, expect } from 'vitest';

import {
  BudgetExceededError,
  BudgetMeter,
  UnlimitedBudgetMeter,
  toBudgetExceededTypedError,
} from '../src/budget.js';
import { asRunId } from '../src/types.js';

const RUN_ID = asRunId('run-budget-1');

describe('budget: pre-stage check on each axis', () => {
  it('throws when tokens exceed the ceiling', () => {
    let t = 0;
    const meter = new BudgetMeter({
      runId: RUN_ID,
      ceiling: { tokenCeiling: 5 },
      startedAtMs: t,
      now: () => t,
    });
    meter.recordPlannerLlm({ tokens: 4 });
    // 4 <= 5, OK
    expect(() => meter.checkBeforeStage('plan', RUN_ID)).not.toThrow();
    meter.recordPlannerLlm({ tokens: 2 });
    // 6 > 5
    expect(() => meter.checkBeforeStage('act', RUN_ID)).toThrow(BudgetExceededError);
  });

  it('throws when USD exceeds the ceiling', () => {
    let t = 0;
    const meter = new BudgetMeter({
      runId: RUN_ID,
      ceiling: { usdCeiling: 0.5 },
      startedAtMs: t,
      now: () => t,
    });
    meter.recordReflectorLlm({ usd: 0.4 });
    expect(() => meter.checkBeforeStage('reflect', RUN_ID)).not.toThrow();
    meter.recordToolCostHint({ usd: 0.2 });
    expect(() => meter.checkBeforeStage('act', RUN_ID)).toThrow(BudgetExceededError);
  });

  it('throws when wall-clock exceeds the ceiling', () => {
    let t = 0;
    const meter = new BudgetMeter({
      runId: RUN_ID,
      ceiling: { wallClockCeilingMs: 100 },
      startedAtMs: t,
      now: () => t,
    });
    t = 99;
    expect(() => meter.checkBeforeStage('act', RUN_ID)).not.toThrow();
    t = 101;
    expect(() => meter.checkBeforeStage('observe', RUN_ID)).toThrow(BudgetExceededError);
  });

  it('records wall-clock from the four sites', () => {
    let t = 0;
    const meter = new BudgetMeter({
      runId: RUN_ID,
      ceiling: {},
      startedAtMs: t,
      now: () => t,
    });
    // Site 1: planner LLM
    meter.recordPlannerLlm({ inputTokens: 10, outputTokens: 5, usd: 0.001 });
    // Site 2: reflector LLM
    meter.recordReflectorLlm({ inputTokens: 3, outputTokens: 2, usd: 0.0005 });
    // Site 3: tool handler costHint
    meter.recordToolCostHint({ tokens: 1, usd: 0.0001 });
    t = 50;
    // Site 4: stage-boundary wall-clock
    meter.recordStageBoundaryWallClock();
    const spent = meter.spent();
    expect(spent.tokens).toBe(10 + 5 + 3 + 2 + 1);
    expect(spent.usd).toBeCloseTo(0.001 + 0.0005 + 0.0001);
    expect(spent.wallClockMs).toBe(50);
  });

  it('accepts a `tokens` shortcut in LLM usage', () => {
    const meter = new BudgetMeter({
      runId: RUN_ID,
      ceiling: {},
      startedAtMs: 0,
      now: () => 0,
    });
    meter.recordPlannerLlm({ tokens: 42 });
    expect(meter.spent().tokens).toBe(42);
  });

  it('does not throw on uncapped axes (UnlimitedBudgetMeter)', () => {
    const meter = new UnlimitedBudgetMeter({ runId: RUN_ID, now: () => 0 });
    meter.recordPlannerLlm({ tokens: 1_000_000 });
    meter.recordReflectorLlm({ tokens: 1_000_000 });
    meter.recordToolCostHint({ tokens: 1_000_000 });
    expect(() => meter.checkBeforeStage('plan', RUN_ID)).not.toThrow();
    expect(() => meter.checkBeforeStage('act', RUN_ID)).not.toThrow();
  });

  it('throws include ceiling and spent snapshots', () => {
    let t = 0;
    const meter = new BudgetMeter({
      runId: RUN_ID,
      ceiling: { tokenCeiling: 10, usdCeiling: 0.1, wallClockCeilingMs: 1000 },
      startedAtMs: t,
      now: () => t,
    });
    meter.recordPlannerLlm({ tokens: 20, usd: 0.05 });
    t = 500;
    meter.recordStageBoundaryWallClock();
    try {
      meter.checkBeforeStage('act', RUN_ID);
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      const err = e as BudgetExceededError;
      expect(err.ceiling.tokenCeiling).toBe(10);
      expect(err.ceiling.usdCeiling).toBe(0.1);
      expect(err.ceiling.wallClockCeilingMs).toBe(1000);
      expect(err.spent.tokens).toBe(20);
      expect(err.spent.usd).toBeCloseTo(0.05);
      expect(err.spent.wallClockMs).toBe(500);
      expect(err.stage).toBe('act');
      const typed = toBudgetExceededTypedError(err);
      expect(typed.code).toBe('BudgetExceeded');
    }
  });
});
