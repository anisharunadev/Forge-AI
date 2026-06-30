/**
 * Typed TanStack Query hooks for the Agent Center (step-54 — Phase 2).
 *
 * Each hook maps directly to a FastAPI endpoint. Types mirror the
 * backend Pydantic schemas in `backend/app/schemas/`:
 *   - agents.py         → Agent
 *   - model_providers.py → ModelProvider
 *   - runtime.py         → RuntimeHandle / RuntimeMetrics
 *   - agents.py (assignment) → AgentAssignmentRead
 *
 * Skill rules adopted:
 *   - **Tenant scoping (Rule 2)** — every list call accepts a
 *     `projectId` filter so the same hooks work for both the
 *     org-level Agent Center and project-scoped sub-pages.
 *   - **Cache invalidation** — mutations invalidate the relevant
 *     query keys (e.g. creating an agent invalidates `queryKeys.agents.all`)
 *     so consumers always see fresh data without manual refresh.
 *   - **Optimistic delete** — `useDeleteAgent` removes the row from
 *     cache immediately and rolls back on error (UX — perceived speed).
 *   - **No free-form data (Rule 4)** — every input is typed against
 *     the backend schema. The dialog/form layer enforces additional
 *     client-side validation (e.g. name min length, required caps).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import {
  storiesQueryKeys,
  type Comment,
  type CommentCreateInput,
  type Epic,
  type LinkToJiraInput,
  type Sprint,
  type SprintCreateInput,
  type StartImplementationResponse,
  type Story,
  type StoryBulkUpdate,
  type StoryCreateInput,
  type StoryFilter,
  type StoryLinkedRead,
  type StoryUpdateInput,
} from '@/lib/api/stories';

// ---------------------------------------------------------------------------
// Types — kept in lock-step with backend Pydantic schemas.
// ---------------------------------------------------------------------------

/** Mirrors `AgentType` enum in `backend/app/db/models/agent.py`. */
export type AgentBackendType = 'claude_code' | 'codex' | 'gemini' | 'custom';

/** Mirrors `AgentStatus` enum. */
export type AgentBackendStatus = 'enabled' | 'disabled' | 'deprecated';

export interface Agent {
  id: string;
  tenant_id: string;
  project_id: string | null;
  name: string;
  type: AgentBackendType;
  capabilities: Record<string, unknown>;
  version: string;
  status: AgentBackendStatus;
  created_at: string;
  updated_at: string;
}

export interface AgentCreateInput {
  name: string;
  type: AgentBackendType;
  capabilities?: Record<string, unknown>;
  version?: string;
  project_id?: string | null;
}

export interface AgentUpdateInput {
  name?: string;
  capabilities?: Record<string, unknown>;
  status?: AgentBackendStatus;
  version?: string;
}

/** Mirrors `ModelProviderType` enum in `backend/app/db/models/model_provider.py`. */
export type ModelProviderBackendType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'bedrock'
  | 'azure_openai'
  | 'custom';

export interface ModelProvider {
  id: string;
  tenant_id: string;
  name: string;
  type: ModelProviderBackendType;
  config: Record<string, unknown>;
  litellm_model_alias: string;
  enabled: boolean;
  rate_limit_rpm: number;
  rate_limit_tpm: number;
  created_at: string;
  updated_at: string;
}

export interface ModelProviderCreateInput {
  name: string;
  type: ModelProviderBackendType;
  litellm_model_alias: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  rate_limit_rpm?: number;
  rate_limit_tpm?: number;
}

export interface ModelProviderUpdateInput {
  name?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  rate_limit_rpm?: number;
  rate_limit_tpm?: number;
}

/** Mirrors `RuntimeKind` / `RuntimeState` enums in `runtime.py`. */
export type RuntimeKind = 'local_subprocess' | 'kubernetes_pod';
export type RuntimeState = 'starting' | 'running' | 'stopped' | 'failed' | 'unknown';

