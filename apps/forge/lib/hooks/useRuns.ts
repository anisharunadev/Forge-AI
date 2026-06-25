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
 *
 * Server-side fetches should NOT import this file — call the
 * functions in `lib/api.ts` directly so Next.js can server-render
 * the page.
 */

import { useMutation, useQuery } from '@tanstack/react-query';

import {
  createRun,
  getRun,
  getRunStages,
  getRunsView,
  type CreateRunInput,
  type RunRecord,
  type RunsView,
  type StageRecord,
} from '@/lib/api';

/** Stable query keys so the cache survives HMR / route changes. */
export const runsQueryKeys = {
  all: ['runs'] as const,
  index: () => [...runsQueryKeys.all, 'index'] as const,
  detail: (id: string) => [...runsQueryKeys.all, 'detail', id] as const,
  stages: (id: string) => [...runsQueryKeys.all, 'stages', id] as const,
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
