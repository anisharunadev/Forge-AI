/**
 * `/workflow/*` layout — wraps every stage page with the
 * `WorkflowProgressBar` so the spine is visible across the entire
 * golden workflow.
 *
 * The progress bar is rendered with an empty progress record by
 * default; individual stage pages may override it by passing real
 * data via the WorkflowProgressProvider (added in M17). For Sprint 1
 * (revised), the bar always shows the seven stages but progress
 * stays "pending" until each stage page wires up its own state.
 */

import * as React from 'react';

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

export default function WorkflowLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="workflow-layout"
      className="flex flex-col gap-6 px-4 py-6 md:px-6 lg:px-8"
    >
      <WorkflowProgressBar progress={DEFAULT_PROGRESS} />
      {children}
    </div>
  );
}