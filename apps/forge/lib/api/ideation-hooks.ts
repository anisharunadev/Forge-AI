/**
 * Ideation Center hooks (Phase 8) — Step 69.
 *
 * Re-exports 14 canonical hooks from `lib/hooks/useIdeation.ts` (Step-57
 * Zone 5) and adds 11 net-new hooks for the endpoints Step-69 wired
 * up. All hooks use the typed `api` client (`lib/api/client.ts`) which
 * injects the tenant + auth headers automatically.
 *
 * Query-key factory lives in `lib/api/ideation.ts`.
 *
 * Endpoints with **non-obvious request shapes**:
 *   - `compare_impact` and `score/batch` take `idea_ids` as QUERY
 *     PARAMS, not a JSON body (verified at
 *     `backend/app/api/v1/ideation/{impact,scoring}.py`). Both hooks
 *     build `URLSearchParams` with `append('idea_ids', id)` per id.
 *   - Workflow start path is
 *     `POST /ideation/workflows/ideas/{idea_id}/start` (router prefix
 *     `/ideation/workflows` + sub-path `ideas/{idea_id}/start`).
 *
 * Hooks with **disabled / placeholder** state:
 *   - none — useGeneratePRD pulls per-idea PRD; no list endpoint yet.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api/client';

import {
  queryKeys,
  type Approval,
  type ApprovalDecisionInput,
  type ArchitecturePreview,
  type HumanScoreOverrideInput,
  type Idea,
  type IdeaAnalysis,
  type IdeaCreateInput,
  type IdeaListResponse,
  type IdeaUpdateInput,
  type OpportunityScore,
  type PRD,
  type PushResult,
  type PushToJiraInput,
  type Roadmap,
  type RoadmapCreateInput,
  type RoadmapListResponse,
} from '@/lib/api/ideation';

// ---------------------------------------------------------------------------
// Re-exports — canonical hooks already shipped by Step-57.
// ---------------------------------------------------------------------------

export {
  useIdeas,
  useIdea,
  useIdeaAnalysis,
  useRoadmaps,
  usePRDs,
  useApprovals,
  useArchPreview,
  useArchPreviews,
  useCreateIdea,
  useUpdateIdea,
  useAnalyzeIdea,
  useScoreIdea,
  useDecideApproval,
  usePushIdeaToJira,
} from '@/lib/hooks/useIdeation';

// ---------------------------------------------------------------------------
// Single-roadmap detail — `GET /ideation/roadmaps/{id}`.
// ---------------------------------------------------------------------------

export function useRoadmap(id: string | null | undefined): UseQueryResult<Roadmap, ApiError> {
  return useQuery<Roadmap, ApiError>({
    queryKey: queryKeys.ideation.roadmap(id ?? ''),
    queryFn: () => api.get<Roadmap>(`/ideation/roadmaps/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Roadmap mutations.
// ---------------------------------------------------------------------------

export function useUpsertRoadmap(): UseMutationResult<
  Roadmap,
  ApiError,
  RoadmapCreateInput
> {
  const qc = useQueryClient();
  return useMutation<Roadmap, ApiError, RoadmapCreateInput>({
    mutationFn: (body) => api.post<Roadmap>('/ideation/roadmaps', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.ideation.roadmaps() });
    },
  });
}

export function useApproveRoadmap(): UseMutationResult<
  Roadmap,
  ApiError,
  { roadmapId: string }
> {
  const qc = useQueryClient();
  return useMutation<Roadmap, ApiError, { roadmapId: string }>({
    mutationFn: ({ roadmapId }) =>
      api.post<Roadmap>(`/ideation/roadmaps/${roadmapId}/approve`, {}),
    onSuccess: (_roadmap, { roadmapId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.ideation.roadmaps() });
      void qc.invalidateQueries({ queryKey: queryKeys.ideation.roadmap(roadmapId) });
    },
  });
}

export function useRegenerateRoadmap(): UseMutationResult<
  Roadmap,
  ApiError,
  { roadmapId: string }
> {
  const qc = useQueryClient();
  return useMutation<Roadmap, ApiError, { roadmapId: string }>({
    mutationFn: ({ roadmapId }) =>
      api.post<Roadmap>(`/ideation/roadmaps/${roadmapId}/regenerate`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.ideation.roadmaps() });
    },
  });
}

// ---------------------------------------------------------------------------
// Impact — `GET /ideation/ideas/{id}/impact-graph` and
// `POST /ideation/ideas/impact/compare?idea_ids=…&idea_ids=…`
// (QUERY PARAMS — not a JSON body).
// ---------------------------------------------------------------------------

export interface ImpactGraphNode {
  id: string;
  label: string;
  kind: string;
  weight: number;
}

export interface ImpactGraphEdge {
  from: string;
  to: string;
  weight: number;
}

export interface ImpactGraph {
  nodes: ImpactGraphNode[];
  edges: ImpactGraphEdge[];
}

export function useIdeaImpact(
  idea_id: string | null | undefined,
): UseQueryResult<ImpactGraph, ApiError> {
  return useQuery<ImpactGraph, ApiError>({
    queryKey: queryKeys.ideation.impact(idea_id ?? ''),
    queryFn: () => api.get<ImpactGraph>(`/ideation/ideas/${idea_id}/impact-graph`),
    enabled: Boolean(idea_id),
    staleTime: 60_000,
  });
}

export interface ImpactComparison {
  entries: { idea_id: string; impact: number; rationale: string }[];
}

export function useCompareImpact(): UseMutationResult<
  ImpactComparison,
  ApiError,
  { ideaIds: string[] }
> {
  return useMutation<ImpactComparison, ApiError, { ideaIds: string[] }>({
    mutationFn: ({ ideaIds }) => {
      const qs = new URLSearchParams();
      ideaIds.forEach((id) => qs.append('idea_ids', id));
      return api.post<ImpactComparison>(
        `/ideation/ideas/impact/compare?${qs.toString()}`,
        {},
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Batch scoring — `POST /ideation/ideas/score/batch?idea_ids=…&strategy=…`
// (QUERY PARAMS).
// ---------------------------------------------------------------------------

export function useScoreBatch(): UseMutationResult<
  OpportunityScore[],
  ApiError,
  { ideaIds: string[]; strategy?: 'ai' | 'human' | 'hybrid' }
> {
  return useMutation<
    OpportunityScore[],
    ApiError,
    { ideaIds: string[]; strategy?: 'ai' | 'human' | 'hybrid' }
  >({
    mutationFn: ({ ideaIds, strategy = 'ai' }) => {
      const qs = new URLSearchParams();
      ideaIds.forEach((id) => qs.append('idea_ids', id));
      qs.set('strategy', strategy);
      return api.post<OpportunityScore[]>(
        `/ideation/ideas/score/batch?${qs.toString()}`,
        {},
      );
    },
  });
}

// ---------------------------------------------------------------------------
// PRD — generate.
// ---------------------------------------------------------------------------

export function useGeneratePRD(): UseMutationResult<
  PRD,
  ApiError,
  { idea_id: string }
> {
  const qc = useQueryClient();
  return useMutation<PRD, ApiError, { idea_id: string }>({
    mutationFn: ({ idea_id }) =>
      api.post<PRD>(`/ideation/ideas/${idea_id}/prd`, {}),
    onSuccess: (prd, { idea_id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.ideation.prds() });
      void qc.invalidateQueries({ queryKey: queryKeys.ideation.prd(idea_id) });
      qc.setQueryData<PRD | null>(queryKeys.ideation.prd(idea_id), prd);
    },
  });
}

// ---------------------------------------------------------------------------
// Arch preview — generate.
// ---------------------------------------------------------------------------

export function useGenerateArchPreview(): UseMutationResult<
  ArchitecturePreview,
  ApiError,
  { idea_id: string }
> {
  const qc = useQueryClient();
  return useMutation<ArchitecturePreview, ApiError, { idea_id: string }>({
    mutationFn: ({ idea_id }) =>
      api.post<ArchitecturePreview>(
        `/ideation/ideas/${idea_id}/arch-preview`,
        {},
      ),
    onSuccess: (_preview, { idea_id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.ideation.archPreviews() });
      void qc.invalidateQueries({ queryKey: queryKeys.ideation.archPreview(idea_id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Pipeline workflow — `POST /ideation/workflows/ideas/{id}/start`.
// ---------------------------------------------------------------------------

export interface WorkflowSessionRead {
  session_id: string;
  idea_id: string;
  status: string;
  steps: { id: string; status: string }[];
}

export function useRunPipeline(): UseMutationResult<
  WorkflowSessionRead,
  ApiError,
  { idea_id: string }
> {
  const qc = useQueryClient();
  return useMutation<WorkflowSessionRead, ApiError, { idea_id: string }>({
    mutationFn: ({ idea_id }) =>
      api.post<WorkflowSessionRead>(
        `/ideation/workflows/ideas/${idea_id}/start`,
        {},
      ),
    onSuccess: (_session) => {
      void qc.invalidateQueries({ queryKey: queryKeys.ideation.ideas() });
      // ponytail: pipeline-status invalidation cascades from any active
      // session via usePipelineStatus's refetch; ideas list is what the
      // ideation board actually reads.
    },
  });
}

export function usePipelineStatus(
  sessionId: string | null | undefined,
): UseQueryResult<WorkflowSessionRead, ApiError> {
  return useQuery<WorkflowSessionRead, ApiError>({
    queryKey: queryKeys.ideation.pipelineStatus(sessionId ?? ''),
    queryFn: () =>
      api.get<WorkflowSessionRead>(`/ideation/workflows/${sessionId}`),
    enabled: Boolean(sessionId),
    refetchInterval: 5_000,
  });
}