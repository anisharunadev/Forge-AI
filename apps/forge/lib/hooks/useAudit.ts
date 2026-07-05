'use client';

/**
 * TanStack Query hooks for the Audit Center (M7).
 *
 * The Audit Center is the WORM-backed compliance surface; it exposes
 * a chain-of-custody hash over every audit event. M7 wires the
 * integrity probe — `GET /api/v1/audit/integrity` — to the UI so the
 * operator can confirm the chain is intact (or see exactly where it
 * broke).
 *
 * Hooks exported:
 *   - `useAuditIntegrity()` — TanStack Query against the new
 *     `/api/v1/audit/integrity` endpoint. Polls every 30 s and on
 *     window focus; the banner reads the resulting shape.
 *
 * Pattern mirrors `lib/hooks/useRuns.ts` (canonical example in this
 * codebase): stable query key, narrow fetcher, TanStack defaults that
 * match the existing Audit Center poll cadence.
 */

import {
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';

import { forgeFetch } from '@/lib/forge-api';

// ---------------------------------------------------------------------------
// Shape returned by `GET /api/v1/audit/integrity`
//
// Mirrors the backend `AuditIntegrityRead` Pydantic model at
// `backend/app/services/observability_service.py:268` and the new
// route in `backend/app/api/v1/audit.py`. The backend returns 404
// when the tenant has zero audit events; the hook surfaces that as
// `data === undefined` so the banner can render the loading skeleton
// (and the page chrome already handles the empty-records empty state
// separately).
// ---------------------------------------------------------------------------

export interface AuditIntegrity {
  /** Tenant the integrity probe ran against (UUID string). */
  readonly tenant_id: string;
  /** SHA-256 chain head (hex). Empty string when there are no events. */
  readonly head_hash: string;
  /** Number of events walked during the verification. */
  readonly length: number;
  /** Timestamp of the most recent event, or null when the chain is empty. */
  readonly last_event_at: string | null;
  /** True when every event's `hash_chain_ref` matches the recomputed digest. */
  readonly integrity_ok: boolean;
  /** Set when `integrity_ok === false`; the id of the first broken event. */
  readonly broken_at_event_id?: string;
}

// ---------------------------------------------------------------------------
// Query keys — stable so HMR / route changes don't drop the cached state.
// ---------------------------------------------------------------------------

export const auditQueryKeys = {
  all: ['audit'] as const,
  integrity: () => [...auditQueryKeys.all, 'integrity'] as const,
};

// ---------------------------------------------------------------------------
// Fetcher — single-purpose, typed, throws on non-2xx so TanStack can
// surface `error` (the banner uses that branch to render the
// "endpoint unavailable" copy).
// ---------------------------------------------------------------------------

async function fetchAuditIntegrity(): Promise<AuditIntegrity> {
  return forgeFetch<AuditIntegrity>('/audit/integrity', {
    cache: 'no-store',
  });
}

/**
 * M7-G1 — live audit-chain integrity probe.
 *
 *   - TanStack Query against `GET /api/v1/audit/integrity`.
 *   - `refetchInterval: 30_000` — same cadence as the existing audit
 *     hooks (`useAuditEvents`, `useLLMTraffic`) so the banner stays
 *     in lockstep with the timeline.
 *   - `refetchOnWindowFocus: true` — operators frequently tab away
 *     while reviewing the chain; on focus we want to confirm nothing
 *     else got appended while we were idle.
 *   - Returns the raw TanStack result so the banner can switch on
 *     `isLoading` / `isError` / `data?.integrity_ok` without a
 *     second layer of state shaping.
 *
 * The hook is intentionally permissive about cache freshness —
 * `staleTime: 0` so every poll yields a fresh probe. The 30 s
 * `refetchInterval` is the de-bounce.
 */
export function useAuditIntegrity(): UseQueryResult<AuditIntegrity> {
  return useQuery<AuditIntegrity>({
    queryKey: auditQueryKeys.integrity(),
    queryFn: () => fetchAuditIntegrity(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: 1,
  });
}