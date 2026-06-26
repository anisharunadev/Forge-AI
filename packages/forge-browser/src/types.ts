/**
 * Shared types for @forge-ai/forge-browser.
 */

export interface TenantScopedContext {
  tenant_id: string;
  project_id: string;
  user_id?: string;
}

export interface BrowserSession extends TenantScopedContext {
  session_id: string;
  started_at: string;
  viewport: { width: number; height: number };
  user_agent: string;
}

export interface Screenshot extends TenantScopedContext {
  screenshot_id: string;
  url: string;
  width: number;
  height: number;
  /** PNG bytes encoded as a data URI — never the raw binary. */
  data_uri: string;
  captured_at: string;
}

export interface VisualDiff extends TenantScopedContext {
  diff_id: string;
  baseline_id: string;
  candidate_id: string;
  /** 0..1 — 0 is identical, 1 is fully different. */
  pixel_diff_ratio: number;
  /** Bounding boxes of differing regions (px). */
  regions: Array<{ x: number; y: number; width: number; height: number }>;
}

export type WcagLevel = 'A' | 'AA' | 'AAA';

export interface A11yFinding {
  rule_id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  /** CSS selector that triggered the finding. */
  selector: string;
  help_url: string;
}

export interface A11yAudit extends TenantScopedContext {
  audit_id: string;
  url: string;
  level: WcagLevel;
  findings: A11yFinding[];
  audited_at: string;
}

export interface JourneyStep {
  /** A short, human-readable step name. */
  label: string;
  /** URL to navigate to. */
  url: string;
  /** Optional CSS selector to click before capture. */
  click_selector?: string;
}

export interface JourneyResult extends TenantScopedContext {
  journey_id: string;
  steps_executed: number;
  steps_failed: number;
  screenshots: Screenshot[];
  completed_at: string;
}

export interface DeployVerifyResult extends TenantScopedContext {
  result_id: string;
  pre_deploy: Screenshot;
  post_deploy: Screenshot;
  diff: VisualDiff;
  passed: boolean;
}