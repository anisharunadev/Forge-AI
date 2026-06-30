/**
 * Typed wire shapes for the Ideation Center (F-201..F-213).
 *
 * Step-57 Zone 5 — these interfaces mirror the backend Pydantic schemas
 * in `backend/app/schemas/ideation.py` and the ORM enums in
 * `backend/app/db/models/ideation.py` 1:1. Every field on the wire
 * round-trips through the orchestrator + tenant context (Rule 2), so
 * the typed artifacts here include `tenant_id` and `project_id` even
 * though most UI surfaces don't display them.
 *
 * The legacy `lib/ideation/data.ts` exports its own (M2+) view-model
 * types (e.g. `IdeaStatus = 'intake' | 'scoring' | 'discovery' | …`).
 * Those stay — they back the in-progress read-only UI. The types in
 * this file are the **authoritative** wire shapes used by the
 * TanStack Query hooks in `lib/hooks/useIdeation.ts` so consumers can
 * safely render server-issued fields (`source`, `submitted_by`,
 * `status`, etc.) without re-mapping.
 *
 * String-union types are used for every status / decision enum so a
 * typo at a call-site is a TS error, not a runtime 400.
 */

// ---------------------------------------------------------------------------
// Status / decision string-union enums — locked to backend ORM enum values
// (see `backend/app/db/models/ideation.py`).
// ---------------------------------------------------------------------------

/** `IdeaStatus` — lifecycle of an Idea from intake to delivery. */
export type IdeaStatus =
  | 'new'
  | 'analyzing'
  | 'scored'
  | 'approved'
  | 'in_roadmap'
  | 'rejected'
  | 'archived';

/** `IdeaSource` — how an idea entered the system. */
export type IdeaSource = 'user' | 'community' | 'signal' | 'roadmap' | 'feedback';

/** `ScoreSource` — who/what produced a score. */
export type ScoreSource = 'ai' | 'human' | 'hybrid';

/** `RoadmapHorizon` — time horizon for a roadmap bucket. */
export type RoadmapHorizon = 'now' | 'next' | 'later' | 'future';

/** `RoadmapStatus` — roadmap lifecycle. */
export type RoadmapStatus =
  | 'draft'
  | 'proposed'
  | 'approved'
  | 'published'
  | 'archived';

/** `PRDStatus` — PRD lifecycle. */
export type PRDStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'published'
  | 'archived';

/** `ApprovalItemType` — what kind of decision is queued. */
export type ApprovalItemType =
  | 'roadmap'
  | 'prd'
  | 'arch_preview'
  | 'push_to_delivery';

/** `ApprovalItemStatus` — state of a queued approval. */
export type ApprovalItemStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'request_changes'
  | 'delegated'
  | 'cancelled';

/** `ApprovalDecision` — decision verbs callers can submit. */
export type ApprovalDecision = 'approve' | 'deny' | 'request_changes';

/** `PushTarget` — where a push can go. */
export type PushTarget = 'jira' | 'confluence' | 'architecture';

/** `PushStatus` — push record lifecycle. */
export type PushStatus = 'success' | 'failed' | 'pending';

// ---------------------------------------------------------------------------
// Common scaffolding — every read model inherits the tenant-scoped header.
// ---------------------------------------------------------------------------