export interface Runtime {
  id: string;
  tenant_id: string;
  project_id: string | null;
  agent_id: string;
  workspace_path: string;
  kind: RuntimeKind;
  state: RuntimeState;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuntimeStartInput {
  agent_id: string;
  workspace_path: string;
  kind?: RuntimeKind;
}

/** Mirrors `AgentAssignmentRead` in `agents.py` schemas. */
export interface AgentAssignment {
  task_type: string;
  project_id: string | null;
  strategy: string;
  agent: Agent;
  assigned_at: string;
}

export interface AgentAssignmentCreateInput {
  task_type: string;
  project_id?: string | null;
  strategy?: 'round_robin' | 'least_loaded' | 'capability_match' | 'manual_pin';
  pinned_agent_id?: string | null;
  required_capabilities?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Test-result shape returned by `/agents/{id}/test` and
// `/model-providers/{id}/test`. Backend returns a small JSON blob; we
// type it conservatively.
// ---------------------------------------------------------------------------

export interface TestResult {
  status: 'ok' | 'error';
  message: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Top providers — mirrors `TopProviderRow` in
// `backend/app/schemas/dashboard.py`. Returned by
// `GET /dashboard/top-providers` and consumed by the Agent Center
// bento "Top performing model providers" widget. `provider_name` is
// mapped from `ModelProvider.name` on the backend (no `display_name`
// column on the model today — only `name`).
// ---------------------------------------------------------------------------

export interface TopProvider {
  model: string;
  provider_id: string | null;
  provider_name: string;
  provider_type: string | null;
  run_count: number;
  total_cost: number;
  avg_duration_seconds: number;
  success_rate: number;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Query keys — centralized so any mutation can invalidate the right
// slice without string-typing itself into a corner.
// ---------------------------------------------------------------------------

export const queryKeys = {
  agents: {
    all: ['agents'] as const,
    list: (projectId?: string | null) =>
      [...queryKeys.agents.all, 'list', projectId ?? 'all'] as const,
    detail: (id: string) => [...queryKeys.agents.all, 'detail', id] as const,
  },
  providers: {
    all: ['providers'] as const,
    list: () => [...queryKeys.providers.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.providers.all, 'detail', id] as const,
  },
  runtimes: {
    all: ['runtimes'] as const,
    list: () => [...queryKeys.runtimes.all, 'list'] as const,
  },
  assignments: {
    all: ['assignments'] as const,
    list: (taskType?: string, projectId?: string) =>
      [
        ...queryKeys.assignments.all,
        'list',
        taskType ?? 'all',
        projectId ?? 'all',
      ] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    topProviders: (days: number) =>
      [...queryKeys.dashboard.all, 'top-providers', days] as const,
  },
};

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export function useAgents(
  projectId?: string | null,
): UseQueryResult<Agent[]> {
  return useQuery({
    queryKey: queryKeys.agents.list(projectId),
    queryFn: () => {
      const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
      return api.get<Agent[]>(`/agents${qs}`);
    },
  });
}

export function useAgent(id: string | null | undefined): UseQueryResult<Agent> {
  return useQuery({
    queryKey: queryKeys.agents.detail(id ?? ''),
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AgentCreateInput) => api.post<Agent>('/agents', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: AgentUpdateInput & { id: string }) =>
      api.patch<Agent>(`/agents/${id}`, data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
      qc.invalidateQueries({ queryKey: queryKeys.agents.detail(id) });
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/agents/${id}`),
    // Optimistic removal — Rule 9: "When a query fails, surface the
    // error to the user immediately". We delete the row from cache
    // straight away so the UI feels instant, then restore on error.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.agents.all });
      const previous = qc.getQueriesData<Agent[]>({
        queryKey: queryKeys.agents.all,
      });
      qc.setQueriesData<Agent[]>(
        { queryKey: queryKeys.agents.all },
        (old) => (old ? old.filter((a) => a.id !== id) : old),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        for (const [key, value] of context.previous) {
          qc.setQueryData(key, value);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

export function useTestAgent() {
  return useMutation({
    mutationFn: (id: string) => api.post<TestResult>(`/agents/${id}/test`),
  });
}

// ---------------------------------------------------------------------------
// Model providers
// ---------------------------------------------------------------------------

export function useProviders(): UseQueryResult<ModelProvider[]> {
  return useQuery({
    queryKey: queryKeys.providers.list(),
    queryFn: () => api.get<ModelProvider[]>('/model-providers'),
  });
}

export function useProvider(id: string | null | undefined): UseQueryResult<ModelProvider> {
  return useQuery({
    queryKey: queryKeys.providers.detail(id ?? ''),
    queryFn: () => api.get<ModelProvider>(`/model-providers/${id}`),
    enabled: !!id,
  });
}

export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ModelProviderCreateInput) =>
      api.post<ModelProvider>('/model-providers', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers.all });
    },
  });
}

export function useUpdateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: ModelProviderUpdateInput & { id: string }) =>
      api.patch<ModelProvider>(`/model-providers/${id}`, data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.providers.all });
      qc.invalidateQueries({ queryKey: queryKeys.providers.detail(id) });
    },
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/model-providers/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.providers.all });
      const previous = qc.getQueriesData<ModelProvider[]>({
        queryKey: queryKeys.providers.all,
      });
      qc.setQueriesData<ModelProvider[]>(
        { queryKey: queryKeys.providers.all },
        (old) => (old ? old.filter((p) => p.id !== id) : old),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        for (const [key, value] of context.previous) {
          qc.setQueryData(key, value);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers.all });
    },
  });
}

export function useTestProvider() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<TestResult>(`/model-providers/${id}/test`),
  });
}

// ---------------------------------------------------------------------------
// Runtimes
// ---------------------------------------------------------------------------

export function useRuntimes(): UseQueryResult<Runtime[]> {
  return useQuery({
    queryKey: queryKeys.runtimes.list(),
    queryFn: () => api.get<Runtime[]>('/runtimes'),
  });
}

export function useStartRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: RuntimeStartInput) =>
      api.post<Runtime>('/runtimes/start', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.runtimes.all });
    },
  });
}

export function useStopRuntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Runtime>(`/runtimes/${id}/stop`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.runtimes.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Agent assignments — these resolve rather than persist. The backend's
// `assign_agent` picks an enabled agent for a (task_type, project,
// strategy) tuple. The UI uses the "peek" pattern (GET) to inspect
// which agent would be picked without committing.
// ---------------------------------------------------------------------------

export function useAssignment(
  taskType: string | null | undefined,
  projectId?: string | null,
  strategy: AgentAssignmentCreateInput['strategy'] = 'capability_match',
): UseQueryResult<AgentAssignment> {
  return useQuery({
    queryKey: queryKeys.assignments.list(taskType ?? undefined, projectId ?? undefined),
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('task_type', taskType as string);
      qs.set('strategy', strategy as string);
      if (projectId) qs.set('project_id', projectId);
      return api.get<AgentAssignment>(`/agent-assignments?${qs.toString()}`);
    },
    enabled: !!taskType,
  });
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AgentAssignmentCreateInput) =>
      api.post<AgentAssignment>('/agent-assignments', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.assignments.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Stories — step-58 (Phase 7).
//
// Skill rules adopted:
//   - **Tenant scoping (Rule 2)** — every list call accepts project/sprint
//     filters so the same hooks work for both the org-level Stories page
//     and project-scoped sub-pages.
//   - **Optimistic status update** — `useUpdateStoryStatus` updates the
//     cache before the PATCH resolves so drag-drop feels instant; on
//     error we roll back and toast.
//   - **Cache invalidation** — mutations invalidate the relevant
//     query keys (e.g. creating a story invalidates
//     `storiesQueryKeys.stories.all`).
//   - **Typed artifacts (Rule 4)** — every input is typed against the
//     backend schema; the dialog/form layer enforces additional
//     client-side validation (e.g. title min length).
// ---------------------------------------------------------------------------

/** Build a URLSearchParams from a filter object, dropping undefined
 *  values so the backend receives only the constraints the user set. */
function buildQuery(filter?: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter ?? {})) {
    if (v !== undefined && v !== null && v !== '') {
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useStories(
  filter?: StoryFilter,
): UseQueryResult<Story[]> {
  return useQuery({
    queryKey: storiesQueryKeys.stories.list(filter),
    queryFn: () => api.get<Story[]>(`/stories${buildQuery(filter as Record<string, unknown>)}`),
    enabled: filter?.project_id !== undefined || !!filter,
  });
}

export function useStory(
  id: string | null | undefined,
): UseQueryResult<Story> {
  return useQuery({
    queryKey: storiesQueryKeys.stories.detail(id ?? ''),
    queryFn: () => api.get<Story>(`/stories/${id}`),
    enabled: !!id,
  });
}

export function useStoryLinkedItems(
  id: string | null | undefined,
): UseQueryResult<StoryLinkedRead> {
  return useQuery({
    queryKey: storiesQueryKeys.stories.linked(id ?? ''),
    queryFn: () => api.get<StoryLinkedRead>(`/stories/${id}/linked`),
    enabled: !!id,
  });
}

export function useCreateStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: StoryCreateInput) =>
      api.post<Story>('/stories', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.stories.all });
    },
  });
}

export function useUpdateStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: StoryUpdateInput & { id: string }) =>
      api.patch<Story>(`/stories/${id}`, data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.stories.all });
      qc.invalidateQueries({
        queryKey: storiesQueryKeys.stories.detail(id),
      });
    },
  });
}

/**
 * Optimistic status update — the kanban drag-drop calls this on drop.
 * We update every list query in the cache immediately, then PATCH the
 * backend. On error we restore the prior cache snapshot and toast.
 */
export function useUpdateStoryStatus() {
  const qc = useQueryClient();
  return useMutation<
    Story,
    Error,
    { id: string; status: Story['status'] },
    { previous: Array<[readonly unknown[], unknown]> }
  >({
    mutationFn: ({ id, status }) =>
      api.patch<Story>(`/stories/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: storiesQueryKeys.stories.all });
      const previous = qc.getQueriesData<Story[]>({
        queryKey: storiesQueryKeys.stories.all,
      });
      for (const [key, stories] of previous) {
        if (Array.isArray(stories)) {
          qc.setQueryData<Story[]>(
            key,
            stories.map((s) => (s.id === id ? { ...s, status } : s)),
          );
        }
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.stories.all });
    },
  });
}

