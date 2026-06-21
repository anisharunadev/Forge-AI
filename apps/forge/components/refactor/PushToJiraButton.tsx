'use client';

import * as React from 'react';
import { Send, Loader2, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePushMigrationPlanToJira } from '@/lib/hooks/useMigrationPlans';

export interface PushToJiraButtonProps {
  planId: string;
  disabled?: boolean;
  className?: string;
}

/**
 * F-213 entry point. Fires the `pushMigrationPlanToJira` mutation
 * (which the orchestrator eventually wires to a real Jira connector)
 * and shows the synthetic `epicKey` as a receipt so the operator has
 * something to share. While in flight the button is disabled and
 * renders a spinner; on success it flips to a "Pushed" confirmation.
 */
export function PushToJiraButton({ planId, disabled, className }: PushToJiraButtonProps) {
  const mutation = usePushMigrationPlanToJira(planId);

  const handleClick = () => {
    if (disabled || mutation.isPending) return;
    mutation.reset();
    mutation.mutate();
  };

  if (mutation.isSuccess && mutation.data) {
    return (
      <span
        data-testid="push-to-jira-success"
        data-epic-key={mutation.data.epicKey}
        className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Pushed · epic <span className="font-mono">{mutation.data.epicKey}</span>
        <span className="text-forge-300">({mutation.data.storyKeys.length} stories)</span>
      </span>
    );
  }

  return (
    <div className={className}>
      <Button
        type="button"
        onClick={handleClick}
        disabled={disabled || mutation.isPending}
        data-testid="push-to-jira-button"
        data-plan-id={planId}
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="h-4 w-4" aria-hidden="true" />
        )}
        {mutation.isPending ? 'Pushing to Jira…' : 'Push to Jira'}
      </Button>
      {mutation.isError ? (
        <p
          role="alert"
          data-testid="push-to-jira-error"
          className="mt-2 text-xs text-rose-300"
        >
          {mutation.error?.message ?? 'Push failed.'}
        </p>
      ) : null}
    </div>
  );
}