interface TenantScoped {
  id: string;
  tenant_id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Idea intake (F-201)
// ---------------------------------------------------------------------------

/** Server-issued read model for an idea. */
export interface Idea extends TenantScoped {
  title: string;
  description: string;
  source: IdeaSource;
  submitted_by: string;
  status: IdeaStatus;
  tags: ReadonlyArray<string>;
  attachments: ReadonlyArray<Record<string, unknown>>;
}

/** Paginated list response for `GET /ideation/ideas`. */
export interface IdeaListResponse {
  items: ReadonlyArray<Idea>;
  total: number;
}

/** Body for `POST /ideation/ideas`. */
export interface IdeaCreateInput {
  title: string;
  description: string;
  project_id?: string;
  source?: IdeaSource;
  tags?: ReadonlyArray<string>;
  attachments?: ReadonlyArray<Record<string, unknown>>;
}

/** Body for `PATCH /ideation/ideas/{id}`. */
export interface IdeaUpdateInput {
  title?: string;
  description?: string;
  tags?: ReadonlyArray<string>;
  attachments?: ReadonlyArray<Record<string, unknown>>;
  status?: IdeaStatus;
}

/** Standalone validation result for `POST /ideation/ideas/validate`. */
export interface IdeaValidationResult {
  valid: boolean;
  errors: ReadonlyArray<string>;
}

/** Lightweight NER response for `POST /ideation/ideas/extract-entities`. */
export interface EntityExtraction {
  people: ReadonlyArray<string>;
  products: ReadonlyArray<string>;
  metrics: ReadonlyArray<string>;
  dates: ReadonlyArray<string>;
  technologies: ReadonlyArray<string>;
}

/** Body for `POST /ideation/ideas/{id}/artifacts`. */
export interface IdeaArtifactAttachInput {
  artifact_id: string;
}

// ---------------------------------------------------------------------------
// Analysis (F-202)
// ---------------------------------------------------------------------------

/** LLM-produced analysis attached to an idea (`GET /ideation/ideas/{id}/analysis`). */
export interface IdeaAnalysis extends TenantScoped {
  idea_id: string;
  summary: string;
  problem_statement: string;
  target_users: ReadonlyArray<string>;
  success_metrics: ReadonlyArray<string>;
  assumptions: ReadonlyArray<string>;
  risks: ReadonlyArray<string>;
  related_artifacts: ReadonlyArray<Record<string, unknown>>;
  model_used: string | null;
  cost_usd: number;
  analyzed_at: string;
}

// ---------------------------------------------------------------------------
// Scoring (F-204)
// ---------------------------------------------------------------------------

/** RICE + custom scoring on an idea (`GET /ideation/ideas/{id}/score`). */
export interface OpportunityScore extends TenantScoped {
  idea_id: string;
  value_score: number;
  feasibility_score: number;
  risk_score: number;
  reach_score: number;
  total_score: number;
  scoring_rationale: string;
  scored_by: ScoreSource;
  scored_at: string;
}

/** Body for `POST /ideation/ideas/{id}/score/override`. */
export interface HumanScoreOverrideInput {
  value_score: number;
  feasibility_score: number;
  risk_score: number;
  reach_score: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Roadmaps (F-205)
// ---------------------------------------------------------------------------

/** A single roadmap line item (JSONB on the ORM). */
export interface RoadmapItem {
  idea_id: string;
  position?: number;
  theme?: string;
  total_score?: number;
  note?: string | null;
}

/** Read model for a roadmap (`GET /ideation/roadmaps/{id}`). */
export interface Roadmap extends TenantScoped {
  name: string;
  horizon: RoadmapHorizon;
  theme: string;
  status: RoadmapStatus;
  items: ReadonlyArray<Record<string, unknown>>;
  generated_by: string;
  approved_by: string | null;
}

/** Paginated list response for `GET /ideation/roadmaps`. */
export interface RoadmapListResponse {
  items: ReadonlyArray<Roadmap>;
  total: number;
}

/** Body for `POST /ideation/roadmaps`. */
export interface RoadmapCreateInput {
  project_id: string;
  name: string;
  horizon: RoadmapHorizon;
  theme?: string;
  top_n?: number;
}

/** Body for `PATCH /ideation/roadmaps/{id}`. */
export interface RoadmapUpdateInput {
  name?: string;
  theme?: string;
  items?: ReadonlyArray<RoadmapItem>;
}

/** Body for `POST /ideation/roadmaps/{id}/items`. */
export interface RoadmapAddItemInput {
  idea_id: string;
  position?: number | null;
  note?: string | null;
}

// ---------------------------------------------------------------------------
// PRD (F-206)
// ---------------------------------------------------------------------------

/** A PRD — typed artifact, versioned (`GET /ideation/ideas/{id}/prd`). */
export interface PRD extends TenantScoped {
  idea_id: string;
  version: number;
  content: Record<string, unknown>;
  status: PRDStatus;
  generated_by: string;
  reviewed_by: string | null;
  superseded_by_id: string | null;
}

/** Body for `POST /ideation/ideas/{id}/prd`. */
export interface PRDGenerateInput {
  template?: string;
}

/** Body for `PATCH /ideation/prds/{id}/sections/{section}`. */
export interface PRDSectionUpdateInput {
  content: unknown;
}

// ---------------------------------------------------------------------------
// Approval queue (F-212)
// ---------------------------------------------------------------------------

/** A queued human-decision row (`GET /ideation/approvals`). */
export interface Approval extends TenantScoped {
  idea_id: string;
  request_type: ApprovalItemType;
  subject_id: string | null;
  payload: Record<string, unknown>;
  status: ApprovalItemStatus;
  requested_by: string;
  reviewer_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  reason: string | null;
}

/** Paginated list response for `GET /ideation/approvals`. */
export interface ApprovalQueueResponse {
  items: ReadonlyArray<Approval>;
  total: number;
}

/** Body for `POST /ideation/approvals`. */
export interface ApprovalCreateInput {
  idea_id: string;
  request_type: ApprovalItemType;
  subject_id?: string | null;
  payload?: Record<string, unknown>;
}

/** Body for `POST /ideation/approvals/{id}/decide`. */
export interface ApprovalDecisionInput {
  decision: ApprovalDecision;
  reason?: string | null;
}

/** Body for `POST /ideation/approvals/{id}/assign`. */
export interface ApprovalAssignInput {
  reviewer_id: string;
}

/** Body for `POST /ideation/approvals/{id}/delegate`. */
export interface ApprovalDelegateInput {
  new_reviewer_id: string;
}

// ---------------------------------------------------------------------------
// Architecture preview (F-207)
// ---------------------------------------------------------------------------

/** Architecture preview for an idea (`GET /ideation/ideas/{id}/arch-preview`). */
export interface ArchitecturePreview extends TenantScoped {
  idea_id: string;
  version: number;
  components: ReadonlyArray<Record<string, unknown>>;
  integrations: ReadonlyArray<Record<string, unknown>>;
  data_flows: ReadonlyArray<Record<string, unknown>>;
  risks: ReadonlyArray<Record<string, unknown>>;
  generated_by: string;
  superseded_by_id: string | null;
}

// ---------------------------------------------------------------------------
// Push to delivery (F-213)
// ---------------------------------------------------------------------------

/** Audit trail row for an external-system push. */
export interface PushRecord extends TenantScoped {
  idea_id: string;
  target: PushTarget;
  external_ref: string | null;
  config: Record<string, unknown>;
  status: PushStatus;
  actor_id: string;
  error: string | null;
}

/** Response from `POST /ideation/ideas/{id}/push/{jira|confluence|architecture}`. */
export interface PushResult {
  target: PushTarget;
  success: boolean;
  external_ref: string | null;
  error: string | null;
  record_id: string;
}

/** Response from `GET /ideation/ideas/{id}/push/history`. */
export interface PushHistoryResponse {
  items: ReadonlyArray<PushRecord>;
  total: number;
}

/** Body for `POST /ideation/ideas/{id}/push/jira`. */
export interface PushToJiraInput {
  project_key: string;
}

/** Body for `POST /ideation/ideas/{id}/push/confluence`. */
export interface PushToConfluenceInput {
  space_key: string;
}

/** Body for `POST /ideation/ideas/{id}/push/all`. */
export interface PushAllInput {
  jira_project?: string | null;
  confluence_space?: string | null;
  architecture?: boolean;
}