'use client';

import * as React from 'react';
import { Send, Loader2, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePushIdeaToJira } from '@/lib/hooks/usePushIdeaToJira';
import type { Idea } from '@/lib/ideation/data';
import type { JiraPushResult } from '@/lib/ideation/data';

export interface PushIdeaToJiraButtonProps {
  idea: Idea;
  onPushed?: (result: JiraPushResult) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Ideation Center entry point for "Push to Jira".
 *
 * Only renders when the idea is in a pushable state (`approved` or
 * `in_roadmap`). On success the button flips to a "Pushed" receipt
 * that exposes the real `epicKey` via `data-epic-key` (mirrors
 * `<PushToJiraButton>`). On error the button stays in place and an
 * inline error badge appears with a retry affordance.
 *
 * Mirrors `<PushToJiraButton>` (F-213) byte-for-byte where possible.
 */
export function PushIdeaToJiraButton({
  idea,
  onPushed,
  disabled,
  className,
}: PushIdeaToJiraButtonProps) {
  const mutation = usePushIdeaToJira(idea.id);

  React.useEffect(() => {
    if (mutation.isSuccess && mutation.data && onPushed) {
      onPushed(mutation.data);
    }
  }, [mutation.isSuccess, mutation.data, onPushed]);

  const handleClick = () => {
    if (disabled || mutation.isPending) return;
    mutation.reset();
    mutation.mutate();
  };

  // Status gate — the button is hidden for ideas that have not yet
  // been validated by a PM. Per the design doc, only `approved`
  // ideas are pushable today. Phase 2 will introduce an
  // `IdeaStatus = 'in_roadmap'` and the gate will widen at that
  // point.
  const pushable = idea.status === 'approved';
  if (!pushable) return null;

  if (mutation.isSuccess && mutation.data) {
    return (
      <span
        data-testid="push-idea-to-jira-success"
        data-epic-key={mutation.data.epicKey}
        className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Pushed · epic <span className="font-mono">{mutation.data.epicKey}</span>
      </span>
    );
  }

  return (
    <div className={className}>
      <Button
        type="button"
        onClick={handleClick}
        disabled={disabled || mutation.isPending}
        aria-label="Push idea to Jira"
        data-testid="push-idea-to-jira-button"
        data-idea-id={idea.id}
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="h-4 w-4" aria-hidden="true" />
        )}
        {mutation.isPending ? 'Pushing to Jira…' : 'Push to Jira'}
      </Button>
      {mutation.isError ? (
        <div
          role="alert"
          data-testid="push-idea-to-jira-error"
          className="mt-2 flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300"
        >
          <span className="flex-1">
            {mutation.error?.message ?? 'Push failed.'}
          </span>
          <button
            type="button"
            onClick={handleClick}
            aria-label="Retry push to Jira"
            className="rounded border border-rose-500/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider hover:bg-rose-500/20"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}