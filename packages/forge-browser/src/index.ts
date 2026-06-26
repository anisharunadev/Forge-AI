/**
 * @forge-ai/forge-browser — Forge Browser
 *
 * Visual automation for the Forge AI Agent OS. Every export is typed
 * and tenant-scoped (Forge Rule 2).
 */

export type {
  TenantScopedContext,
  BrowserSession,
  Screenshot,
  VisualDiff,
  WcagLevel,
  A11yFinding,
  A11yAudit,
  JourneyStep,
  JourneyResult,
  DeployVerifyResult,
} from './types';

export { openBrowser, captureScreenshot } from './agent';
export { compareScreenshots, runVisualTest } from './visual-test';
export { reviewUI } from './ui-review';
export { verifyDeploy } from './deploy-verify';
export { runJourney } from './journey';
export { auditAccessibility } from './a11y';

/**
 * Default feature flag — true when the package is wired in. Consumers
 * read this to decide whether to invoke real automation or fall back
 * to manual review.
 */
export const FORGE_BROWSER_INSTALLED = true as const;