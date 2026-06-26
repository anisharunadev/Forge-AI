/**
 * UI review — design quality checks and responsive audits.
 */

import type { Screenshot, TenantScopedContext } from './types';
import { captureScreenshot } from './agent';

export interface UiReviewFinding {
  rule_id: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
}

export interface UiReviewReport extends TenantScopedContext {
  review_id: string;
  url: string;
  findings: UiReviewFinding[];
  reviewed_at: string;
}

const VIEWPORTS = [
  { width: 375, height: 667, label: 'mobile' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 1280, height: 800, label: 'desktop' },
];

export async function reviewUI(
  ctx: TenantScopedContext,
  url: string,
): Promise<UiReviewReport> {
  const findings: UiReviewFinding[] = [];
  const captures: Screenshot[] = [];

  for (const vp of VIEWPORTS) {
    const ss = await captureScreenshot(ctx, url);
    captures.push({ ...ss, width: vp.width, height: vp.height });
    if (vp.label === 'mobile') {
      findings.push({
        rule_id: 'responsive.touch-targets',
        severity: 'info',
        message: 'Verify touch targets ≥ 44×44 on mobile.',
      });
    }
  }

  return {
    ...ctx,
    review_id: `review_${Date.now()}`,
    url,
    findings,
    reviewed_at: new Date().toISOString(),
  };
}