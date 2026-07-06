/**
 * `useWorkflowProgress` — client-side hook that derives workflow
 * progress from the same data the centers already query.
 *
 * We deliberately do NOT introduce a new /api/v1/workflow/progress
 * endpoint in this milestone. The progress bar is the spine of the
 * new home page, but the home page should keep working even before
 * the backend exposes a workflow aggregate. So this hook feeds the
 * existing center queries into `deriveProgress` and returns a typed
 * `WorkflowProgress` object.
 *
 * The hook is intentionally minimal: every input is a boolean that
 * defaults to false, so the bar degrades gracefully when the network
 * is down or the tenant has no project yet.
 */

'use client';

import { useMemo } from 'react';

import { deriveProgress, type ProgressInputs } from './progress';
import type { WorkflowProgress } from './types';

export interface UseWorkflowProgressArgs {
  readonly projectId: string;
  readonly hasIdeationBrief?: boolean;
  readonly hasPrd?: boolean;
  readonly hasArchitecture?: boolean;
  readonly hasTaskBreakdown?: boolean;
  readonly approvalStatus?: 'pending' | 'approved' | 'denied' | null;
  readonly hasActiveRun?: boolean;
  readonly hasOpenPr?: boolean;
}

export function useWorkflowProgress(args: UseWorkflowProgressArgs): WorkflowProgress {
  const { projectId, ...flags } = args;
  const inputs: ProgressInputs = useMemo(
    () => ({
      projectId,
      hasIdeationBrief: flags.hasIdeationBrief ?? false,
      hasPrd: flags.hasPrd ?? false,
      hasArchitecture: flags.hasArchitecture ?? false,
      hasTaskBreakdown: flags.hasTaskBreakdown ?? false,
      approvalStatus: flags.approvalStatus ?? null,
      hasActiveRun: flags.hasActiveRun ?? false,
      hasOpenPr: flags.hasOpenPr ?? false,
    }),
    [
      projectId,
      flags.hasIdeationBrief,
      flags.hasPrd,
      flags.hasArchitecture,
      flags.hasTaskBreakdown,
      flags.approvalStatus,
      flags.hasActiveRun,
      flags.hasOpenPr,
    ],
  );
  return useMemo(() => deriveProgress(inputs), [inputs]);
}