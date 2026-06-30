/**
 * Dashboard React Query hooks (step-57 — Phase 5 Dashboard wiring).
 *
 * Each hook maps directly to a FastAPI endpoint. Types mirror the
 * locked Pydantic schemas exported from `lib/api/dashboard.ts`.
 *
 * Skill rules adopted:
 *   - **Tenant scoping (Rule 2)** — the API client injects
 *     `x-forge-tenant-id` from the auth store on every call, so
 *     each hook transparently resolves the active tenant.
 *   - **Cache invalidation** — mutations invalidate the relevant
 *     query keys (e.g. pinning an item invalidates
 *     `queryKeys.dashboard.pinned()`) so consumers always see fresh
 *     data without manual refresh.
 *   - **Optimistic unpin** — `useUnpinItem` removes the row from
 *     cache immediately and rolls back on error.
 *   - **Stale-while-revalidate** — KPIs refresh every 30s, activity
 *     every 15s, insights every 60s, alerts every 10s. These intervals
 *     match the goal file's "real-time updates" constraint.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import {
  queryKeys,
  type AIInsight,
  type Alert,
  type DashboardKPIs,
  type DashboardLayout,
  type PinnedItem,
  type TeamActivity,
} from './dashboard';

// ---------------------------------------------------------------------------
// Aggregated KPIs
// ---------------------------------------------------------------------------

/**
 * GET /dashboard/kpis — single round-trip that fans out across the
 * orchestrator + audit log + LiteLLM gateway to compute the six KPI
 * tiles. The backend's compute is cached for 15s.
 */
export function useDashboardKPIs(): UseQueryResult<DashboardKPIs> {
  return useQuery({
    queryKey: queryKeys.dashboard.kpis(),
    queryFn: () => api.get<DashboardKPIs>('/dashboard/kpis'),
    // 30s polling — keeps the strip fresh without hammering the
    // orchestrator. The backend also caches for 15s.
    refetchInterval: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Team activity
// ---------------------------------------------------------------------------

export function useTeamActivity(
  filter?: { since?: string; actor_id?: string },
): UseQueryResult<TeamActivity[]> {
  return useQuery({
    queryKey: queryKeys.dashboard.activity(filter),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter?.since) params.set('since', filter.since);
      if (filter?.actor_id) params.set('actor_id', filter.actor_id);
      const qs = params.toString();
      return api.get<TeamActivity[]>(`/dashboard/activity${qs ? `?${qs}` : ''}`);
    },
    // 15s polling — this is the "streaming" feed.
    refetchInterval: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Pinned items
// ---------------------------------------------------------------------------

export function usePinnedItems(): UseQueryResult<PinnedItem[]> {
  return useQuery({
    queryKey: queryKeys.dashboard.pinned(),
    queryFn: () => api.get<PinnedItem[]>('/dashboard/pinned'),
  });
}

export function usePinItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      item_type: PinnedItem['item_type'];
      item_id: string;
      item_data: Record<string, unknown>;
    }) => api.post<PinnedItem>('/dashboard/pinned', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.pinned() }),
  });
}

export function useUnpinItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/dashboard/pinned/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.dashboard.pinned() });
      const previous = qc.getQueryData<PinnedItem[]>(queryKeys.dashboard.pinned());
      qc.setQueryData<PinnedItem[]>(queryKeys.dashboard.pinned(), (old) =>
        old ? old.filter((p) => p.id !== id) : old,
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(queryKeys.dashboard.pinned(), context.previous);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.pinned() }),
  });
}

export function useReorderPinnedItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { id: string; sort_order: number }[]) =>
      api.patch<void>('/dashboard/pinned/reorder', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.pinned() }),
  });
}

// ---------------------------------------------------------------------------
// AI insights
// ---------------------------------------------------------------------------

export function useAIInsights(): UseQueryResult<AIInsight[]> {
  return useQuery({
    queryKey: queryKeys.dashboard.insights(),
    queryFn: () => api.get<AIInsight[]>('/dashboard/insights'),
    // 60s polling — insights are heavier; the backend caches them per
    // tenant for 60s already.
    refetchInterval: 60_000,
  });
}

export function useMarkInsightRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/dashboard/insights/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.insights() }),
  });
}

export function useDismissInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/dashboard/insights/${id}/dismiss`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.insights() }),
  });
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export function useAlerts(
  filter?: { unread_only?: boolean; severity?: 'info' | 'warning' | 'critical' },
): UseQueryResult<Alert[]> {
  return useQuery({
    queryKey: queryKeys.dashboard.alerts(filter),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filter?.unread_only) params.set('unread_only', 'true');
      if (filter?.severity) params.set('severity', filter.severity);
      const qs = params.toString();
      return api.get<Alert[]>(`/dashboard/alerts${qs ? `?${qs}` : ''}`);
    },
    // 10s polling — alerts are the highest-priority dashboard signal.
    refetchInterval: 10_000,
  });
}

export function useMarkAlertRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/dashboard/alerts/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
  });
}

export function useMarkAllAlertsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/dashboard/alerts/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
  });
}

// ---------------------------------------------------------------------------
// Dashboard layout
// ---------------------------------------------------------------------------

export function useDashboardLayout(): UseQueryResult<DashboardLayout> {
  return useQuery({
    queryKey: queryKeys.dashboard.layout(),
    queryFn: () => api.get<DashboardLayout>('/dashboard/layout'),
    // Layout changes infrequently — cache it for a minute.
    staleTime: 60_000,
  });
}

export function useUpdateDashboardLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (layout: DashboardLayout) =>
      api.put<DashboardLayout>('/dashboard/layout', layout),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.layout() }),
  });
}
