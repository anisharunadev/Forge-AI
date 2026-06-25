'use client';

/**
 * SyncFromJiraButton — "Sync from Jira" CTA for the Project
 * Intelligence detail pages (FORA-501 / Pillar 1 Phase 4).
 *
 * Triggers `POST /api/v1/connectors/jira/sync` via
 * `useJiraSync(target)` and re-fetches the matching row on success
 * (parent owns the refetch — see `onSynced` callback).
 *
 * Renders ONLY when `jiraIssueKey` is truthy. The Phase 4 surface is
 * the three detail pages (epic / story / draft PRD) and the
 * `idea_id` is the row's stable identifier in the
 * `lib/connectors/data.ts` sense. The matching test id is:
 *   - `sync-from-jira-epic`  for epics/[id]
 *   - `sync-from-jira-story` for stories/[id]
 *   - `sync-from-jira-prd`   for drafts/[id]
 *
 * Mirrors the affordance pattern from `<PushIdeaToJiraButton>`:
 * a single button that flips to a success pill, with an inline error
 * chip + retry on failure.
 */

import { CheckCircle2, Loader2, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  useJiraSync,
  type JiraSyncTarget,
  type JiraSyncVariables,
} from '@/lib/hooks/useJiraSync';

export interface SyncFromJiraButtonProps {
  /** The Jira issue key (e.g. `FORA-501`). When falsy the button is hidden. */
  readonly jiraIssueKey?: string | null;
  /** Target row kind (mirrors the server-side discriminator). */
  readonly target: JiraSyncTarget;
  /** Stable Project Intelligence row id; forwarded as `idea_id`. */
  readonly ideaId: string;
  /** Called after a successful sync so the parent can refetch. */
  readonly onSynced?: (vars: JiraSyncVariables & { target: JiraSyncTarget }) => void;
  /** Test-only override (default = `sync-from-jira-{target}`). */
  readonly testId?: string;
}

/**
 * The single source of truth for the per-target test id, exported so
 * the test files can pin a single string each (e.g. they assert
 * `data-testid="sync-from-jira-story"`).
 */
export function syncFromJiraTestId(target: JiraSyncTarget): string {
  return `sync-from-jira-${target}`;
}

export function SyncFromJiraButton({
  jiraIssueKey,
  target,
  ideaId,
  onSynced,
  testId,
}: SyncFromJiraButtonProps) {
  const { toast } = useToast();
  const mutation = useJiraSync(target);

  // The spec gates the button on a truthy `jiraIssueKey`. Phase 4
  // surfaces only show this when the row is already linked to a
  // Jira issue (e.g. it was pushed from ideation in Phase 1).
  if (!jiraIssueKey) return null;

  const handleClick = () => {
    if (mutation.isPending) return;
    mutation.reset();
    mutation.mutate(
      { issue_key: jiraIssueKey, idea_id: ideaId },
      {
        onSuccess: () => {
          toast({
            title: 'Synced from Jira',
            description: `Updated ${jiraIssueKey} on this ${target}.`,
            variant: 'default',
          });
          onSynced?.({ issue_key: jiraIssueKey, idea_id: ideaId, target });
        },
        onError: (err) => {
          toast({
            title: 'Sync failed',
            description: err instanceof Error ? err.message : 'Sync failed.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  if (mutation.isSuccess && mutation.data) {
    return (
      <span
        data-testid={`${syncFromJiraTestId(target)}-success`}
        data-idea-id={ideaId}
        data-issue-key={mutation.data.external_key}
        className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Synced · <span className="font-mono">{mutation.data.external_key}</span>
      </span>
    );
  }

  return (
    <div className="inline-flex flex-col items-start gap-2">
      <Button
        type="button"
        onClick={handleClick}
        disabled={mutation.isPending}
        aria-label={`Sync from Jira for ${target} ${ideaId}`}
        data-testid={testId ?? syncFromJiraTestId(target)}
        data-idea-id={ideaId}
        data-issue-key={jiraIssueKey}
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCw className="h-4 w-4" aria-hidden="true" />
        )}
        {mutation.isPending ? 'Syncing from Jira…' : 'Sync from Jira'}
      </Button>
      {mutation.isError ? (
        <div
          role="alert"
          data-testid={`${syncFromJiraTestId(target)}-error`}
          className="flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300"
        >
          <span className="flex-1">
            {mutation.error?.message ?? 'Sync failed.'}
          </span>
          <button
            type="button"
            onClick={handleClick}
            aria-label="Retry sync from Jira"
            className="rounded border border-rose-500/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider hover:bg-rose-500/20"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
