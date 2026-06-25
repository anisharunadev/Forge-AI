'use client';

/**
 * TanStack Query hook for the Ideation Center "Push to Jira" CTA
 * (Forge AI-440 / Pillar 1 Phase 1).
 *
 * Mirrors the canonical shape established by
 * `usePushMigrationPlanToJira` in `useMigrationPlans.ts` — same
 * generic arguments, same `void` mutation variable, same
 * `Idempotency-Key` contract via `request<T>()` in `lib/api.ts`.
 *
 * The endpoint is `POST /v1/ideation/ideas/{id}/push/jira` and the
 * server-side handler (`backend/app/api/v1/ideation/push.py`) accepts
 * `{ project_key }` in the body and returns the canonical `PushResult`
 * shape:
 *
 *     { target, success, external_ref, error, record_id }
 *
 * Today the hook still consumes the public `JiraPushResult` adapter
 * (defined alongside the push call) so the UI doesn't have to do
 * `JIRA/` prefix parsing on its own. The adapter exposes
 * `epicKey` + `storyKeys` + `pushedAt`, matching the migration-plan
 * push contract so `<PushIdeaToJiraButton>` can mirror
 * `<PushToJiraButton>` byte-for-byte.
 */

import { useMutation } from '@tanstack/react-query';

import { pushIdeaToJira, type JiraPushResult } from '@/lib/ideation/data';

/**
 * The Jira project key the ideation push targets.
 *
 * TODO(Phase 1): hard-coded for the seeded dev tenant (`acme-corp` /
 * `project-forge-demo`). Phase 2 will read this from the connector
 * config returned by `GET /v1/connectors/jira` so the value tracks the
 * tenant's actual Jira instance.
 */
export const IDEATION_JIRA_PROJECT_KEY = 'FORA';

/** Stable query keys so the mutation cache survives HMR / route changes. */
export const pushIdeaQueryKeys = {
  detail: (ideaId: string) =>
    ['ideation', 'push', ideaId] as const,
};

/**
 * Mutation hook — push an approved idea to Jira. On success the
 * caller can show the returned `epicKey` so the operator has a
 * receipt to share.
 *
 * Body sent: `{ project_key: IDEATION_JIRA_PROJECT_KEY }`.
 */
export function usePushIdeaToJira(ideaId: string) {
  return useMutation<JiraPushResult, Error, void>({
    mutationFn: () => pushIdeaToJira(ideaId, IDEATION_JIRA_PROJECT_KEY),
  });
}