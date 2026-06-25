'use client';

/**
 * useLiteLLMStatus — global LiteLLM availability hook.
 *
 * Polls `GET /api/v1/health/litellm` every 30s. Used by the
 * `LLMUnavailableBanner` mounted at app root in
 * `components/providers.tsx`. Auto-clears on recovery per the
 * Phase B exit criteria.
 *
 * Mirrors the pattern in `useIdeationIngestStatus.ts`.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getLiteLLMHealth,
  type LiteLLMHealthSnapshot,
} from '@/lib/litellm/data';

const LITELLM_STATUS_QUERY_KEY = ['litellm', 'health'] as const;

export function useLiteLLMStatus(): UseQueryResult<
  LiteLLMHealthSnapshot,
  Error
> {
  return useQuery<LiteLLMHealthSnapshot, Error>({
    queryKey: LITELLM_STATUS_QUERY_KEY,
    queryFn: () => getLiteLLMHealth(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });
}

export { LITELLM_STATUS_QUERY_KEY };
