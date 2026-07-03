/**
 * Lessons Learned — typed mirror of `backend/app/schemas/lesson.py`
 * (F-002-LESSON / Step-64 Sub-step B).
 *
 * The Pydantic schemas are the source of truth; if you change one
 * side, change the other. Rule 4 (typed artifacts) — no free-form blobs.
 */

export type LessonStatus = 'pending' | 'approved' | 'rejected';

export type LessonSource =
  | 'run.failed'
  | 'workflow.failed'
  | 'rollback'
  | 'bad_outcome.tag'
  | 'metric.degraded'
  | 'deployment.alert';

export interface LessonEvidenceRef {
  ref_type: 'audit_event' | 'command_run' | 'validation_report' | 'deployment';
  ref_id: string;
  summary?: string;
}

export interface LessonCandidateWire {
  id: string;
  tenant_id: string;
  project_id?: string | null;
  run_id?: string | null;
  source_event: LessonSource;
  title: string;
  body: string;
  proposed_skill_name?: string | null;
  evidence: LessonEvidenceRef[];
  status: LessonStatus;
  promoted_template_id?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  review_notes?: string | null;
  created_at: string;
  schema_version: number;
}

export interface LessonCandidateListResponse {
  items: LessonCandidateWire[];
  total: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
}

export interface LessonDecideRequest {
  editor_id: string;
  review_notes?: string;
  title_override?: string;
  body_override?: string;
  proposed_skill_name_override?: string;
}

export interface LessonDecisionResult {
  candidate: LessonCandidateWire;
  promoted_template_id?: string | null;
  promoted_skill_name?: string | null;
}

export interface MonthlyDigest {
  tenant_id: string;
  period_start: string;
  period_end: string;
  pending: LessonCandidateWire[];
  approved: LessonCandidateWire[];
  rejected: LessonCandidateWire[];
  by_source: Record<string, number>;
  auto_promotable_skill?: string | null;
  notes: string;
}
