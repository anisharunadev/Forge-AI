/**
 * Run-level explainability bundle (Step-64 Sub-step A).
 *
 * Mirrors the backend Pydantic schema in
 * `backend/app/schemas/explainability.py`. Keep the two in sync — the
 * service recomputes the bundle on every request, so any drift is
 * caught at the first fetch.
 *
 * Used by:
 *   - `useRunExplainability(runId)` — TanStack Query hook
 *   - `getRunExplainability(runId)` — typed fetcher
 *   - `<ExplainabilityPanel runId={...} />` — five-card UI
 */

export type RunExplainabilityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type ChangeKind = 'added' | 'removed' | 'modified' | 'renamed';
export type CheckOutcome = 'pass' | 'fail' | 'warn' | 'skip';
export type CheckSource = 'validation_report' | 'audit_events' | 'policy_engine';
export type Calibration = 'token_logprob' | 'validation_passes' | 'heuristic' | 'human_only';

export interface ChangeEntry {
  file: string;
  change_kind: ChangeKind;
  lines_added: number;
  lines_removed: number;
  rationale: string;
  citation?: string | null;
}

export interface Q1ChangesAndWhy {
  summary: string;
  changes: ChangeEntry[];
  citations: string[];
}

export interface CheckEntry {
  name: string;
  category: string;
  outcome: CheckOutcome;
  detail: string;
  source: CheckSource;
}

export interface Q2ChecksPerformed {
  total_checks: number;
  passed: number;
  failed: number;
  skipped: number;
  entries: CheckEntry[];
}

export interface Q3CoverageGaps {
  explicit_gaps: string[];
  implicit_gaps: string[];
  coverage_pct: number;
}

export interface Q4ConfidenceScore {
  raw_score: number;
  calibration: Calibration;
  threshold: number;
  would_escalate: boolean;
  bands_observed: Record<string, number>;
}

export interface Q5Counterfactual {
  conditions: string[];
  counter_recommendation: string;
}

export interface RunExplainability {
  run_id: string;
  tenant_id: string;
  project_id: string;
  what_changed: Q1ChangesAndWhy;
  what_checked: Q2ChecksPerformed;
  coverage_gaps: Q3CoverageGaps;
  confidence: Q4ConfidenceScore;
  counterfactual: Q5Counterfactual;
  computed_at: string;
  schema_version: number;
  grade: RunExplainabilityGrade;
  grade_rationale: string;
}