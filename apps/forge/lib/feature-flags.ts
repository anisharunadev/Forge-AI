/**
 * F-800 — Feature flags consumer.
 *
 * The Co-pilot is feature-flagged server-side. The backend exposes
 * `GET /api/v1/system/features` (Plan 6 — F-800 §6) which returns the
 * canonical flag dict for the current tenant. Plan 6 wired the
 * endpoint; this module's primary path now reads from it.
 *
 * The DEFAULT_FEATURES fallback still kicks in for transient network
 * failures and for Storybook/local-only renders where the backend
 * isn't running. It is NOT the canonical source — production
 * deployments MUST set the backend flags in `backend/.env`.
 *
 * Single TanStack Query hook: `useFeatures()`. Convenience selector
 * `useCopilotEnabled()` for hotkey + nav gating.
 */

import { useQuery } from '@tanstack/react-query';

export interface Features {
  COPILOT_ENABLED: boolean;
  COPILOT_STREAMING: boolean;
  COPILOT_DEFAULT_BUDGET_USD: number;
  COPILOT_TOOL_CALL_MAX: number;
  COPILOT_RATE_LIMIT_PER_MIN: number;
}

const DEFAULT_FEATURES: Features = {
  COPILOT_ENABLED:
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_COPILOT_ENABLED !== 'false'
      : true,
  COPILOT_STREAMING: false,
  COPILOT_DEFAULT_BUDGET_USD: 1.0,
  COPILOT_TOOL_CALL_MAX: 5,
  COPILOT_RATE_LIMIT_PER_MIN: 10,
};

/**
 * Fetch the feature flag dict. Falls back to defaults on any failure
 * (network blip, backend down for maintenance, Storybook renders).
 * The endpoint is wired in Plan 6 and is the canonical source.
 */
async function fetchFeatures(): Promise<Features> {
  try {
    const res = await fetch('/api/v1/system/features', {
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    });
    if (!res.ok) return DEFAULT_FEATURES;
    const body = (await res.json()) as Partial<Features>;
    return { ...DEFAULT_FEATURES, ...body };
  } catch {
    // Network failure or parse error — use defaults so the UI stays
    // responsive. The next query refetch will retry.
    return DEFAULT_FEATURES;
  }
}

/**
 * Cached feature flags query. `staleTime: 60s` because flags rarely
 * change during a session and we don't want a fetch on every render.
 */
export function useFeatures() {
  return useQuery<Features>({
    queryKey: ['features'],
    queryFn: fetchFeatures,
    staleTime: 60_000,
  });
}

/**
 * Convenience selector — returns the `COPILOT_ENABLED` flag (or
 * `false` until the query resolves). Used by `ShellProvider` to gate
 * the Cmd+J hotkey and by `nav-config` rendering for the Co-pilot
 * nav entry.
 */
export function useCopilotEnabled(): boolean {
  const { data } = useFeatures();
  return data?.COPILOT_ENABLED ?? DEFAULT_FEATURES.COPILOT_ENABLED;
}