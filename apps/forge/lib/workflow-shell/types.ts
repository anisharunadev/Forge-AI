/**
 * Workflow shell types — the spine that connects every Forge AI center
 * into a single Idea → PR journey.
 *
 * The previous UX exposed nine centers (Ideation, Architecture, Runs,
 * Audit, Knowledge, Connector, Agent Terminal, Co-Pilot, etc.) as a
 * grid on the home page. New users had no idea which one to open first
 * and what they were "supposed" to do.
 *
 * Per M16 (Sprint 1 revised): we collapsed the nine centers into a
 * seven-stage workflow. Each stage points at the underlying center
 * that powers it; the home page surfaces the workflow as a progress
 * bar, not a grid.
 *
 * Stage order is intentional: Idea → PRD → Architecture → Tasks →
 * Approval → Develop → PR. Each stage has an optional `centerPath`
 * so deep-links from the workflow route land inside the right center
 * page (without forcing us to delete the old /centers/* routes).
 *
 * This module is intentionally separate from `lib/workflow/types.ts`,
 * which is the React Flow canvas's domain model. Two different
 * "workflows" — different surfaces, different audiences.
 *
 * Rule 4 (typed artifacts) applies — no free-form blobs. Every stage
 * is a stable literal union so consumers can exhaustive-switch.
 */

/** The seven workflow stages, in order. */
export type WorkflowStageId =
  | 'idea'
  | 'prd'
  | 'architecture'
  | 'tasks'
  | 'approval'
  | 'develop'
  | 'pr';

/** Visual state of a stage relative to the active project. */
export type StageStatus = 'pending' | 'current' | 'done' | 'blocked';

/** Static definition of a single workflow stage. */
export interface WorkflowStageDefinition {
  readonly id: WorkflowStageId;
  readonly label: string;
  /** Short label rendered inside the progress chip when space is tight. */
  readonly shortLabel: string;
  /** Path inside the underlying center that this stage deep-links to. */
  readonly centerPath: string;
  /** Tag for analytics + recent-activity feeds. */
  readonly analyticsKey: string;
  /** Human-readable description shown in the home "current stage" card. */
  readonly description: string;
}

/** Runtime progress for a single stage within the active project. */
export interface WorkflowStageProgress {
  readonly id: WorkflowStageId;
  readonly status: StageStatus;
  /** Optional ISO timestamp when this stage was completed (server-derived). */
  readonly completedAt?: string;
  /** Optional reason when status is `blocked`. */
  readonly blockedReason?: string;
}

/** Full progress record for the active project. */
export interface WorkflowProgress {
  readonly projectId: string;
  readonly stages: ReadonlyArray<WorkflowStageProgress>;
  /** Stage that the user should work on next (first non-done). */
  readonly currentStage: WorkflowStageId;
}

/** Recent-activity item shown on the home page (typed, no blobs). */
export interface WorkflowActivityItem {
  readonly id: string;
  readonly stage: WorkflowStageId;
  /** "completed" | "started" | "blocked" — drives the activity icon. */
  readonly kind: 'completed' | 'started' | 'blocked';
  readonly summary: string;
  readonly occurredAt: string;
}