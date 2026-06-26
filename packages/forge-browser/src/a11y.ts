/**
 * Accessibility audit (WCAG).
 *
 * Powers `forge-audit-uat` and the Architecture Center's "Diagrams" tab
 * visual review. Stub returns zero findings; real impl dispatches to
 * axe-core via Playwright.
 */

import type { A11yAudit, TenantScopedContext, WcagLevel } from './types';

export async function auditAccessibility(
  ctx: TenantScopedContext,
  options: { url: string; level?: WcagLevel },
): Promise<A11yAudit> {
  return {
    ...ctx,
    audit_id: `a11y_${Date.now()}`,
    url: options.url,
    level: options.level ?? 'AA',
    findings: [],
    audited_at: new Date().toISOString(),
  };
}