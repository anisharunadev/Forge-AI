/**
 * Verify phase → @forge-ai/forge-browser integration (Step 45, ZONE 4-C).
 *
 * Drives:
 *   - "Visual regression test" button on PRs (ticket workflow)
 *   - Post-deploy smoke test
 *   - "Open browser preview" button in story detail
 *
 * Falls back to a no-op result when the package is missing.
 */

import type { Screenshot, VisualDiff, DeployVerifyResult } from '@forge-ai/forge-browser';

import { DEV_TENANT_UUID } from '../../config/dev-seeds';

const DEV_PROJECT_UUID = '00000000-0000-4000-8000-000000000001';

let _br: typeof import('@forge-ai/forge-browser') | null = null;
async function getBr(): Promise<typeof import('@forge-ai/forge-browser') | null> {
  if (_br) return _br;
  try {
    _br = await import('@forge-ai/forge-browser');
    return _br;
  } catch {
    return null;
  }
}

function ctx() {
  return { tenant_id: DEV_TENANT_UUID, project_id: DEV_PROJECT_UUID };
}

export interface CaptureScreenshotResult {
  screenshot: Screenshot | null;
  ran_visually: boolean;
}

/** Capture a screenshot for the story preview or PR visual review. */
export async function captureScreenshot(
  url: string,
): Promise<CaptureScreenshotResult> {
  const br = await getBr();
  if (!br) return { screenshot: null, ran_visually: false };
  const screenshot = await br.captureScreenshot(ctx(), url);
  return { screenshot, ran_visually: true };
}

export interface VisualTestResult {
  diff: VisualDiff | null;
  passed: boolean | null;
  ran_visually: boolean;
}

/** Run a visual regression test (PR pre-merge). */
export async function runVisualTest(
  url: string,
  baselineId?: string,
): Promise<VisualTestResult> {
  const br = await getBr();
  if (!br) return { diff: null, passed: null, ran_visually: false };
  const diff = await br.runVisualTest(ctx(), { url, baseline_id: baselineId });
  return { diff, passed: diff.pixel_diff_ratio <= 0.05, ran_visually: true };
}

export interface DeployVerifyOutput {
  result: DeployVerifyResult | null;
  ran_visually: boolean;
}

/** Run a post-deploy smoke test (Canary Agent). */
export async function runDeployVerify(
  preUrl: string,
  postUrl: string,
): Promise<DeployVerifyOutput> {
  const br = await getBr();
  if (!br) return { result: null, ran_visually: false };
  const result = await br.verifyDeploy(ctx(), {
    pre_deploy_url: preUrl,
    post_deploy_url: postUrl,
  });
  return { result, ran_visually: true };
}