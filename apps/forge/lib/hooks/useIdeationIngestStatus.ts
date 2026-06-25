'use client';

/**
 * TanStack Query hook for the daily ideation ingest status indicator
 * (Forge AI-440 / Pillar 1 Phase 3).
 *
 * Mirrors the canonical shape established by `usePersonaMemory` in
 * `usePersonaMemory.ts` — same thin TanStack wrapper pattern, fetch
 * delegated to `lib/persona/data.ts::getIngestStatus`.
 *
 * The endpoint is `GET /v1/ideation/ingest/status` and returns
 * `{ last_run_at, ideas_created_today, status }` so `<IngestIndicator>`
 * can render "Last daily ingest: N new ideas" near the Ideation page
 * header.
 *
 * The query is polled every 30 seconds (`refetchInterval`) with a
 * matching `staleTime` so the badge refreshes in near-real-time
 * without hammering the orchestrator when the Ideation tab is open
 * for a long session.
 */

import { useQuery } from '@tanstack/react-query';

import {
  getIngestStatus,
  type IdeationIngestStatusPayload,
} from '@/lib/persona/data';

/** Stable query keys so the ingest status query survives HMR / route changes. */
export const ideationIngestStatusQueryKeys = {
  /** Read-only query for the daily ingest status. */
  detail: () => ['ideation', 'ingest', 'status'] as const,
};

/** 30-second stale + refetch cadence — daily ingest runs hourly, polling once every 30s is plenty. */
const INGEST_STATUS_POLL_MS = 30_000;

/**
 * Query hook — read the most recent daily ideation ingest run for
 * the tenant.
 *
 * The query polls every 30 seconds so the badge stays fresh while the
 * user has the Ideation page open. `staleTime` matches the poll
 * cadence so a refetch is only triggered by the interval, not by a
 * re-mount of the page.
 */
export function useIdeationIngestStatus() {
  return useQuery<IdeationIngestStatusPayload>({
    queryKey: ideationIngestStatusQueryKeys.detail(),
    queryFn: () => getIngestStatus(),
    staleTime: INGEST_STATUS_POLL_MS,
    refetchInterval: INGEST_STATUS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}