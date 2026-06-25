/**
 * F-800 — Feature flags consumer.
 *
 * The Co-pilot is feature-flagged server-side. The backend exposes
 * `GET /api/v1/system/features` (lands in Plan 6 — F-800 §6) which
 * returns the canonical flag dict for the current tenant.
 *
 * Until Plan 6 ships, the endpoint may 404 in dev. We fall back to a
 * sane local default (enabled in dev, disabled in prod-ish envs)
 * based on `NEXT_PUBLIC_COPILOT_ENABLED`. This lets the panel render
 * during development without blocking Plan 3.
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
 * (the endpoint may not exist in dev yet — Plan 6 wires it for real).
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
    // Network failure, endpoint missing, or parse error — use defaults.
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