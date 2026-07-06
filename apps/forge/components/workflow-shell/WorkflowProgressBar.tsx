/**
 * WorkflowProgressBar — the spine of the workflow shell.
 *
 * Renders all seven stages horizontally as chips with a connecting
 * line between them. Designed to live at the top of every
 * `/workflow/[stage]` page and on the home page.
 *
 * The bar is a pure presentational component: it takes a
 * `WorkflowProgress` and a `currentStage` and renders accordingly.
 * It does NOT fetch data — the page is responsible for supplying
 * the progress so the same bar can be rendered server-side or
 * client-side without duplicating logic.
 *
 * Accessibility:
 *   - The wrapping `<nav>` has aria-label "Workflow stages"
 *   - Each chip is an `<a>` (Link) with descriptive aria-label
 *   - The current stage uses ring styling and a data attribute
 *     so screen readers can announce "current"
 */

import * as React from 'react';

import { cn } from '@/lib/utils';
import { WORKFLOW_STAGES } from '@/lib/workflow-shell/stages';
import type { WorkflowProgress, WorkflowStageId } from '@/lib/workflow-shell/types';

import { StageChip } from './StageChip';

export interface WorkflowProgressBarProps {
  readonly progress: WorkflowProgress;
  /** Optional click handler (used in tests). */
  readonly onStageClick?: (id: WorkflowStageId) => void;
  readonly className?: string;
}

function indexOfStage(id: WorkflowStageId): number {
  return WORKFLOW_STAGES.findIndex((s) => s.id === id);
}

export function WorkflowProgressBar({
  progress,
  className,
}: WorkflowProgressBarProps) {
  const currentIdx = indexOfStage(progress.currentStage);

  return (
    <nav
      aria-label="Workflow stages"
      data-testid="workflow-progress-bar"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2',
        className,
      )}
    >
      {progress.stages.map((stage, idx) => {
        const isLast = idx === progress.stages.length - 1;
        const prevDone =
          idx === 0 ? true : progress.stages[idx - 1]?.status === 'done';
        const showConnector = !isLast;
        return (
          <React.Fragment key={stage.id}>
            <StageChip
              id={stage.id}
              status={stage.status}
              {...(stage.blockedReason !== undefined
                ? { blockedReason: stage.blockedReason }
                : {})}
            />
            {showConnector ? (
              <span
                aria-hidden="true"
                data-testid={`workflow-connector-${stage.id}`}
                className={cn(
                  'h-px flex-1 min-w-[12px] max-w-[40px]',
                  stage.status === 'done' || prevDone
                    ? 'bg-emerald-500/40'
                    : idx === currentIdx
                      ? 'bg-amber-400/40'
                      : 'bg-border',
                )}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </nav>
  );
}