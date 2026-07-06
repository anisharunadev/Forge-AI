/**
 * Pure progress derivation for the workflow shell.
 *
 * The progress bar is the spine of the new home page. It must work
 * even before the backend exposes a /workflow/progress endpoint —
 * which is why `deriveProgress` is a pure function that accepts the
 * inputs we already query from existing centers.
 *
 * Inputs:
 *   - `hasIdeationBrief`: does the active project have at least one
 *     ideation brief (idea stage)?
 *   - `hasPrd`: has a PRD been generated for that brief?
 *   - `hasArchitecture`: does the architecture center have at least
 *     one ADR?
 *   - `hasTaskBreakdown`: are there tasks for that architecture?
 *   - `approvalStatus`: 'pending' | 'approved' | 'denied' | null
 *   - `hasActiveRun`: is there a current run for this project?
 *   - `hasOpenPr`: is there a connected GitHub PR opened by Forge?
 *
 * The first non-done stage becomes `currentStage`. Anything missing
 * stays `pending`.
 *
 * This file is intentionally backend-agnostic: callers (server
 * components or `useWorkflowProgress`) feed it the booleans; it
 * returns a typed `WorkflowProgress` object.
 */

import { WORKFLOW_STAGES } from './stages';
import type {
  StageStatus,
  WorkflowProgress,
  WorkflowStageId,
  WorkflowStageProgress,
} from './types';

export interface ProgressInputs {
  readonly projectId: string;
  readonly hasIdeationBrief: boolean;
  readonly hasPrd: boolean;
  readonly hasArchitecture: boolean;
  readonly hasTaskBreakdown: boolean;
  readonly approvalStatus: 'pending' | 'approved' | 'denied' | null;
  readonly hasActiveRun: boolean;
  readonly hasOpenPr: boolean;
}

const STAGE_INPUTS: Readonly<
  Record<WorkflowStageId, (i: ProgressInputs) => { status: StageStatus; blockedReason?: string }>
> = {
  idea: (i) => ({ status: i.hasIdeationBrief ? 'done' : 'current' }),
  prd: (i) => {
    if (!i.hasIdeationBrief) return { status: 'pending' };
    return { status: i.hasPrd ? 'done' : 'current' };
  },
  architecture: (i) => {
    if (!i.hasIdeationBrief) return { status: 'pending' };
    if (!i.hasPrd) return { status: 'pending' };
    return { status: i.hasArchitecture ? 'done' : 'current' };
  },
  tasks: (i) => {
    if (!i.hasArchitecture) return { status: 'pending' };
    return { status: i.hasTaskBreakdown ? 'done' : 'current' };
  },
  approval: (i) => {
    if (!i.hasTaskBreakdown) return { status: 'pending' };
    if (i.approvalStatus === 'approved') return { status: 'done' };
    if (i.approvalStatus === 'denied') {
      return { status: 'blocked', blockedReason: 'Plan denied — revise tasks or architecture.' };
    }
    return { status: 'current' };
  },
  develop: (i) => {
    if (i.approvalStatus !== 'approved') return { status: 'pending' };
    // Once a PR is open the develop stage is complete — the user is
    // reviewing/merging, not developing.
    if (i.hasOpenPr) return { status: 'done' };
    return { status: i.hasActiveRun ? 'current' : 'pending' };
  },
  pr: (i) => {
    if (!i.hasActiveRun && !i.hasOpenPr) return { status: 'pending' };
    return { status: i.hasOpenPr ? 'done' : 'current' };
  },
};

/**
 * Pure derivation. Returns the per-stage progress and the first
 * non-done stage as `currentStage`. If every stage is done, returns
 * the final stage as current.
 */
export function deriveProgress(inputs: ProgressInputs): WorkflowProgress {
  const stageProgress: WorkflowStageProgress[] = WORKFLOW_STAGES.map((stage) => {
    const result = STAGE_INPUTS[stage.id](inputs);
    return {
      id: stage.id,
      status: result.status,
      ...(result.blockedReason !== undefined
        ? { blockedReason: result.blockedReason }
        : {}),
    };
  });

  const firstNotDone = stageProgress.find(
    (s) => s.status === 'current' || s.status === 'blocked',
  );
  const currentStage: WorkflowStageId = firstNotDone?.id ?? WORKFLOW_STAGES[WORKFLOW_STAGES.length - 1]!.id;

  return {
    projectId: inputs.projectId,
    stages: stageProgress,
    currentStage,
  };
}

/**
 * A safe default for first-run users (no project yet). Returns a
 * progress record where stage 0 is current and the rest are pending.
 */
export function emptyProgress(projectId: string): WorkflowProgress {
  return deriveProgress({
    projectId,
    hasIdeationBrief: false,
    hasPrd: false,
    hasArchitecture: false,
    hasTaskBreakdown: false,
    approvalStatus: null,
    hasActiveRun: false,
    hasOpenPr: false,
  });
}