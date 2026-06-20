/**
 * Acceptance test entry — FORA-30 §10 / §13 / FORA-146.
 *
 * Runs the five EchoAgent acceptance scenarios in a single suite and
 * fails loudly on any regression. Wired into the `pnpm
 * test:acceptance:runtime` script (see `package.json`).
 *
 * Each scenario produces a `ScenarioResult` whose `failures` list drives
 * the assertion. A scenario-level failure short-circuits the suite with
 * `expect.fail(...)` so CI surfaces the exact message.
 */

import { describe, it, expect } from 'vitest';

import {
  formatScenarioSummary,
  scenario1_happyPath,
  scenario2_allowListNegative,
  scenario3_idempotencyProperty,
  scenario4_budgetAbort,
  scenario5_cancellation,
} from './scenarios.js';

describe('FORA-30 §10 acceptance harness (EchoAgent end-to-end)', () => {
  it('scenario 1 — happy path: 3 ordered notes.append calls succeed', async () => {
    const r = await scenario1_happyPath();
    if (r.failures.length > 0) {
      expect.fail(`scenario 1 failed:\n${formatScenarioSummary(r)}`);
    }
  }, 30_000);

  it('scenario 2 — allow-list negative: fs.delete raises NotAllowed, no notes.append fires', async () => {
    const r = await scenario2_allowListNegative();
    if (r.failures.length > 0) {
      expect.fail(`scenario 2 failed:\n${formatScenarioSummary(r)}`);
    }
  }, 30_000);

  it('scenario 3 — idempotency property: 5 calls same key → handler runs once', async () => {
    const r = await scenario3_idempotencyProperty();
    if (r.failures.length > 0) {
      expect.fail(`scenario 3 failed:\n${formatScenarioSummary(r)}`);
    }
  }, 30_000);

  it('scenario 4 — budget abort: tokenCeiling=1 → BudgetExceeded at plan, no tool fires', async () => {
    const r = await scenario4_budgetAbort();
    if (r.failures.length > 0) {
      expect.fail(`scenario 4 failed:\n${formatScenarioSummary(r)}`);
    }
  }, 30_000);

  it('scenario 5 — cancellation: mid-act cancel → status=cancelled', async () => {
    const r = await scenario5_cancellation();
    if (r.failures.length > 0) {
      expect.fail(`scenario 5 failed:\n${formatScenarioSummary(r)}`);
    }
  }, 30_000);
});
