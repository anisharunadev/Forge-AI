/**
 * Visual testing — screenshot comparison and regression detection.
 */

import type { Screenshot, TenantScopedContext, VisualDiff } from './types';
import { captureScreenshot } from './agent';

export async function compareScreenshots(
  ctx: TenantScopedContext,
  baseline: Screenshot,
  candidate: Screenshot,
): Promise<VisualDiff> {
  // Stub: identical screenshots → 0 diff. Real impl will pixel-diff.
  const sameDimensions =
    baseline.width === candidate.width && baseline.height === candidate.height;
  return {
    ...ctx,
    diff_id: `vd_${baseline.screenshot_id}_${candidate.screenshot_id}`,
    baseline_id: baseline.screenshot_id,
    candidate_id: candidate.screenshot_id,
    pixel_diff_ratio: sameDimensions ? 0 : 0.5,
    regions: [],
  };
}

export async function runVisualTest(
  ctx: TenantScopedContext,
  options: { url: string; baseline_id?: string },
): Promise<VisualDiff> {
  const candidate = await captureScreenshot(ctx, options.url);
  const baseline: Screenshot = {
    ...ctx,
    screenshot_id: options.baseline_id ?? `baseline_${options.url}`,
    url: options.url,
    width: candidate.width,
    height: candidate.height,
    data_uri: candidate.data_uri,
    captured_at: new Date(0).toISOString(),
  };
  return compareScreenshots(ctx, baseline, candidate);
}