export function useDeleteStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/stories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.stories.all });
    },
  });
}

export function useBulkUpdateStories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: StoryBulkUpdate) =>
      api.patch<Story[]>('/stories/bulk', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.stories.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

export function useSprints(
  projectId?: string | null,
): UseQueryResult<Sprint[]> {
  return useQuery({
    queryKey: storiesQueryKeys.sprints.list(projectId ?? undefined),
    queryFn: () =>
      api.get<Sprint[]>(`/sprints${buildQuery({ project_id: projectId })}`),
  });
}

export function useCurrentSprint(
  projectId: string | null | undefined,
): UseQueryResult<Sprint> {
  return useQuery({
    queryKey: storiesQueryKeys.sprints.current(projectId ?? ''),
    queryFn: () =>
      api.get<Sprint>(`/sprints/current${buildQuery({ project_id: projectId })}`),
    enabled: !!projectId,
  });
}

export function useStartSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<Sprint>(`/sprints/${id}/start`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.sprints.all });
    },
  });
}

export function useCreateSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SprintCreateInput) =>
      api.post<Sprint>('/sprints', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.sprints.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Epics
// ---------------------------------------------------------------------------

export function useEpics(
  projectId?: string | null,
): UseQueryResult<Epic[]> {
  return useQuery({
    queryKey: storiesQueryKeys.epics.list(projectId ?? undefined),
    queryFn: () =>
      api.get<Epic[]>(`/epics${buildQuery({ project_id: projectId })}`),
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function useStoryComments(
  storyId: string | null | undefined,
): UseQueryResult<Comment[]> {
  return useQuery({
    queryKey: storiesQueryKeys.comments.list(storyId ?? ''),
    queryFn: () => api.get<Comment[]>(`/stories/${storyId}/comments`),
    enabled: !!storyId,
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      storyId,
      ...data
    }: CommentCreateInput & { storyId: string }) =>
      api.post<Comment>(`/stories/${storyId}/comments`, data),
    onSuccess: (_comment, { storyId }) => {
      qc.invalidateQueries({
        queryKey: storiesQueryKeys.comments.list(storyId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Jira sync
// ---------------------------------------------------------------------------

export function useSyncToJira() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (storyId: string) =>
      api.post<Story>(`/stories/${storyId}/sync-jira`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.stories.all });
    },
  });
}

export function useLinkToJira() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storyId, jira_key }: LinkToJiraInput & { storyId: string }) =>
      api.post<Story>(`/stories/${storyId}/link-jira`, { jira_key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.stories.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Start implementation — opens a terminal session and flips the story
// to in_progress. Returns a new run/session id for the terminal to bind.
// ---------------------------------------------------------------------------

export function useStartImplementation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (storyId: string) =>
      api.post<StartImplementationResponse>(
        `/stories/${storyId}/start-implementation`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storiesQueryKeys.stories.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Dashboard — top performing model providers (Zone 2 of step-54)
//
// The "Top performing model providers" bento widget on the Agent
// Center dashboard calls this hook. The backend endpoint
// `GET /dashboard/top-providers` aggregates `litellm_call_records`
// joined to `model_providers` and returns the top-N models by call
// volume over the requested window.
//
// `staleTime` is set to 60s so we don't refetch on every render
// (matches the backend aggregator's typical workload cadence).
// ---------------------------------------------------------------------------

export function useTopProviders(
  days: number = 7,
): UseQueryResult<TopProvider[]> {
  return useQuery({
    queryKey: queryKeys.dashboard.topProviders(days),
    queryFn: () =>
      api.get<TopProvider[]>(`/dashboard/top-providers?days=${days}`),
    staleTime: 60_000,
  });
}