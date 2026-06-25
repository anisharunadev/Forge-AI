'use client';

/**
 * TanStack Query hooks for the persona-keyed memory surface
 * (Forge AI-440 / Pillar 1 Phase 3).
 *
 * Mirrors the canonical shape established by `usePushIdeaToJira` in
 * `usePushIdeaToJira.ts` and `useApprovalDecide` in
 * `useApprovalDecide.ts` — same generic arguments, same
 * Idempotency-Key contract via `lib/persona/data.ts`. The hooks stay
 * thin TanStack wrappers; the actual fetches live in
 * `lib/persona/data.ts` (matches the Phase 1 / Phase 2 decision to
 * co-locate fetcher functions with the rest of `lib/ideation/data.ts`).
 *
 * The persona key is one of the six persona-keyed memory slots
 * (`coding`, `architecture`, `security`, `ideation`, `qa`, `devops`)
 * defined by the steering engine glob at
 * `backend/app/services/steering_rules.py` (Phase 3 widens the glob
 * to the double-star / steering / double-star-md pattern so
 * `tenants/<slug>/workspace/memory/personas/<persona>/{coding,architecture,
 * security,ideation,qa,devops}.md` are auto-discovered).
 *
 * `usePersonaMemory(key)`:
 *   - Calls `GET /v1/persona/memory/{key}`.
 *   - Returns `{ body: string, recent_entries: [...] }`.
 *
 * `useAppendPersonaMemory(key)`:
 *   - Calls `POST /v1/persona/memory/{key}` with `{ entry_md }`.
 *   - Server returns `{ ok: true }`.
 *   - On success the caller should invalidate the matching query key
 *     so the body + recent_entries refresh.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  appendPersonaMemory,
  readPersonaMemory,
  type PersonaMemory,
} from '@/lib/persona/data';

/**
 * Stable query keys so the persona memory query survives HMR / route
 * changes. The persona key is part of the key so two personas (e.g.
 * `developer` vs `product_manager`) don't collide on the same memory
 * slot (`coding`, `ideation`, etc.).
 */
export const personaMemoryQueryKeys = {
  /** Read-only query for the persona-keyed memory slot. */
  detail: (persona: string, key: string) =>
    ['persona', 'memory', persona, key] as const,
};

/** Variables passed to `useAppendPersonaMemory().mutate(...)`. */
export interface AppendPersonaMemoryVariables {
  readonly entry_md: string;
}

/**
 * Query hook — read the persona-keyed Markdown memory file plus the
 * last 24h of append entries.
 *
 * The query is keyed on `(persona, key)` so two personas sharing the
 * same memory slot do not collide. The default `staleTime` is `30s`
 * (matches the persona-mutation cadence — appends do not happen more
 * frequently than that in normal use).
 */
export function usePersonaMemory(persona: string, key: string) {
  return useQuery<PersonaMemory>({
    queryKey: personaMemoryQueryKeys.detail(persona, key),
    queryFn: () => readPersonaMemory(key),
    staleTime: 30_000,
    enabled: Boolean(persona && key),
  });
}

/**
 * Mutation hook — append a Markdown entry to the persona-keyed memory
 * log. On success the query cache for `(persona, key)` is invalidated
 * so the UI refetches the refreshed body + recent entries.
 *
 * The persona is captured via the `invalidateKeys` helper so the
 * caller doesn't have to remember to plumb it through.
 */
export function useAppendPersonaMemory(persona: string, key: string) {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: true },
    Error,
    AppendPersonaMemoryVariables,
    { previous: PersonaMemory | undefined }
  >({
    mutationFn: ({ entry_md }) => appendPersonaMemory(key, entry_md),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: personaMemoryQueryKeys.detail(persona, key),
      });
    },
  });
}