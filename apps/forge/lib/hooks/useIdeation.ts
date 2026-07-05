'use client';

/**
 * TanStack Query hooks for the Ideation Center — Step-57 Zone 5.
 *
 * Wraps the typed fetchers that talk to the FastAPI ideation endpoints
 * mounted at `/ideation/*` (F-201..F-213). Mirrors the canonical shape
 * established by `useConnectors.ts` + `usePersonaMemory.ts`:
 *
 *   - Thin `useQuery` / `useMutation` wrappers around the `api` client
 *     in `lib/api/client.ts` (auth + tenant header + 401 silent
 *     refresh are handled there).
 *   - Stable `ideationQueryKeys` export so consumers and tests can
 *     invalidate the cache without sprinkling string literals.
 *   - Toast on success (sonner — matches `components/ideation/*`)
 *     and a destructive variant on error.
 *
 * Routes (all under `/ideation`, tenant-scoped via JWT):
 *   - GET    /ideation/ideas               — list (status / tag filter)
 *   - POST   /ideation/ideas               — submit
 *   - GET    /ideation/ideas/{id}          — detail
 *   - PATCH  /ideation/ideas/{id}          — update
 *   - POST   /ideation/ideas/{id}/analyze  — LLM analysis
 *   - GET    /ideation/ideas/{id}/analysis — read analysis
 *   - POST   /ideation/ideas/{id}/score    — opportunity score
 *   - POST   /ideation/ideas/{id}/push/jira
 *
 *   - GET    /ideation/roadmaps            — list
 *   - GET    /ideation/ideas/{id}/prd      — read PRD
 *
 *   - GET    /ideation/approvals           — queue
 *   - POST   /ideation/approvals/{id}/decide
 *
 *   - GET    /ideation/ideas/{id}/arch-preview
 *   - GET    /ideation/arch-previews       — list (placeholder)
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, ApiError } from '@/lib/api/client';

import type {
  Approval,
  ApprovalDecisionInput,
  ApprovalQueueResponse,
  ArchitecturePreview,
  CustomerClusterListResponse,
  DestinationListResponse,
  Idea,
  IdeaAnalysis,
  IdeaCreateInput,
  IdeaListResponse,
  IdeaUpdateInput,
  IdeationSourceListResponse,
  IdeationSourceSyncResult,
  MarketSignalKind,
  MarketSignalListResponse,
  OpportunityScore,
  PRD,
  PushResult,
  PushToJiraInput,
  Roadmap,
  RoadmapListResponse,
} from '@/lib/ideation/types';

import {
  fetchCustomerVoice,
  fetchDestinations,
  fetchMarketSignals,
  fetchSources,
  syncSourceById,
} from '@/lib/api/ideation';

// ---------------------------------------------------------------------------
// Query keys — stable, hierarchical, and predictable so HMR / route
// changes don't churn the cache.
// ---------------------------------------------------------------------------

export const ideationQueryKeys = {
  all: ['ideation'] as const,

  ideas: {
    all: ['ideation', 'ideas'] as const,
    list: (filters?: { status?: string; tag?: string }) =>
      ['ideation', 'ideas', 'list', filters ?? {}] as const,
    detail: (id: string) => ['ideation', 'ideas', 'detail', id] as const,
    analysis: (id: string) => ['ideation', 'ideas', 'analysis', id] as const,
    score: (id: string) => ['ideation', 'ideas', 'score', id] as const,
    archPreview: (id: string) =>
      ['ideation', 'ideas', 'arch-preview', id] as const,
    prd: (id: string) => ['ideation', 'ideas', 'prd', id] as const,
    push: (id: string) => ['ideation', 'ideas', 'push', id] as const,
  },

  roadmaps: {
    all: ['ideation', 'roadmaps'] as const,
    list: (filters?: { project_id?: string }) =>
      ['ideation', 'roadmaps', 'list', filters ?? {}] as const,
    detail: (id: string) =>
      ['ideation', 'roadmaps', 'detail', id] as const,
  },

  approvals: {
    all: ['ideation', 'approvals'] as const,
    list: (filters?: { status?: string; request_type?: string }) =>
      ['ideation', 'approvals', 'list', filters ?? {}] as const,
    detail: (id: string) =>
      ['ideation', 'approvals', 'detail', id] as const,
  },

  archPreviews: {
    all: ['ideation', 'arch-previews'] as const,
    list: ['ideation', 'arch-previews', 'list'] as const,
  },

  prds: {
    all: ['ideation', 'prds'] as const,
    list: ['ideation', 'prds', 'list'] as const,
  },

  // ---- M4 sources (F-260) ---------------------------------------
  sources: {
    all: ['ideation', 'sources'] as const,
    list: () => ['ideation', 'sources', 'list'] as const,
    detail: (id: string) => ['ideation', 'sources', 'detail', id] as const,
    sync: (id: string) => ['ideation', 'sources', 'sync', id] as const,
  },

  // ---- M4 market signals (F-261) --------------------------------
  marketSignals: {
    all: ['ideation', 'market-signals'] as const,
    list: (filters?: { kind?: string }) =>
      ['ideation', 'market-signals', 'list', filters ?? {}] as const,
  },

  // ---- M4 customer voice (F-262) --------------------------------
  customerVoice: {
    all: ['ideation', 'customer-voice'] as const,
    list: () => ['ideation', 'customer-voice', 'list'] as const,
    detail: (id: string) => ['ideation', 'customer-voice', 'detail', id] as const,
  },

  // ---- M4 destinations (F-263) ----------------------------------
  destinations: {
    all: ['ideation', 'destinations'] as const,
    list: () => ['ideation', 'destinations', 'list'] as const,
    detail: (id: string) => ['ideation', 'destinations', 'detail', id] as const,
  },
} as const;

// ---------------------------------------------------------------------------
// Local helper — narrow an unknown API error to a user-readable message.
// ---------------------------------------------------------------------------

interface ApiErrorResponse {
  detail?: string;
  message?: string;
  code?: string;
}

function readErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as ApiErrorResponse | null;
    return body?.detail ?? body?.message ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** List ideas (paginated). Pass filters to narrow. */
