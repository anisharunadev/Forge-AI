/**
 * Deployment verification — post-deploy smoke tests.
 *
 * Used by the Deploy workflow and the Analytics Center's "Canary Agent"
 * (forge-browser.canary-agent).
 */

import type { DeployVerifyResult, TenantScopedContext } from './types';
import { captureScreenshot } from './agent';
import { compareScreenshots } from './visual-test';

export type { DeployVerifyResult };

export async function verifyDeploy(
  ctx: TenantScopedContext,
  options: { pre_deploy_url: string; post_deploy_url: string; threshold?: number },
): Promise<DeployVerifyResult> {
  const [pre, post] = await Promise.all([
    captureScreenshot(ctx, options.pre_deploy_url),
    captureScreenshot(ctx, options.post_deploy_url),
  ]);
  const diff = await compareScreenshots(ctx, pre, post);
  const threshold = options.threshold ?? 0.05;
  return {
    ...ctx,
    result_id: `dv_${Date.now()}`,
    pre_deploy: pre,
    post_deploy: post,
    diff,
    passed: diff.pixel_diff_ratio <= threshold,
  };
}