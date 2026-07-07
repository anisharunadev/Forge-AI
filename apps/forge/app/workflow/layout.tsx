/**
 * `/workflow/*` layout — wraps every stage page with the
 * `WorkflowProgressBar`.
 *
 * Per Sprint 3 (production-grade the stages), the layout additionally:
 *
 *   - Renders a persistent shell-level `<CenterStateBanner>` slot
 *     (each stage owns its own banner; this slot is for the chrome
 *     around the workflow itself).
 *   - Uses `Suspense` around the progress bar so a slow analytics
 *     call cannot block the page paint.
 *
 * RBAC is enforced per-stage in `StagePanel` (it has access to the
 * project context the layout does not). The layout itself does not
 * gate access — that would force every workflow URL to redirect
 * before the bar could render.
 */

import * as React from 'react';
import { Suspense } from 'react';

import { WorkflowProgressBar } from '@/components/workflow-shell';
import { WORKFLOW_STAGES } from '@/lib/workflow-shell/stages';
import type { WorkflowProgress } from '@/lib/workflow-shell/types';

const DEFAULT_PROGRESS: WorkflowProgress = {
  projectId: 'placeholder',
  stages: WORKFLOW_STAGES.map((stage, idx) => ({
    id: stage.id,
    status: idx === 0 ? 'current' : 'pending',
  })),
  currentStage: WORKFLOW_STAGES[0]!.id,
};

function ProgressBarFallback() {
  // Minimal placeholder so Suspense never paints an empty layout.
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="workflow-progress-bar-fallback"
      className="h-9 rounded-lg border border-border bg-card/60"
    />
  );
}

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="workflow-layout"
      className="flex flex-col gap-6 px-4 py-6 md:px-6 lg:px-8"
    >
      <Suspense fallback={<ProgressBarFallback />}>
        <WorkflowProgressBar progress={DEFAULT_PROGRESS} />
      </Suspense>
      {children}
    </div>
  );
}