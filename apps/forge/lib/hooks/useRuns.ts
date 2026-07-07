'use client';

/**
 * TanStack Query hooks for the Runs Center (Phase 1).
 *
 *   - `useRunsIndex()`    — list view, 30 s staleTime, returns the
 *     discriminated `RunsView` (unreachable / ok / empty).
 *   - `useRunDetail(id)`  — detail view, refetches every 5 s while
 *     the run is in motion (created / running / waiting_approval /
 *     paused) so the operator sees stage transitions without a
 *     manual refresh.
 *   - `useRunStages(id)`  — stage list detail hook, 5 s refetch
 *     while non-terminal.
 *   - `useCreateRun()`    — mutation hook used by the New run
 *     dialog. On success the caller is expected to
 *     `router.push(\`/runs/\${run.id}\`)`.
 *   - `useRunBudget(id)`  — M6-G2: live per-run budget feed; polls
 *     `/api/v1/runs/{id}/budget` every 5 s while the run is
 *     non-terminal and invalidates on the WS frame
 *     `run.cost.updated` for that run.
 *   - `useReplayRun()`    — M6-G1: mutation that POSTs `/api/v1/runs/{id}/replay`
 *     and returns the freshly-created run header.
 *
 * Server-side fetches should NOT import this file — call the
 * functions in `lib/api.ts` directly so Next.js can server-render
 * the page.
 */

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  createRun,
  getRun,
  getRunStages,
  getRunsView,
  getWorkflowRunsView,
  type CreateRunInput,
  type RunRecord,
  type RunsView,
  type StageRecord,
  type WorkflowRunsView,
} from '@/lib/api';
import type { RunExplainability } from '@/lib/api/runs-types';
import type { LiveRun } from '@/lib/command-center/sample-data';
import {
  getRunBudget,
  getRunExplainability,
  replayRun,
  type RunBudget,
  type ReplayRunResponse,
} from '@/lib/runs/data';
import { useRealtime, type WsFrame } from '@/lib/useRealtime';

/** Stable query keys so the cache survives HMR / route changes. */
export const runsQueryKeys = {
  all: ['runs'] as const,
  index: () => [...runsQueryKeys.all, 'index'] as const,
  workflowIndex: () => [...runsQueryKeys.all, 'workflow-index'] as const,
  detail: (id: string) => [...runsQueryKeys.all, 'detail', id] as const,
  stages: (id: string) => [...runsQueryKeys.all, 'stages', id] as const,
  explainability: (id: string) => [...runsQueryKeys.all, 'explainability', id] as const,
  budget: (id: string) => [...runsQueryKeys.all, 'budget', id] as const,
};

const NON_TERMINAL = new Set<RunRecord['status']>([
  'created',
  'running',
  'waiting_approval',
  'paused',
]);

/**
 * List-page hook. Returns the discriminated `RunsView` so the
 * page chrome can switch on `unreachable | ok | empty` and render
 * the right banner. Refetches every 30 s — the page also subscribes
 * to `run.created` / `run.updated` / `run.stage_changed` via
 * `useRealtime` for live updates.
 */
export function useRunsIndex() {
  return useQuery<RunsView>({
    queryKey: runsQueryKeys.index(),
    queryFn: () => getRunsView(),
    staleTime: 15_000,
  });
}

/**
 * Step-56 Zone 6: List-page hook for the Runs Center page. Returns the
 * discriminated `WorkflowRunsView` (unreachable | ok | empty) sourced
 * from `GET /api/v1/workflows/runs` (the FastAPI WorkflowRun surface),
 * not the SDLC `/v1/runs` orchestrator endpoint.
 *
 * The `useRunsIndex()` hook above is intentionally untouched — it still
 * backs the persona dashboards / run detail / stage timeline that
 * consume the SDLC `RunRecord` shape. New UI surfaces should call
 * `useWorkflowRunsIndex()` instead so they render `WorkflowRun` rows.
 */
