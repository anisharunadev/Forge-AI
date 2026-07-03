/**
 * Onboarding wizard React Query hooks — step-74.
 *
 * Each hook maps directly to a FastAPI endpoint exposed by
 * `backend/app/api/v1/onboarding.py`. Types mirror the locked Pydantic
 * schemas in `lib/api/onboarding.ts`.
 *
 * Skill rules adopted:
 *   - **Tenant scoping (Rule 2)** — the API client injects
 *     `x-forge-tenant-id` from the auth store on every call, so each
 *     hook transparently resolves the active tenant.
 *   - **Cache invalidation** — mutations write the returned session
 *     straight into the `queryKeys.onboarding.session(id)` cache so
 *     every consumer of the same id sees the new state without a
 *     refetch.
 *   - **Polling** — `useProvisionStatus` accepts a `refetchInterval`
 *     so the caller controls the cadence.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api/client';

import {
  queryKeys,
  type AdvanceWizardInput,
  type ProvisionProgress,
  type StartProvisionResponse,
  type WizardSession,
} from './onboarding';

// ---------------------------------------------------------------------------
// POST /onboarding/sessions — start a new wizard session
// ---------------------------------------------------------------------------

export function useStartWizard(): UseMutationResult<WizardSession, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<WizardSession>('/onboarding/sessions', {}),
    onSuccess: (s) => {
      qc.setQueryData(queryKeys.onboarding.session(s.id), s);
      qc.setQueryData(queryKeys.onboarding.active(), s);
    },
  });
}

// ---------------------------------------------------------------------------
// GET /onboarding/sessions/{id} — read + poll a wizard session
// ---------------------------------------------------------------------------

export interface UseWizardSessionOptions {
  refetchInterval?: number | false;
  enabled?: boolean;
}

export function useWizardSession(
  sessionId: string | null | undefined,
  options: UseWizardSessionOptions = {},
): UseQueryResult<WizardSession> {
  return useQuery<WizardSession>({
    queryKey: queryKeys.onboarding.session(sessionId ?? ''),
    queryFn: () =>
      api.get<WizardSession>(`/onboarding/sessions/${sessionId}`),
    enabled: options.enabled ?? Boolean(sessionId),
    refetchInterval: options.refetchInterval ?? false,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// POST /onboarding/sessions/{id}/advance — drive the state machine
// ---------------------------------------------------------------------------

export function useAdvanceWizard(
  sessionId: string | null | undefined,
): UseMutationResult<WizardSession, Error, AdvanceWizardInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdvanceWizardInput) =>
      api.post<WizardSession>(
        `/onboarding/sessions/${sessionId}/advance`,
        payload,
      ),
    onSuccess: (s) => {
      if (sessionId) {
        qc.setQueryData(queryKeys.onboarding.session(sessionId), s);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// POST /onboarding/sessions/{id}/cancel
// ---------------------------------------------------------------------------

export function useCancelWizard(
  sessionId: string | null | undefined,
): UseMutationResult<WizardSession, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<WizardSession>(`/onboarding/sessions/${sessionId}/cancel`, {}),
    onSuccess: (s) => {
      if (sessionId) {
        qc.setQueryData(queryKeys.onboarding.session(sessionId), s);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// POST /onboarding/provision — kick off the 5-stage provision job
// ---------------------------------------------------------------------------

export function useStartProvision(): UseMutationResult<
  StartProvisionResponse,
  Error,
  void
> {
  return useMutation({
    mutationFn: () =>
      api.post<StartProvisionResponse>('/onboarding/provision', {}),
  });
}

// ---------------------------------------------------------------------------
// GET /onboarding/provision/status — poll the provision job
// ---------------------------------------------------------------------------

export function useProvisionStatus(
  options: { refetchInterval?: number | false } = {},
): UseQueryResult<ProvisionProgress> {
  return useQuery<ProvisionProgress>({
    queryKey: queryKeys.onboarding.provisionStatus(),
    queryFn: () =>
      api.get<ProvisionProgress>('/onboarding/provision/status'),
    refetchInterval: options.refetchInterval ?? false,
    staleTime: 0,
  });
}