/**
 * WorkflowHome — the workflow-first replacement for the legacy
 * dashboard.
 *
 * Lays out:
 *   - WorkflowProgressBar at the top (the spine)
 *   - ContinueCard directly underneath (the primary CTA)
 *   - StartProjectCard + RecentActivityCard as a side grid
 *
 * This is the canonical "first thing a user sees" surface. It is a
 * client component because it composes `useWorkflowProgress`, but
 * the data inputs can also be passed in directly when the parent
 * already has them (e.g. a server component that fetches).
 */

'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { useWorkflowProgress } from '@/lib/workflow-shell/use-workflow-progress';
import type {
  WorkflowActivityItem,
  WorkflowProgress,
} from '@/lib/workflow-shell/types';

import { ContinueCard } from './ContinueCard';
import { RecentActivityCard } from './RecentActivityCard';
import { StartProjectCard } from './StartProjectCard';
import { WorkflowProgressBar } from './WorkflowProgressBar';

export interface WorkflowHomeProps {
  readonly projectId: string;
  readonly hasIdeationBrief?: boolean;
  readonly hasPrd?: boolean;
  readonly hasArchitecture?: boolean;
  readonly hasTaskBreakdown?: boolean;
  readonly approvalStatus?: 'pending' | 'approved' | 'denied' | null;
  readonly hasActiveRun?: boolean;
  readonly hasOpenPr?: boolean;
  readonly recentActivity?: ReadonlyArray<WorkflowActivityItem>;
  readonly className?: string;
}

export function WorkflowHome(props: WorkflowHomeProps) {
  const {
    projectId,
    recentActivity = [],
    className,
    ...flags
  } = props;
  const progress: WorkflowProgress = useWorkflowProgress({
    projectId,
    ...flags,
  });
  const hasActiveProject = flags.hasIdeationBrief === true;

  return (
    <div
      data-testid="workflow-home"
      className={cn('flex flex-col gap-6', className)}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Idea → Production, governed by Forge.
        </h1>
        <p className="text-sm text-muted-foreground">
          Seven stages from a product idea to a merged pull request.
          You are here:
          <span className="ml-1 font-medium text-foreground">
            {progress.currentStage}
          </span>
          .
        </p>
      </header>
      <WorkflowProgressBar progress={progress} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ContinueCard progress={progress} />
        </div>
        <StartProjectCard hasActiveProject={hasActiveProject} />
      </div>
      <RecentActivityCard items={recentActivity} />
    </div>
  );
}