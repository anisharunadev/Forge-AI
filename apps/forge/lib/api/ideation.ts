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
  // ---- M4 sources / signals / voice / destinations (F-260..F-263) ----
  IdeationSourceKind,
  IdeationSourceStatus,
  IngestSourceRead,
  IdeationSourceListResponse,
  IdeationSourceSyncResult,
  MarketSignalKind,
  MarketSignalPriority,
  MarketSignalRead,
  MarketSignalListResponse,
  ClusterSentiment,
  ClusterTrend,
  CustomerClusterRead,
  CustomerClusterListResponse,
  DestinationKind,
  DestinationRead,
  DestinationListResponse,
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

    // ---- M4 sources (F-260) ---------------------------------------
    sources: () =>
      [...queryKeys.ideation.all, 'sources'] as const,
    source: (id: string) =>
      [...queryKeys.ideation.all, 'source', id] as const,
    syncSource: (id: string) =>
      [...queryKeys.ideation.all, 'source-sync', id] as const,

    // ---- M4 market signals (F-261) --------------------------------
    marketSignals: (filters?: { kind?: string; priority?: string }) =>
      [...queryKeys.ideation.all, 'market-signals', filters ?? {}] as const,

    // ---- M4 customer voice (F-262) ---------------------------------
    customerVoice: () =>
      [...queryKeys.ideation.all, 'customer-voice'] as const,
    customerCluster: (id: string) =>
      [...queryKeys.ideation.all, 'customer-voice', 'cluster', id] as const,

    // ---- M4 destinations (F-263) -----------------------------------
    destinations: () =>
      [...queryKeys.ideation.all, 'destinations'] as const,
    destination: (id: string) =>
      [...queryKeys.ideation.all, 'destination', id] as const,
  },
} as const;

// ---------------------------------------------------------------------------
// Typed fetchers (M4 — F-260..F-263).
//
// Thin, fully-typed wrappers over the `api` transport client
// (auth + tenant header + 401 silent-refresh are handled there). The
// hooks in `lib/hooks/useIdeation.ts` consume these so the same
// fetchers can be unit-mocked without spinning up MSW.
//
// Endpoint contract (Track A — backend spec §3.1):
//   GET    /ideation/sources                       -> list[IngestSourceRead]
//   POST   /ideation/sources/{id}/sync            -> IdeationSourceSyncResult
//   GET    /ideation/market-signals?kind=...      -> list[MarketSignalRead]
//   GET    /ideation/customer-voice               -> list[CustomerClusterRead]
//   GET    /ideation/destinations                 -> list[DestinationRead]
// ---------------------------------------------------------------------------

import { api } from '@/lib/api/client';

import type {
  CustomerClusterListResponse,
  DestinationListResponse,
  IdeationSourceListResponse,
  IdeationSourceSyncResult,
  MarketSignalListResponse,
  MarketSignalKind,
} from '@/lib/ideation/types';

/**
 * `GET /ideation/sources` — list configured ingest sources for the
 * active tenant/project. Returns the read model the Sources tab renders.
 */
export async function fetchSources(): Promise<IdeationSourceListResponse> {
  return api.get<IdeationSourceListResponse>('/ideation/sources');
}

/**
 * `POST /ideation/sources/{id}/sync` — kick a pull against the named
 * source. Backend runs the puller synchronously (or queues with WS
 * progress); returns an ack envelope.
 */
export async function syncSourceById(id: string): Promise<IdeationSourceSyncResult> {
  return api.post<IdeationSourceSyncResult>(
    `/ideation/sources/${encodeURIComponent(id)}/sync`,
    {},
  );
}

/**
 * `GET /ideation/market-signals?kind=...` — list synthesized market
 * signals, optionally filtered by `kind` ('competitor' | 'trend' | 'tech').
 */
export async function fetchMarketSignals(
  filters?: { kind?: MarketSignalKind },
): Promise<MarketSignalListResponse> {
  const params = new URLSearchParams();
  if (filters?.kind) params.set('kind', filters.kind);
  const qs = params.toString();
  return api.get<MarketSignalListResponse>(
    `/ideation/market-signals${qs ? `?${qs}` : ''}`,
  );
}

/**
 * `GET /ideation/customer-voice` — list customer-feedback clusters
 * (themes with sentiment + frequency). The `representative_signals`
 * list is referenced by id only on the wire; the UI interpolates
 * itself.
 */
export async function fetchCustomerVoice(): Promise<CustomerClusterListResponse> {
  return api.get<CustomerClusterListResponse>('/ideation/customer-voice');
}

/**
 * `GET /ideation/destinations` — list configured push destinations
 * for the tenant (Jira projects, Confluence spaces, Slack channels,
 * etc.). Each row carries `has_connector` so the UI can decide between
 * "Configure" and "Connect" CTAs.
 */
export async function fetchDestinations(): Promise<DestinationListResponse> {
  return api.get<DestinationListResponse>('/ideation/destinations');
}