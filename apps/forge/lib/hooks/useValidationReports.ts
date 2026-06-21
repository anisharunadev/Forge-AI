'use client';

/**
 * TanStack Query hooks for the Code Validator surfaces (FORA-620).
 *
 * The validator routes live alongside the rest of the Forge console;
 * they reuse the QueryClient wired in `components/providers.tsx`
 * (30 s staleTime, refetchOnWindowFocus=false, retry=1). Server-side
 * fetches should NOT import this file — call the `lib/api.ts`
 * `listValidationReports` / `getValidationReport` functions directly
 * so Next.js can server-render the page.
 *
 * Three hooks are exported:
 *   - `useValidationReports(projectId)` — list view, polls every 30s.
 *   - `useValidationReport(reportId)`  — detail view, refetches every
 *     20s while the scan is `running` so the operator can watch new
 *     findings land without refreshing.
 *   - `useLiveValidationScans(projectId)` — long-poll (3s) variant
 *     for the `live` page, which renders a tail of in-progress scans.
 */

import { useQuery } from '@tanstack/react-query';

import {
  getValidationReport,
  listValidationReports,
  type ValidationReport,
} from '@/lib/api';

/** Stable query keys so the cache survives HMR / route changes. */
export const validationQueryKeys = {
  all: ['validation'] as const,
  list: (projectId: string) =>
    [...validationQueryKeys.all, 'list', projectId] as const,
  detail: (reportId: string) =>
    [...validationQueryKeys.all, 'detail', reportId] as const,
  live: (projectId: string) =>
    [...validationQueryKeys.all, 'live', projectId] as const,
};

/**
 * List reports for a project. Polled every 30 s so a newly-finished
 * scan lights up without a manual refresh.
 */
export function useValidationReports(projectId: string) {
  return useQuery<ReadonlyArray<ValidationReport>>({
    queryKey: validationQueryKeys.list(projectId),
    queryFn: () => listValidationReports(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * Detail hook — refetches more aggressively while the scan is still
 * running so the operator sees findings as the orchestrator writes them.
 * Once the scan reaches `pass` / `fail` / `error` we stop polling.
 */
export function useValidationReport(reportId: string) {
  const query = useQuery<ValidationReport>({
    queryKey: validationQueryKeys.detail(reportId),
    queryFn: () => getValidationReport(reportId),
    enabled: Boolean(reportId),
    refetchInterval: (q) => {
      const data = q.state.data as ValidationReport | undefined;
      return data?.status === 'running' ? 5_000 : false;
    },
    staleTime: 10_000,
  });
  return query;
}

/**
 * Live tail of in-progress scans for a project. The list view already
 * polls every 30s; the live view overrides that to 3s so the operator
 * sees scans start/stop almost in real time.
 */
export function useLiveValidationScans(projectId: string) {
  return useQuery<ReadonlyArray<ValidationReport>>({
    queryKey: validationQueryKeys.live(projectId),
    queryFn: () => listValidationReports(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 3_000,
    staleTime: 1_000,
  });
}