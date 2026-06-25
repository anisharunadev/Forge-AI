'use client';

/**
 * TanStack Query hook for the Project Intelligence "Sync from Jira"
 * buttons (Forge AI-440 / Pillar 1 Phase 4).
 *
 * Phase 1's `JiraIngestionService` is the consumer; the UI here
 * triggers a single `POST /api/v1/connectors/jira/sync` call that
 * pulls the latest state of a Jira issue (epic, story, or PRD) into
 * the local Project Intelligence row. The target discriminator
 * (`'epic' | 'story' | 'prd'`) is captured at hook-call time so the
 * component that owns the button does not have to thread the
 * verb through.
 *
 * The hook is a thin TanStack Query wrapper over
 * `lib/connectors/data.ts::syncFromJira` — same Idempotency-Key
 * pattern as the rest of the `use*` family in
 * `lib/hooks/`.
 */

import { useMutation } from '@tanstack/react-query';

import { syncFromJira, type JiraSyncResult } from '@/lib/connectors/data';

/** The Jira-backed Project Intelligence row that `Sync from Jira` targets. */
export type JiraSyncTarget = 'epic' | 'story' | 'prd';

/** Variables passed to `useJiraSync(target).mutate(...)`. */
export interface JiraSyncVariables {
  readonly issue_key: string;
  readonly idea_id?: string;
}

/** Stable query keys so the mutation cache survives HMR / route changes. */
export const jiraSyncQueryKeys = {
  detail: (target: JiraSyncTarget, issueKey: string) =>
    ['connectors', 'jira', 'sync', target, issueKey] as const,
};

/**
 * Mutation hook — pull a Jira issue into the matching Project
 * Intelligence row. The endpoint is
 * `POST /api/v1/connectors/jira/sync` with body
 * `{ issue_key, target }`.
 *
 * On success the caller should refetch the relevant Project
 * Intelligence row (e.g. via `useApiData('/v1/project-intelligence/...')`)
 * so the page reflects the new state without a hard reload.
 */
export function useJiraSync(target: JiraSyncTarget) {
  return useMutation<JiraSyncResult, Error, JiraSyncVariables>({
    mutationFn: (vars) => syncFromJira(target, vars),
  });
}
