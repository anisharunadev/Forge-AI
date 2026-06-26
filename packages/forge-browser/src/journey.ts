/**
 * Customer journey testing — automated end-to-end flow validation.
 *
 * Powers the UAT automation in `forge-audit-uat`. Each journey step
 * captures a screenshot so the AI agent can review what happened.
 */

import type { JourneyResult, JourneyStep, Screenshot, TenantScopedContext } from './types';
import { captureScreenshot } from './agent';

export async function runJourney(
  ctx: TenantScopedContext,
  steps: JourneyStep[],
): Promise<JourneyResult> {
  const screenshots: Screenshot[] = [];
  let failed = 0;

  for (const step of steps) {
    try {
      const ss = await captureScreenshot(ctx, step.url);
      screenshots.push(ss);
    } catch {
      failed++;
    }
  }

  return {
    ...ctx,
    journey_id: `journey_${Date.now()}`,
    steps_executed: steps.length,
    steps_failed: failed,
    screenshots,
    completed_at: new Date().toISOString(),
  };
}