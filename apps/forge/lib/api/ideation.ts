/**
 * Ideation Center (Phase 8) frontend types + query keys.
 *
 * Re-exports the wire-typed artifacts from `lib/ideation/types.ts`
 * (which mirrors `backend/app/schemas/ideation.py`) so consumers can
 * import them from a single canonical location, plus a TanStack Query
 * key factory that mirrors the `dashboard.ts` pattern.
 *
 * Note on status names: `lib/ideation/types.ts` exports
 * `IdeaStatus` in lower-case wire form (`'new' | 'analyzing' | …`).
 * The backend ORM enum (verified at
 * `backend/app/db/models/ideation.py:52`) is UPPER_SNAKE_CASE
 * (`'NEW' | 'ANALYZING' | …`). New code should use the UPPER_SNAKE_CASE
 * form defined below; the bidirectional adapter in
 * `lib/ideation/adapter.ts` bridges the two.
 */

export type {
  Idea,
  IdeaCreateInput,
  IdeaUpdateInput,
  IdeaListResponse,
  IdeaValidationResult,
  IdeaAnalysis,
  EntityExtraction,
  IdeaArtifactAttachInput,
  OpportunityScore,
  HumanScoreOverrideInput,
  RoadmapItem,
  Roadmap,
  RoadmapListResponse,
  RoadmapCreateInput,
  RoadmapUpdateInput,
  RoadmapAddItemInput,
  PRD,
  PRDGenerateInput,
  PRDSectionUpdateInput,
  Approval,
  ApprovalQueueResponse,
  ApprovalCreateInput,
  ApprovalDecisionInput,
  ApprovalAssignInput,
  ApprovalDelegateInput,
  ArchitecturePreview,
  PushRecord,
  PushResult,
  PushHistoryResponse,
  PushToJiraInput,
  PushToConfluenceInput,
  PushAllInput,
  IdeaSource,
  ScoreSource,
  RoadmapHorizon,
  RoadmapStatus,
  PRDStatus,
  ApprovalItemType,
  ApprovalItemStatus,
  ApprovalDecision,
  PushTarget,
  PushStatus,
} from '@/lib/ideation/types';

/**
 * Backend enum for idea status (verified at
 * `backend/app/db/models/ideation.py:52`). Distinct from the
 * lower-case `IdeaStatus` in `lib/ideation/types.ts` because the ORM
 * uses UPPER_SNAKE_CASE while the older wire model used snake_case.
 */
export type IdeaStatus =
  | 'NEW'
  | 'ANALYZING'
  | 'SCORED'
  | 'APPROVED'
  | 'IN_ROADMAP'
  | 'REJECTED'
  | 'ARCHIVED';

// ---------------------------------------------------------------------------
// Query-key factory — hierarchical, predictable, HMR-stable.
// ---------------------------------------------------------------------------

export const queryKeys = {
  ideation: {
    all: ['ideation'] as const,

    ideas: (filter?: { status?: IdeaStatus; source?: string }) =>
      [...queryKeys.ideation.all, 'ideas', filter ?? {}] as const,
    idea: (id: string) =>
      [...queryKeys.ideation.all, 'idea', id] as const,
    analysis: (idea_id: string) =>
      [...queryKeys.ideation.all, 'analysis', idea_id] as const,
    impact: (idea_id: string) =>
      [...queryKeys.ideation.all, 'impact', idea_id] as const,
    score: (idea_id: string) =>
      [...queryKeys.ideation.all, 'score', idea_id] as const,
    push: (idea_id: string) =>
      [...queryKeys.ideation.all, 'push', idea_id] as const,

    roadmaps: () =>
      [...queryKeys.ideation.all, 'roadmaps'] as const,
    roadmap: (id: string) =>
      [...queryKeys.ideation.all, 'roadmap', id] as const,

    prds: () =>
      [...queryKeys.ideation.all, 'prds'] as const,
    prd: (id: string) =>
      [...queryKeys.ideation.all, 'prd', id] as const,

    archPreviews: () =>
      [...queryKeys.ideation.all, 'arch-previews'] as const,
    archPreview: (idea_id: string) =>
      [...queryKeys.ideation.all, 'arch-preview', idea_id] as const,

    approvals: () =>
      [...queryKeys.ideation.all, 'approvals'] as const,
    approval: (id: string) =>
      [...queryKeys.ideation.all, 'approval', id] as const,

    pipelineStatus: (sessionId: string) =>
      [...queryKeys.ideation.all, 'pipeline-status', sessionId] as const,
  },
} as const;