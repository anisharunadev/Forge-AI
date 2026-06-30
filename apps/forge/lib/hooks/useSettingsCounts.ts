'use client';

/**
 * Settings counts hook (step-62 Zone 8).
 *
 * Drives the badges in `SettingsSidebar`. Reads the project id from
 * the auth context (`useAuth().project`) — no more hardcoded
 * `project-forge-demo`.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/api/auth';

export interface SettingsCounts {
  members: number;
  pending_invitations: number;
  agents: number;
  providers: number;
  env_vars: number;
  integrations: number;
  audit_events_30d: number;
  webhooks: number;
  connected_apps: number;
  feature_flags: number;
}

export function useSettingsCounts(): UseQueryResult<SettingsCounts, Error> {
  const projectId = useAuth((s) => s.project?.id ?? null);
  return useQuery<SettingsCounts, Error>({
    queryKey: ['settings', 'counts', projectId] as const,
    queryFn: () =>
      api.get<SettingsCounts>(`/projects/${projectId}/settings/counts`),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}