export function useWorkflowRunsIndex() {
  return useQuery<WorkflowRunsView>({
    queryKey: runsQueryKeys.workflowIndex(),
    queryFn: () => getWorkflowRunsView(),
    staleTime: 15_000,
  });
}

/**
 * Track K (Day 2) — Command Center "live runs" hook.
 *
 * Wraps `useWorkflowRunsIndex()` and adapts the wire `WorkflowRun`
 * shape to the `LiveRun` shape the My Work drawer still consumes.
 * Returns `{ data: [], isLoading, error? }` when the backend is
 * unreachable or returns `empty`, so the drawer renders an honest
 * empty state instead of a stale fixture.
 */
export function useLiveRuns(_opts: { project_id?: string } = {}) {
  const q = useWorkflowRunsIndex();
  const data: ReadonlyArray<LiveRun> = useMemo(() => {
    if (q.data?.state !== 'ok') return [];
    return q.data.runs.map((r) => {
      const stepDone = (r.step_results ?? []).filter(
        (s) => s.status === 'succeeded' || s.status === 'failed' || s.status === 'skipped',
      ).length;
      const stepTotal = (r.step_results ?? []).length || 1;
      const progress = Math.round((stepDone / stepTotal) * 100);
      const status: LiveRun['status'] =
        r.status === 'succeeded'
          ? 'success'
          : r.status === 'cancelled'
            ? 'canceled'
            : (r.status as LiveRun['status']);
      return {
        id: r.id,
        skillId: `workflow:${r.workflow_id}`,
        status,
        progress,
        startedAgo: r.started_at ? relativeFromNow(r.started_at) : 'queued',
        duration: humanizeDuration(r.started_at, r.finished_at),
        actor: r.triggered_by,
      };
    });
  }, [q.data]);
  return { data, isLoading: q.isLoading, error: q.error };
}

// ponytail: minimal humanizers — swap for a shared `lib/time/*` helper
// once a third caller shows up. Uses Intl.RelativeTimeFormat.
function relativeFromNow(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function humanizeDuration(
  startedAt?: string | null,
  finishedAt?: string | null,
): string {
  if (!startedAt) return '—';
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = end - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

/**
 * Detail hook — refetches more aggressively while the run is still
 * in motion so the operator sees stage transitions. Stops polling
 * once the run reaches a terminal state (`aborted` / `finished` /
 * `done`).
 */
export function useRunDetail(runId: string) {
  return useQuery<RunRecord>({
    queryKey: runsQueryKeys.detail(runId),
    queryFn: () => getRun(runId),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const data = q.state.data as RunRecord | undefined;
      if (!data) return 5_000;
      return NON_TERMINAL.has(data.status) ? 5_000 : false;
    },
    staleTime: 5_000,
  });
}

/**
 * Stages hook — same conditional polling as `useRunDetail`. Pairs
 * with the realtime WS subscription on the detail page so stage
 * transitions surface within 250 ms (debounce) when WS is up, or
 * 5 s polling otherwise.
 */
export function useRunStages(runId: string) {
  return useQuery<ReadonlyArray<StageRecord>>({
    queryKey: runsQueryKeys.stages(runId),
    queryFn: () => getRunStages(runId),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const data = q.state.data as ReadonlyArray<StageRecord> | undefined;
      if (!data) return 5_000;
      const anyInFlight = data.some(
        (s) => s.status === 'pending' || s.status === 'running' || s.status === 'waiting_approval',
      );
      return anyInFlight ? 5_000 : false;
    },
    staleTime: 5_000,
  });
}

/**
 * Mutation hook — create a new run. The dialog calls `mutateAsync`
 * and on success routes the operator to `/runs/{newId}`.
 */
export function useCreateRun() {
  return useMutation<RunRecord, Error, CreateRunInput>({
    mutationFn: (input) => createRun(input),
  });
}

/**
 * Step-64 Sub-step A: fetch the 5-question explainability bundle.
 * Bundle is derived; 30s staleTime is plenty for active runs and
 * cheap enough for the polling cadence the detail page already uses.
 */
