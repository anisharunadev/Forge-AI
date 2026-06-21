'use client';

/**
 * TanStack Query hooks for the Refactor Agent surfaces (F-213).
 *
 * The refactor routes live alongside the rest of the Forge console;
 * they reuse the QueryClient wired in `components/providers.tsx`
 * (30 s staleTime, refetchOnWindowFocus=false, retry=1). Server-side
 * fetches should NOT import this file — call the `lib/api.ts`
 * `listMigrationPlans` / `getMigrationPlan` functions directly so
 * Next.js can server-render the page.
 *
 * Three hooks are exported:
 *   - `useMigrationPlans(projectId)` — list view, polled every 30 s
 *     so a freshly-completed analysis lights up without a manual refresh.
 *   - `useMigrationPlan(planId)`     — detail view, refetches every
 *     10 s while the plan is in `analyzing` / `awaiting_approval` /
 *     `in_progress` so the operator can watch phase transitions.
 *   - `useTriggerRefactorAnalysis()` — mutation hook used by the
 *     wizard to kick off a new analysis. On success the caller should
 *     navigate to `/refactor/{planId}` for the detail view.
 *   - `usePushMigrationPlanToJira()` — mutation hook for the
 *     `<PushToJiraButton>`. Fires F-213 with the Idempotency-Key
 *     contract that the orchestrator expects.
 */

import { useMutation, useQuery } from '@tanstack/react-query';

import {
  getMigrationPlan,
  listMigrationPlans,
  pushMigrationPlanToJira,
  triggerRefactorAnalysis,
  type JiraPushResult,
  type MigrationPlan,
  type RefactorAnalysisSource,
} from '@/lib/api';

/** Stable query keys so the cache survives HMR / route changes. */
export const migrationQueryKeys = {
  all: ['refactor'] as const,
  list: (projectId: string) =>
    [...migrationQueryKeys.all, 'list', projectId] as const,
  detail: (planId: string) =>
    [...migrationQueryKeys.all, 'detail', planId] as const,
};

/**
 * List migration plans for a project. Polled every 30 s so a
 * newly-finished analysis lights up without a manual refresh.
 */
export function useMigrationPlans(projectId: string) {
  return useQuery<ReadonlyArray<MigrationPlan>>({
    queryKey: migrationQueryKeys.list(projectId),
    queryFn: () => listMigrationPlans(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * Detail hook — refetches more aggressively while the plan is still
 * in motion (analyzing / awaiting_approval / in_progress) so the
 * operator sees phases transition without a manual refresh. Once the
 * plan reaches a terminal state (`complete` / `archived`) we stop
 * polling.
 */
export function useMigrationPlan(planId: string) {
  return useQuery<MigrationPlan>({
    queryKey: migrationQueryKeys.detail(planId),
    queryFn: () => getMigrationPlan(planId),
    enabled: Boolean(planId),
    refetchInterval: (q) => {
      const data = q.state.data as MigrationPlan | undefined;
      if (!data) return 5_000;
      const inFlight =
        data.status === 'draft' ||
        data.status === 'pending_approval' ||
        data.status === 'approved' ||
        data.status === 'in_progress';
      return inFlight ? 10_000 : false;
    },
    staleTime: 10_000,
  });
}

/**
 * Mutation hook — kick off a new refactor analysis. The wizard calls
 * `mutate(source)` and routes to `/refactor/{planId}` on success.
 */
export function useTriggerRefactorAnalysis() {
  return useMutation<MigrationPlan, Error, RefactorAnalysisSource>({
    mutationFn: (source) => triggerRefactorAnalysis(source),
  });
}

/**
 * Mutation hook — push a finalized plan to Jira (F-213). On success
 * the wizard can show the synthetic `epicKey` so the operator has a
 * receipt to share.
 */
export function usePushMigrationPlanToJira(planId: string) {
  return useMutation<JiraPushResult, Error, void>({
    mutationFn: () => pushMigrationPlanToJira(planId),
  });
}