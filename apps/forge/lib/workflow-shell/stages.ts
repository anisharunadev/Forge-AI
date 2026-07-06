/**
 * The seven workflow stages of Forge AI's golden workflow.
 *
 * Idea → PRD → Architecture → Tasks → Approval → Develop → PR.
 *
 * Each stage `centerPath` is the deep-link inside the underlying
 * center that powers that stage. The home page (and the progress
 * bar) route users through these stages in order; power users can
 * still navigate to /centers/{ideation,architecture,runs,...}
 * directly via the legacy sidebar.
 *
 * When adding a stage: append to `STAGES`, update the home page's
 * progress bar layout (it expects exactly 7 chips), and update
 * `deriveProgress` in `progress.ts` to recognize the new state
 * source.
 */

import type { WorkflowStageDefinition, WorkflowStageId } from './types';

export const WORKFLOW_STAGES: ReadonlyArray<WorkflowStageDefinition> = [
  {
    id: 'idea',
    label: 'Idea',
    shortLabel: 'Idea',
    centerPath: '/ideation',
    analyticsKey: 'ideation.created',
    description:
      'Capture your product idea as a structured brief that downstream stages can build on.',
  },
  {
    id: 'prd',
    label: 'PRD',
    shortLabel: 'PRD',
    centerPath: '/ideation?tab=prd',
    analyticsKey: 'prd.generated',
    description:
      'Turn the idea into a requirements document that engineering and stakeholders can review.',
  },
  {
    id: 'architecture',
    label: 'Architecture',
    shortLabel: 'Arch',
    centerPath: '/architecture',
    analyticsKey: 'architecture.generated',
    description:
      'Generate ADRs, API contracts, and a risk register for the system you are about to build.',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    shortLabel: 'Tasks',
    centerPath: '/architecture?tab=tasks',
    analyticsKey: 'tasks.generated',
    description:
      'Break the architecture into executable tasks with estimates, dependencies, and acceptance criteria.',
  },
  {
    id: 'approval',
    label: 'Approval',
    shortLabel: 'Approve',
    centerPath: '/governance',
    analyticsKey: 'phase.approved',
    description:
      'Review the artifacts, request changes, or approve the plan to enter AI development.',
  },
  {
    id: 'develop',
    label: 'AI Development',
    shortLabel: 'Develop',
    centerPath: '/runs',
    analyticsKey: 'run.started',
    description:
      'Forge agents execute the approved tasks against your connected repository, with live audit trails.',
  },
  {
    id: 'pr',
    label: 'Pull Request',
    shortLabel: 'PR',
    centerPath: '/connector-center?tab=pulls',
    analyticsKey: 'pr.opened',
    description:
      'Review the generated pull request and merge it. Your idea is now in production.',
  },
] as const;

/** Map stage id → definition; useful in components that resolve by id. */
export const STAGES_BY_ID: Readonly<Record<WorkflowStageId, WorkflowStageDefinition>> =
  WORKFLOW_STAGES.reduce(
    (acc, stage) => {
      acc[stage.id] = stage;
      return acc;
    },
    {} as Record<WorkflowStageId, WorkflowStageDefinition>,
  );

/** Resolve a stage by id, falling back to the first stage if unknown. */
export function getStage(id: WorkflowStageId): WorkflowStageDefinition {
  return STAGES_BY_ID[id] ?? WORKFLOW_STAGES[0];
}

/** Return the stage immediately following the given stage, if any. */
export function getNextStage(id: WorkflowStageId): WorkflowStageDefinition | null {
  const idx = WORKFLOW_STAGES.findIndex((s) => s.id === id);
  if (idx < 0 || idx >= WORKFLOW_STAGES.length - 1) return null;
  return WORKFLOW_STAGES[idx + 1] ?? null;
}

/** All stage ids in canonical order — useful for analytics funnels. */
export const WORKFLOW_STAGE_IDS: ReadonlyArray<WorkflowStageId> =
  WORKFLOW_STAGES.map((s) => s.id);