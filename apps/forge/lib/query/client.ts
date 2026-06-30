/**
 * TanStack Query client (step-54 — Phase 2 Agents + Providers wiring).
 *
 * Single QueryClient instance for the whole app. Lives here (not in
 * providers.tsx) so server-side code and non-React callers can import
 * the same instance if needed, and so the client configuration is
 * discoverable in one file.
 *
 * Defaults adopted from the step-54 spec:
 *   - staleTime: 30s (so a fast tab flip doesn't trigger an immediate
 *     refetch while the cache is still warm).
 *   - gcTime: 5m (cache survives route changes and tab flips).
 *   - retry: don't retry 4xx (they're not going to fix themselves),
 *     retry transient errors up to 3 times.
 *   - refetchOnWindowFocus: false (avoids surprise refetches while the
 *     user is reading).
 *
 * Skill rule adopted (see step-54 invocation log):
 *   - "When a query fails, surface the error to the user immediately"
 *     → 4xx errors are not silently retried.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error: any) => {
        if (error?.status >= 400 && error?.status < 500) return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});