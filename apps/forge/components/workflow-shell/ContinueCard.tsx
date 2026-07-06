/**
 * ContinueCard — the primary CTA on the workflow home page.
 *
 * Shows the current stage + a single "Continue" button that deep-links
 * to the underlying center. Designed to live directly under the
 * WorkflowProgressBar.
 *
 * Why a single CTA? Because the audit identified that the previous
 * home page exposed nine different entry points and new users had no
 * idea which one to start with. The "Continue" button collapses that
 * choice down to one obvious next step.
 */

import * as React from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getStage } from '@/lib/workflow-shell/stages';
import type { WorkflowProgress } from '@/lib/workflow-shell/types';

export interface ContinueCardProps {
  readonly progress: WorkflowProgress;
  readonly className?: string;
}

export function ContinueCard({ progress, className }: ContinueCardProps) {
  const stage = getStage(progress.currentStage);
  const status = progress.stages.find((s) => s.id === progress.currentStage)?.status;
  const blockedReason = progress.stages.find((s) => s.id === progress.currentStage)
    ?.blockedReason;
  const isBlocked = status === 'blocked';
  const isDone = status === 'done';

  const headline = isDone
    ? 'All stages complete'
    : isBlocked
      ? 'Action required'
      : `Continue: ${stage.label}`;

  return (
    <Card
      data-testid="workflow-continue-card"
      className={cn(
        'border-border bg-card text-card-foreground',
        isBlocked ? 'border-rose-500/40' : isDone ? 'border-emerald-500/40' : '',
        className,
      )}
    >
      <CardHeader>
        <CardTitle className="text-lg">{headline}</CardTitle>
        <CardDescription>
          {isBlocked && blockedReason ? blockedReason : stage.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant={isBlocked ? 'destructive' : 'default'} size="lg">
          <Link
            href={stage.centerPath}
            data-testid="workflow-continue-cta"
            aria-label={`Continue to ${stage.label}`}
          >
            {isDone ? 'Review final PR' : `Open ${stage.label}`}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}