/**
 * forge-audit-uat → @forge-ai/forge-browser integration (Step 45, ZONE 4-D).
 *
 * Visual UAT mode — drives the browser through a customer journey,
 * captures screenshots, runs an accessibility audit, and returns a
 * single typed audit report. Falls back to a no-op result when the
 * package is missing so the rest of the audit pipeline keeps working.
 */

import type { A11yAudit, JourneyResult } from '@forge-ai/forge-browser';

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

export interface VisualUatReport {
  journey: JourneyResult | null;
  a11y: A11yAudit | null;
  passed: boolean;
  ran_at: string;
  /** True when the visual automation actually executed. */
  ran_visually: boolean;
}

/**
 * Run visual UAT for the given URL.
 */
export async function runVisualUat(
  url: string,
  steps: Array<{ label: string; url: string; click_selector?: string }> = [],
): Promise<VisualUatReport> {
  const ranAt = new Date().toISOString();
  const br = await getBr();
  if (!br) {
    return {
      journey: null,
      a11y: null,
      passed: false,
      ran_at: ranAt,
      ran_visually: false,
    };
  }

  const [journey, a11y] = await Promise.all([
    steps.length > 0 ? br.runJourney(ctx(), steps) : Promise.resolve(null),
    br.auditAccessibility(ctx(), { url, level: 'AA' }),
  ]);

  return {
    journey,
    a11y,
    passed:
      (journey?.steps_failed ?? 0) === 0 &&
      (a11y?.findings.filter((f) => f.impact === 'critical') ?? []).length === 0,
    ran_at: ranAt,
    ran_visually: true,
  };
}