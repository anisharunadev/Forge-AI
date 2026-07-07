/**
 * Workflow stages — the canonical ordered list of phases in the
 * Forge golden workflow (Sprint 1, HoP reset).
 *
 * ponytail: Day 5 — created because workflow-progress-bar.tsx imports
 * `STAGES` and `StageSlug` from this path. The hook lives in
 * `use-workflow-state.ts`. Stages match the demo flow previously
 * shipped in the page; see commit `worktree-track-x-imports`.
 */
export type StageSlug =
  | 'spec'
  | 'design'
  | 'tasks'
  | 'implement'
  | 'review'
  | 'merge'
  | 'deploy';

export interface WorkflowStage {
  slug: StageSlug;
  label: string;
  href: string;
}

export const STAGES: ReadonlyArray<WorkflowStage> = [
  { slug: 'spec',      label: 'Spec',      href: '/workflow/spec' },
  { slug: 'design',    label: 'Design',    href: '/workflow/design' },
  { slug: 'tasks',     label: 'Tasks',     href: '/workflow/tasks' },
  { slug: 'implement', label: 'Implement', href: '/workflow/implement' },
  { slug: 'review',    label: 'Review',    href: '/workflow/review' },
  { slug: 'merge',     label: 'Merge',     href: '/workflow/merge' },
  { slug: 'deploy',    label: 'Deploy',    href: '/workflow/deploy' },
];
