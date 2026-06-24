'use client';

/**
 * TanStack Query hooks for the seeds API (Plan F — frontend hooks).
 *
 * Wraps the typed SDK in `lib/seeds/data.ts` with the canonical
 * `useQuery` / `useMutation` pattern from this codebase. Mirrors
 * `useConnectorLifecycle.ts` (mutations) and `useSettings.ts`
 * (query-key factory) so Plan G (`DemoBanner`) and Plan H
 * (`/admin/seeds`) consume a consistent shape.
 *
 *   - `seedKeys` — central query-key factory; the only place
 *     cache keys are spelled out.
 *   - `useSeedsList`        — list query for the admin picker.
 *   - `useSeed`             — full manifest (data files + counts).
 *   - `useSeedStatus`       — applied? drift? — supports `refetchInterval`
 *                             so the Plan G welcome poll can render a
 *                             live status pill until `applied === true`.
 *   - `useSeedDiff`         — manual diff trigger (no auto-poll).
 *   - `useSeedRuns`         — apply/reset/rollback history.
 *   - `useApplySeed`        — POST /apply; invalidates status + runs.
 *   - `useResetSeed`        — POST /reset; invalidates status + runs.
 *   - `useRollbackSeed`     — POST /rollback; invalidates status + runs.
 *
 * Mutations are deliberately narrow: only the queries that need to
 * reflect new state (status + runs) get invalidated. The list query
 * does not change on mutation.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import * as seedsApi from '@/lib/seeds/data';
import type {
  SeedApplyRequest,
  SeedResetRequest,
} from '@/lib/seeds/types';

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const seedKeys = {
  all: ['seeds'] as const,
  list: () => [...seedKeys.all, 'list'] as const,
  detail: (name: string) => [...seedKeys.all, 'detail', name] as const,
  status: (name: string) => [...seedKeys.all, 'status', name] as const,
  diff: (name: string) => [...seedKeys.all, 'diff', name] as const,
  runs: (name: string) => [...seedKeys.all, 'runs', name] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List of manifest summaries — used by the Plan H picker + Plan G welcome. */
export function useSeedsList() {
  return useQuery({
    queryKey: seedKeys.list(),
    queryFn: () => seedsApi.listSeeds(),
    staleTime: 30_000,
  });
}

/** Full manifest for a single seed (data files, expected row counts). */
export function useSeed(name: string) {
  return useQuery({
    queryKey: seedKeys.detail(name),
    queryFn: () => seedsApi.getSeed(name),
    enabled: Boolean(name),
    staleTime: 60_000,
  });
}

/** Applied-state + checksum + drift. Accepts a `refetchInterval` so
 * the Plan G welcome page can poll until `applied === true`. */
export function useSeedStatus(
  name: string,
  options?: { refetchInterval?: number },
) {
  return useQuery({
    queryKey: seedKeys.status(name),
    queryFn: () => seedsApi.getSeedStatus(name),
    enabled: Boolean(name),
    refetchInterval: options?.refetchInterval,
    staleTime: 5_000,
  });
}

/** Live-vs-manifest delta. `staleTime: 0` so a re-click always re-fetches. */
export function useSeedDiff(name: string) {
  return useQuery({
    queryKey: seedKeys.diff(name),
    queryFn: () => seedsApi.getSeedDiff(name),
    enabled: Boolean(name),
    staleTime: 0,
  });
}

/** Apply / reset / rollback history. */
export function useSeedRuns(name: string) {
  return useQuery({
    queryKey: seedKeys.runs(name),
    queryFn: () => seedsApi.getSeedRuns(name),
    enabled: Boolean(name),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** `POST /seeds/{name}/apply` — idempotent re-apply. */
export function useApplySeed(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeedApplyRequest = {}) =>
      seedsApi.applySeed(name, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seedKeys.status(name) });
      void qc.invalidateQueries({ queryKey: seedKeys.runs(name) });
    },
  });
}

/** `POST /seeds/{name}/reset` — `scope` controls how aggressive. */
export function useResetSeed(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeedResetRequest) => seedsApi.resetSeed(name, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seedKeys.status(name) });
      void qc.invalidateQueries({ queryKey: seedKeys.runs(name) });
    },
  });
}

/** `POST /seeds/{name}/rollback` — undo the most recent apply. */
export function useRollbackSeed(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => seedsApi.rollbackSeed(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seedKeys.status(name) });
      void qc.invalidateQueries({ queryKey: seedKeys.runs(name) });
    },
  });
}
