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

// ---------------------------------------------------------------------------
// Ingest sources (F-260 — `GET /ideation/sources`,
// `POST /ideation/sources/{id}/sync`)
//
// Mirrors the `IngestSource` ORM rows seeded by Track A (M4-G1,
// M4-G11). The fixture shape in `lib/ideation/pipeline-data.ts` has
// been superseded by this wire type — every UI consumer now goes
// through `useSources()`.
// ---------------------------------------------------------------------------

/** Ingest source kinds — closed set matching `SOURCE_NAMES` in
 *  `backend/app/db/models/ideation_signal.py` extended with the
 *  generic kinds the UI exposes. */
export type IdeationSourceKind =
  | 'support'
  | 'market'
  | 'codebase'
  | 'team'
  | 'doc'
  | 'webhook'
  | 'feed'
  | 'email'
  | 'confluence'
  | 'slack'
  | 'zendesk'
  | 'manual';

export type IdeationSourceStatus =
  | 'connected'
  | 'available'
  | 'syncing'
  | 'error'
  | 'disabled';

export interface IngestSourceRead {
  id: string;
  tenant_id: string;
  project_id: string;
  /** Stable slug used by the URL `{id}/sync` and React keys. */
  slug: string;
  name: string;
  kind: IdeationSourceKind;
  /** UI hint — accent / icon lookup key. */
  accent: 'cyan' | 'amber' | 'indigo' | 'violet' | 'rose' | 'emerald';
  description: string;
  status: IdeationSourceStatus;
  /** Last successful sync relative text, e.g. "12m ago". */
  last_sync: string | null;
  /** Number of signals ingested today. */
  today_count: number;
  /** Number of signals ingested this week. */
  week_count: number;
  /** Cron-ish frequency description. */
  frequency: string;
  /** Latest few ingested items (titles + relative ts). */
  preview: ReadonlyArray<{ title: string; at: string }>;
  /** ISO8601 of last sync attempt — used for ordering / staleness. */
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdeationSourceListResponse {
  items: ReadonlyArray<IngestSourceRead>;
  total: number;
}

/** Response from `POST /ideation/sources/{id}/sync`. Backend may
 *  return either the updated read model or an ack envelope. */
export interface IdeationSourceSyncResult {
  source_id: string;
  ok: boolean;
  /** How many new signals the run pulled (0 if no-op). */
  pulled: number;
  /** Human-readable status string for the toast. */
  message: string;
}

// ---------------------------------------------------------------------------
// Market signals (F-261 — `GET /ideation/market-signals`)
// Mirrors `MarketSignalRead` schema (Track A — M4-G2, M4-G12).
// Field `why_it_matters` is the AI annotation (UI: 'AI annotation').
// ---------------------------------------------------------------------------

export type MarketSignalKind = 'competitor' | 'trend' | 'tech';
export type MarketSignalPriority = 'low' | 'medium' | 'high';

export interface MarketSignalRead {
  id: string;
  tenant_id: string;
  /** `competitor` / `trend` / `tech`. */
  kind: MarketSignalKind;
  title: string;
  source: string;
  url: string;
  published_at: string;
  /** Relative text mirror (matches fixture UX). */
  published_at_rel: string;
  /** AI-generated "why it matters" annotation. */
  why_it_matters: string;
  priority: MarketSignalPriority;
  created_at: string;
}

export interface MarketSignalListResponse {
  items: ReadonlyArray<MarketSignalRead>;
  total: number;
}

// ---------------------------------------------------------------------------
// Customer voice clusters (F-262 — `GET /ideation/customer-voice`)
// Mirrors `CustomerClusterRead` schema (Track A — M4-G3, M4-G13).
// ---------------------------------------------------------------------------

export type ClusterSentiment = 'positive' | 'neutral' | 'negative';
export type ClusterTrend = 'up' | 'down' | 'flat';

export interface CustomerClusterRead {
  id: string;
  tenant_id: string;
  project_id: string;
  /** Stable slug used in `data-cluster-id` on the row + URL. */
  slug: string;
  theme: string;
  icon: string; // lucide icon name (string for transport)
  ticket_count: number;
  trend_delta: string; // e.g., "+32%"
  trend_direction: ClusterTrend;
  /** 0..10. */
  impact_score: number;
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
  };
  timeline: ReadonlyArray<{ day: string; count: number }>;
  top_excerpts: ReadonlyArray<string>;
  sample_quotes: ReadonlyArray<string>;
  linked_code_signals: ReadonlyArray<string>;
  updated_at: string;
}

export interface CustomerClusterListResponse {
  items: ReadonlyArray<CustomerClusterRead>;
  total: number;
}

// ---------------------------------------------------------------------------
// Push destinations (F-263 — `GET /ideation/destinations`)
// Mirrors `DestinationRead` schema (Track A — M4-G4, M4-G14).
// ---------------------------------------------------------------------------

export type DestinationKind =
  | 'pm' // Jira / Linear / GitHub Projects
  | 'docs' // Confluence / Notion / Google Docs
  | 'ide' // AI agent via MCP / Cursor / Claude Code
  | 'chat' // Slack / Microsoft Teams
  | 'digest' // Email digest
  | 'mirror'; // GitHub Issues mirror

export interface DestinationRead {
  id: string;
  tenant_id: string;
  project_id: string;
  /** Stable URL slug. */
  slug: string;
  name: string;
  kind: DestinationKind;
  icon: string;
  description: string;
  status: IdeationSourceStatus;
  accent: 'cyan' | 'amber' | 'indigo' | 'violet' | 'rose' | 'emerald';
  last_sync: string | null;
  last_sync_at: string | null;
  kpi: string;
  metric?: { label: string; value: string };
  /** True if this destination can be reached via the connector
   *  center — UI shows a "Configure" / "Connect" CTA accordingly. */
  has_connector: boolean;
  created_at: string;
  updated_at: string;
}

export interface DestinationListResponse {
  items: ReadonlyArray<DestinationRead>;
  total: number;
}
