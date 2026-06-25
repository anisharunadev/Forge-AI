'use client';

/**
 * TanStack Query hook for the Ideation Center "Enhance" CTA
 * (Forge AI-440 / Pillar 1 Phase 2).
 *
 * Mirrors the canonical shape established by `usePushIdeaToJira` in
 * `usePushIdeaToJira.ts` — same generic arguments, same Idempotency-Key
 * contract via `lib/ideation/data.ts`. The actual fetch lives in
 * `lib/ideation/data.ts::enhanceIdea` so the hook stays a thin TanStack
 * wrapper.
 *
 * The endpoint is `POST /v1/ideation/ideas/{id}/enhance` and the
 * server-side handler (added in Phase 2 alongside the
 * `IdeaEnhanceService`) accepts `{ editor_note }` in the body and
 * returns the refreshed `IdeaAnalysisRead` (mirrored client-side as
 * `IdeaAnalysis`).
 *
 * The hook is gated on `ideaId`: passing the empty string disables
 * the mutation so a closed/reset dialog cannot fire a stray request.
 */

import { useMutation } from '@tanstack/react-query';

import { enhanceIdea, type IdeaAnalysis } from '@/lib/ideation/data';

/** Stable query keys so the mutation cache survives HMR / route changes. */
export const ideaEnhanceQueryKeys = {
  detail: (ideaId: string) =>
    ['ideation', 'idea', 'enhance', ideaId] as const,
};

/** Variables passed to `useIdeaEnhance(ideaId).mutate(...)`. */
export interface IdeaEnhanceVariables {
  readonly editorNote: string;
}

/**
 * Mutation hook — re-run the analysis with an editor's note appended.
 *
 * `enabled` is false when `ideaId` is the empty string so the dialog
 * (which keeps the hook mounted across opens/closes) never fires a
 * stray request after a reset.
 */
export function useIdeaEnhance(ideaId: string) {
  return useMutation<IdeaAnalysis, Error, IdeaEnhanceVariables>({
    mutationFn: ({ editorNote }) => enhanceIdea(ideaId, editorNote),
  });
}