export function useIdeas(filters?: { status?: string; tag?: string }) {
  return useQuery<IdeaListResponse, ApiError>({
    queryKey: ideationQueryKeys.ideas.list(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.tag) params.set('tag', filters.tag);
      const qs = params.toString();
      return api.get<IdeaListResponse>(`/ideation/ideas${qs ? `?${qs}` : ''}`);
    },
    staleTime: 30_000,
  });
}

/** Single idea detail. */
export function useIdea(id: string | null | undefined) {
  return useQuery<Idea, ApiError>({
    queryKey: ideationQueryKeys.ideas.detail(id ?? ''),
    queryFn: () => api.get<Idea>(`/ideation/ideas/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** LLM analysis attached to an idea (`null` while it's still being computed). */
export function useIdeaAnalysis(id: string | null | undefined) {
  return useQuery<IdeaAnalysis | null, ApiError>({
    queryKey: ideationQueryKeys.ideas.analysis(id ?? ''),
    queryFn: () =>
      api.get<IdeaAnalysis | null>(`/ideation/ideas/${id}/analysis`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/** List roadmaps. Pass `project_id` to scope to a project. */
export function useRoadmaps(filters?: { project_id?: string }) {
  return useQuery<RoadmapListResponse, ApiError>({
    queryKey: ideationQueryKeys.roadmaps.list(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.project_id) params.set('project_id', filters.project_id);
      const qs = params.toString();
      return api.get<RoadmapListResponse>(
        `/ideation/roadmaps${qs ? `?${qs}` : ''}`,
      );
    },
    staleTime: 60_000,
  });
}

/** PRD attached to an idea. */
export function usePRDs(ideaId: string | null | undefined) {
  return useQuery<PRD | null, ApiError>({
    queryKey: ideationQueryKeys.ideas.prd(ideaId ?? ''),
    queryFn: () => api.get<PRD | null>(`/ideation/ideas/${ideaId}/prd`),
    enabled: Boolean(ideaId),
    staleTime: 60_000,
  });
}

/** Approval queue (tenant-scoped to current user). */
export function useApprovals(filters?: { status?: string; request_type?: string }) {
  return useQuery<ApprovalQueueResponse, ApiError>({
    queryKey: ideationQueryKeys.approvals.list(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.request_type) params.set('request_type', filters.request_type);
      const qs = params.toString();
      return api.get<ApprovalQueueResponse>(
        `/ideation/approvals${qs ? `?${qs}` : ''}`,
      );
    },
    staleTime: 15_000,
  });
}

/**
 * Architecture preview for an idea
 * (`GET /ideation/ideas/{id}/arch-preview`).
 */
export function useArchPreview(ideaId: string | null | undefined) {
  return useQuery<ArchitecturePreview | null, ApiError>({
    queryKey: ideationQueryKeys.ideas.archPreview(ideaId ?? ''),
    queryFn: () =>
      api.get<ArchitecturePreview | null>(
        `/ideation/ideas/${ideaId}/arch-preview`,
      ),
    enabled: Boolean(ideaId),
    staleTime: 60_000,
  });
}

/**
 * Roll-up of architecture previews across ideas. The backend exposes
 * per-idea endpoints only today; this hook is wired to the
 * `/ideation/arch-previews` endpoint the IDE-side surfaces are
 * expected to add. Disabled until the backend list endpoint lands.
 */
export function useArchPreviews() {
  return useQuery<readonly ArchitecturePreview[], ApiError>({
    queryKey: ideationQueryKeys.archPreviews.list,
    queryFn: () =>
      api.get<readonly ArchitecturePreview[]>(`/ideation/arch-previews`),
    staleTime: 60_000,
    enabled: false,
  });
}

// ---------------------------------------------------------------------------
// Mutation variables (typed inputs for the mutation hooks).
// ---------------------------------------------------------------------------

export interface CreateIdeaVariables {
  input: IdeaCreateInput;
}

export interface UpdateIdeaVariables {
  id: string;
  patch: IdeaUpdateInput;
}

export interface AnalyzeIdeaVariables {
  id: string;
}

export interface ScoreIdeaVariables {
  id: string;
  strategy?: 'ai' | 'human' | 'hybrid';
}

export interface DecideApprovalVariables {
  approvalId: string;
  decision: ApprovalDecisionInput['decision'];
  reason?: string | null;
}

export interface PushToJiraVariables {
  id: string;
  input: PushToJiraInput;
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** Submit a new idea. Invalidates the list query on success. */
export function useCreateIdea() {
  const qc = useQueryClient();
  return useMutation<Idea, ApiError, CreateIdeaVariables>({
    mutationFn: ({ input }) => api.post<Idea>('/ideation/ideas', input),
    onSuccess: (idea) => {
      void qc.invalidateQueries({ queryKey: ideationQueryKeys.ideas.all });
      toast.success('Idea submitted', { description: idea.title });
    },
    onError: (err) => {
      toast.error('Submit failed', { description: readErrorMessage(err) });
    },
  });
}

/** Patch an idea. Invalidates the list and detail. */
export function useUpdateIdea() {
  const qc = useQueryClient();
  return useMutation<Idea, ApiError, UpdateIdeaVariables>({
    mutationFn: ({ id, patch }) =>
      api.patch<Idea>(`/ideation/ideas/${id}`, patch),
    onSuccess: (idea, { id }) => {
      void qc.invalidateQueries({ queryKey: ideationQueryKeys.ideas.all });
      void qc.invalidateQueries({
        queryKey: ideationQueryKeys.ideas.detail(id),
      });
      qc.setQueryData<Idea>(ideationQueryKeys.ideas.detail(id), idea);
      toast.success('Idea updated');
    },
    onError: (err) => {
      toast.error('Update failed', { description: readErrorMessage(err) });
    },
  });
}

/**
 * Run LLM analysis on an idea (`POST /ideation/ideas/{id}/analyze`).
 * Invalidates the cached `analysis` query so the UI refetches the
 * fresh artifact.
 */
export function useAnalyzeIdea() {
  const qc = useQueryClient();
  return useMutation<IdeaAnalysis, ApiError, AnalyzeIdeaVariables>({
    mutationFn: ({ id }) =>
      api.post<IdeaAnalysis>(`/ideation/ideas/${id}/analyze`, {}),
    onSuccess: (analysis, { id }) => {
      void qc.invalidateQueries({
        queryKey: ideationQueryKeys.ideas.analysis(id),
      });
      qc.setQueryData<IdeaAnalysis | null>(
        ideationQueryKeys.ideas.analysis(id),
        analysis,
      );
      toast.success('Analysis complete');
    },
    onError: (err) => {
      toast.error('Analysis failed', { description: readErrorMessage(err) });
    },
  });
}

/**
 * Score an idea (`POST /ideation/ideas/{id}/score?strategy=ai`).
 * Mirrors the backend default of `strategy=ai`; pass `'human'` for the
 * override flow which requires the `ideation:score:override` perm.
 */
export function useScoreIdea() {
  const qc = useQueryClient();
  return useMutation<OpportunityScore, ApiError, ScoreIdeaVariables>({
    mutationFn: ({ id, strategy = 'ai' }) =>
      api.post<OpportunityScore>(
        `/ideation/ideas/${id}/score?strategy=${strategy}`,
        {},
      ),
    onSuccess: (score, { id }) => {
      void qc.invalidateQueries({
        queryKey: ideationQueryKeys.ideas.score(id),
      });
      qc.setQueryData<OpportunityScore | null>(
        ideationQueryKeys.ideas.score(id),
        score,
      );
      toast.success('Idea scored', {
        description: `Total: ${score.total_score.toFixed(1)}`,
      });
    },
    onError: (err) => {
      toast.error('Scoring failed', { description: readErrorMessage(err) });
    },
  });
}

/**
 * Record a PM decision on a pending approval
 * (`POST /ideation/approvals/{id}/decide`).
 */
export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation<Approval, ApiError, DecideApprovalVariables>({
    mutationFn: ({ approvalId, decision, reason }) =>
      api.post<Approval>(
        `/ideation/approvals/${approvalId}/decide`,
        { decision, reason: reason ?? null } satisfies ApprovalDecisionInput,
      ),
    onSuccess: (_row, { approvalId, decision }) => {
      void qc.invalidateQueries({
        queryKey: ideationQueryKeys.approvals.all,
      });
      void qc.invalidateQueries({
        queryKey: ideationQueryKeys.approvals.detail(approvalId),
      });
      toast.success(
        decision === 'approve'
          ? 'Approval granted'
          : decision === 'deny'
            ? 'Approval denied'
            : 'Changes requested',
      );
    },
    onError: (err) => {
      toast.error('Decision failed', { description: readErrorMessage(err) });
    },
  });
}

/**
 * Push an idea to Jira (`POST /ideation/ideas/{id}/push/jira`).
 * Returns the canonical `PushResult`; the caller can show the
 * `external_ref` (e.g. `JIRA/FORA-123`) as a receipt.
 */
export function usePushIdeaToJira() {
  const qc = useQueryClient();
  return useMutation<PushResult, ApiError, PushToJiraVariables>({
    mutationFn: ({ id, input }) =>
      api.post<PushResult>(`/ideation/ideas/${id}/push/jira`, input),
    onSuccess: (result, { id }) => {
      void qc.invalidateQueries({ queryKey: ideationQueryKeys.ideas.push(id) });
      if (result.success) {
        toast.success('Pushed to Jira', {
          description: result.external_ref ?? `record ${result.record_id}`,
        });
      } else {
        toast.error('Jira push failed', {
          description: result.error ?? 'Unknown error',
        });
      }
    },
    onError: (err) => {
      toast.error('Jira push failed', {
        description: readErrorMessage(err),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// M4 hooks (F-260..F-263) — back the Sources / MarketSignals /
// CustomerVoice / Destinations tabs. Each owns its own slice of the
// `ideationQueryKeys` hierarchy so the WS fan-out can invalidate
// without touching ideas / roadmaps / approvals.
// ---------------------------------------------------------------------------

/**
 * `GET /ideation/sources` — list configured ingest sources.
 *
 * Backs `<SourcesTab>` (M4-G6). Stale window is 30 s; the WS hook
 * forces a refetch on `source.sync.completed`.
 */
export function useSources() {
  return useQuery<IdeationSourceListResponse, ApiError>({
    queryKey: ideationQueryKeys.sources.list(),
    queryFn: () => fetchSources(),
    staleTime: 30_000,
  });
}

/**
 * `POST /ideation/sources/{id}/sync` — trigger a pull.
 *
 * Invalidates the sources list on success so the `status` reflects
 * the new sync state immediately. The backend also pushes the result
 * over WS — the fan-out debounce in `use-pipeline-ws.ts` will handle
 * the invalidation for those arriving late (no double-refetch in
 * flight because TanStack dedupes by queryKey).
 */
export function useSyncSource() {
  const qc = useQueryClient();
  return useMutation<IdeationSourceSyncResult, ApiError, string>({
    mutationFn: (sourceId: string) => syncSourceById(sourceId),
    onSuccess: (result, sourceId) => {
      void qc.invalidateQueries({ queryKey: ideationQueryKeys.sources.all });
      void qc.invalidateQueries({
        queryKey: ideationQueryKeys.sources.detail(sourceId),
      });
      void qc.invalidateQueries({
        queryKey: ideationQueryKeys.sources.sync(sourceId),
      });
      toast.success(
        result.ok ? 'Sync started' : 'Sync queued',
        {
          description:
            result.message ??
            (result.pulled > 0
              ? `Pulled ${result.pulled} new signals.`
              : 'No new signals — see Signals tab for context.'),
        },
      );
    },
    onError: (err) => {
      toast.error('Sync failed', { description: readErrorMessage(err) });
    },
  });
}

/**
 * `GET /ideation/market-signals?kind=...` — list market signals,
 * optionally filtered by kind (`competitor` | `trend` | `tech`).
 *
 * Backs `<MarketSignalsTab>` (M4-G7). The fixture mapping is filtered
 * client-side today because the backend keeps the kind discriminator
 * for free; passing it server-side is a single-param future tweak.
 */
export function useMarketSignals(filters?: { kind?: MarketSignalKind }) {
  return useQuery<MarketSignalListResponse, ApiError>({
    queryKey: ideationQueryKeys.marketSignals.list({ kind: filters?.kind }),
    queryFn: () => fetchMarketSignals(filters),
    staleTime: 60_000,
  });
}

/**
 * `GET /ideation/customer-voice` — list customer-feedback clusters.
 *
 * Backs `<CustomerVoiceTab>` (M4-G8). Result is fully self-contained
 * (sentiment + frequency + representative excerpts live on the same
 * row), so no further joins are needed in the UI.
 */
export function useCustomerVoice() {
  return useQuery<CustomerClusterListResponse, ApiError>({
    queryKey: ideationQueryKeys.customerVoice.list(),
    queryFn: () => fetchCustomerVoice(),
    staleTime: 60_000,
  });
}

/**
 * `GET /ideation/destinations` — list configured push destinations.
 *
 * Backs `<DestinationsTab>` (M4-G9). Each row carries `has_connector`
 * so the UI can swap between "Configure" (already wired) and
 * "Connect" (needs setup) CTAs without an extra round-trip to the
 * connector center.
 */
export function useDestinations() {
  return useQuery<DestinationListResponse, ApiError>({
    queryKey: ideationQueryKeys.destinations.list(),
    queryFn: () => fetchDestinations(),
    staleTime: 60_000,
  });
}