export function useRunExplainability(runId: string): UseQueryResult<RunExplainability> {
  return useQuery<RunExplainability>({
    queryKey: runsQueryKeys.explainability(runId),
    queryFn: () => getRunExplainability(runId),
    enabled: Boolean(runId),
    staleTime: 30_000,
  });
}

/**
 * M6-G2 — live per-RUN budget surface.
 *
 *   - TanStack Query against `GET /api/v1/runs/{runId}/budget` (FastAPI).
 *   - `refetchInterval` is 5 s while the run is in a NON_TERMINAL status
 *     so the badge flips to the warn tone within ~5 s of a spend spike.
 *   - Subscribes to the `run.cost.updated` WS topic (the per-run envelope
 *     carries `run_id`); on every matching frame we invalidate the
 *     budget query so the polling loop yields to a fresh fetch.
 *   - Subscribes to `run.updated` so a status transition into a terminal
 *     state stops the polling cadence (TanStack re-evaluates
 *     `refetchInterval` whenever the cached data changes).
 *
 * Only mounted for the selected row in the drawer — never for every row
 * in the index table — to avoid hammering the backend on a 200-row
 * tenant. The index table uses the row's last-known `cost_spent_usd`
 * via the static `<RunBudgetBadge />` instead.
 */
export function useRunBudget(runId: string): UseQueryResult<RunBudget> {
  const qc = useQueryClient();
  const { subscribe } = useRealtime();

  useEffect(() => {
    if (!runId) return;
    const offCost = subscribe('run.cost.updated', (frame: WsFrame) => {
      const env = frame.envelope as { run_id?: unknown } | null | undefined;
      if (env && typeof env.run_id === 'string' && env.run_id === runId) {
        void qc.invalidateQueries({ queryKey: runsQueryKeys.budget(runId) });
      }
    });
    const offUpdate = subscribe('run.updated', (frame: WsFrame) => {
      const env = frame.envelope as { id?: unknown } | null | undefined;
      if (env && typeof env.id === 'string' && env.id === runId) {
        void qc.invalidateQueries({ queryKey: runsQueryKeys.budget(runId) });
      }
    });
    return () => {
      offCost();
      offUpdate();
    };
  }, [runId, qc, subscribe]);

  return useQuery<RunBudget>({
    queryKey: runsQueryKeys.budget(runId),
    queryFn: () => getRunBudget(runId),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const data = q.state.data as RunBudget | undefined;
      if (!data) return 5_000;
      // Stop polling once the run reached a terminal budget status.
      if (data.status === 'closed' || data.status === 'exhausted') return false;
      return 5_000;
    },
    staleTime: 5_000,
  });
}

/**
 * M6-G1 — replay a finished/failed run.
 *
 *   - `mutate(runId)` POSTs `/api/v1/runs/{runId}/replay` and returns
 *     the freshly-created run header.
 *   - On success: toast.success + router.push to `/runs/{newRunId}` so
 *     the operator lands on the new run's detail page (mirrors the
 *     `useCreateRun` contract that the NewRunDialog follows).
 *   - On failure: toast.error with the orchestrator's message; the
 *     caller does NOT need to navigate (the source run stays put).
 *
 * The hook is consumed by `<ReplayButton />` which also blocks the
 * click while the run is `running` / `pending` — see M6-G1.
 */
export function useReplayRun() {
  const router = useRouter();
  const qc = useQueryClient();
  return useMutation<ReplayRunResponse, Error, string>({
    mutationFn: (runId) => replayRun(runId),
    onSuccess: (data) => {
      const newId = data.run?.id;
      toast.success('Run replayed', {
        description: newId
          ? `Opening run ${newId}…`
          : 'New run dispatched.',
      });
      // Invalidate the index list so the new row appears within the
      // next poll cycle without a hard refresh.
      void qc.invalidateQueries({ queryKey: runsQueryKeys.all });
      if (newId) {
        router.push(`/runs/${encodeURIComponent(newId)}`);
      }
    },
    onError: (err) => {
      toast.error('Replay failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });
}
