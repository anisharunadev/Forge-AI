'use client';

/**
 * TanStack Query hooks for the Analytics Center (Step-59 Zone 11).
 *
 * The Analytics Center is the user-facing lens over LiteLLM spend
 * data. All cost / token / provider breakdowns now flow through
 * these hooks — backed by the typed SDK in `lib/litellm/data.ts`
 * and the proxy endpoints added in `backend/app/api/v1/admin_llm_gateway.py`
 * (Zone 10) + `backend/app/api/v1/terminal_costs.py` (Zone 3).
 *
 * Pattern mirrors `lib/hooks/useLiteLLM.ts` (canonical example in
 * this codebase) and `lib/hooks/useSettings.ts`.
 *
 * Rule conformance:
 *  - Rule 1 (model-provider agnosticism) — we proxy through the
 *    orchestrator → LiteLLM; never import a provider SDK.
 *  - Rule 9 (forge-core canonical) — the Analytics UI reads its
 *    shape from the typed SDK; no hardcoded chart mappings.
 *
 * The `forgeFetch` helper (lib/forge-api.ts) prepends the orchestrator
 * base URL (`/api/v1`) so the paths here are relative to that root.
 */

import {
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  listSpendLogs,
  listSpendModels,
  listSpendTeams,
  type SpendLogEntry,
  type SpendModelRow,
  type SpendTeamRow,
} from '@/lib/litellm/data';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * Stable query keys so the cache survives HMR / route changes.
 * Analytics page mounts/unmounts frequently; without a stable key the
 * refetch intervals below would lose their cadence.
 */
export const analyticsQueryKeys = {
  spendByDay: (days: number) => ['analytics', 'spend-by-day', days] as const,
  spendByModel: (days: number) =>
    ['analytics', 'spend-by-model', days] as const,
  spendLogs: (days: number, limit: number) =>
    ['analytics', 'spend-logs', days, limit] as const,
};

// ---------------------------------------------------------------------------
// Spend by day
// ---------------------------------------------------------------------------

/**
 * Daily spend series for the cost-trend area chart.
 *
 * Backed by `/admin/llm-gateway/spend/teams?days={days}` (Zone 10).
 * The endpoint returns one row per team; the page buckets by date
 * client-side. We expose the raw team rows here so callers can do
 * whatever aggregation they need.
 */
export function useSpendByDay(
  days: number = 30,
): UseQueryResult<ReadonlyArray<SpendTeamRow>, Error> {
  return useQuery<ReadonlyArray<SpendTeamRow>, Error>({
    queryKey: analyticsQueryKeys.spendByDay(days),
    queryFn: () => listSpendTeams({ days }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Spend by model
// ---------------------------------------------------------------------------

/**
 * Per-model spend rows for the provider cost stack + leaderboard.
 *
 * Backed by `/admin/llm-gateway/spend/models?days={days}` (Zone 10).
 * Direct passthrough from LiteLLM `/spend/models`.
 */
export function useSpendByModel(
  days: number = 30,
): UseQueryResult<ReadonlyArray<SpendModelRow>, Error> {
  return useQuery<ReadonlyArray<SpendModelRow>, Error>({
    queryKey: analyticsQueryKeys.spendByModel(days),
    queryFn: () => listSpendModels({ days }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Spend logs (raw)
// ---------------------------------------------------------------------------

/**
 * Raw spend-log entries. Used for client-side aggregation that the
 * pre-baked endpoints don't cover — e.g. agent usage grouped by
 * `metadata.agent_id`, or token usage grouped by `model`.
 *
 * Backed by `/costs?days={days}&limit={limit}` (Zone 3).
 */
export function useSpendLogs(
  days: number = 7,
  limit: number = 200,
): UseQueryResult<ReadonlyArray<SpendLogEntry>, Error> {
  return useQuery<ReadonlyArray<SpendLogEntry>, Error>({
    queryKey: analyticsQueryKeys.spendLogs(days, limit),
    queryFn: () => listSpendLogs({ days, limit }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}
