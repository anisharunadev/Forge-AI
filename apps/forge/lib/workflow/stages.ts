/**
 * apps/forge/lib/workflow/stages.ts — the 7 stages of Forge's golden
 * workflow (HoP reset, Sprint 1).
 *
 * Single source of truth for the progress bar + the home page card.
 * The dynamic route at app/workflow/[stage]/page.tsx reads this to
 * resolve the slug to a target page; each stage maps to an existing
 * center route so we don't duplicate screens in Sprint 1.
 *
 * Ponytail: pure data + helpers. No React, no JSX, server-importable.
 */

export type StageSlug =
  | 'idea'
  | 'prd'
  | 'architecture'
  | 'tasks'
  | 'approval'
  | 'develop'
  | 'pr';

export interface Stage {
  readonly slug: StageSlug;
  readonly label: string;
  readonly verb: string;          // action-oriented label
  readonly route: string;          // where the user actually lands
  readonly description: string;
}

export const STAGES: ReadonlyArray<Stage> = [
  {
    slug: 'idea',
    label: 'Idea',
    verb: 'Capture the idea',
    route: '/ideation',
    description: 'What problem are we solving?',
  },
  {
    slug: 'prd',
    label: 'PRD',
    verb: 'Generate the PRD',
    route: '/ideation?tab=prd',
    description: 'Requirements and acceptance criteria.',
  },
  {
    slug: 'architecture',
    label: 'Architecture',
    verb: 'Decide the architecture',
    route: '/architecture',
    description: 'ADRs, services, contracts.',
  },
  {
    slug: 'tasks',
    label: 'Tasks',
    verb: 'Break it into tasks',
    route: '/architecture?tab=tasks',
    description: 'Backlog with owners and estimates.',
  },
  {
    slug: 'approval',
    label: 'Approval',
    verb: 'Approve the plan',
    route: '/governance-center',
    description: 'Human-in-the-loop sign-off.',
  },
  {
    slug: 'develop',
    label: 'Develop',
    verb: 'Run AI development',
    route: '/runs',
    description: 'Agents + terminals, full audit trail.',
  },
  {
    slug: 'pr',
    label: 'Pull request',
    verb: 'Review the PR',
    route: '/audit',
    description: 'Diff, AI work summary, sign-off.',
  },
];

export const FIRST_STAGE: StageSlug = 'idea';
export const LAST_STAGE: StageSlug = 'pr';

export function getStage(slug: string): Stage | undefined {
  return STAGES.find((s) => s.slug === slug);
}

export function isValidStage(slug: unknown): slug is StageSlug {
  return (
    typeof slug === 'string' && STAGES.some((s) => s.slug === slug)
  );
}

export function stageIndex(slug: StageSlug): number {
  return STAGES.findIndex((s) => s.slug === slug);
}

/** Return the slug of the stage after `slug`, or undefined on the last stage. */
export function nextStage(slug: StageSlug): StageSlug | undefined {
  const idx = stageIndex(slug);
  if (idx < 0 || idx >= STAGES.length - 1) return undefined;
  return STAGES[idx + 1]?.slug;
}