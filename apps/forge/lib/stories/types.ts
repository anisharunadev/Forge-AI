/**
 * Stories Center — typed contracts (Step 21).
 *
 * Single `Story` shape consumed by every view in the center
 * (kanban / list / timeline / drawer). Views are pure projections;
 * the data model is the canonical source.
 *
 * Cross-references:
 *  - docs/goals/step-21.md (scope of this file)
 *  - lib/intelligence/types.ts (parent typed-artifact world)
 *  - Rule 4 (CLAUDE.md) — typed artifacts only, no free-form blobs
 *
 * All fields are `readonly` end-to-end. IDs are stable strings. Dates
 * are ISO-8601 — the JSON wire format — never `Date` objects.
 */

export type StoryStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked';

export const STORY_STATUSES: ReadonlyArray<StoryStatus> = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
];

/** Extra status surfaced only when the user toggles "Show blocked"
 *  in view settings. Off by default per the spec. */
export const BLOCKED_STATUS: StoryStatus = 'blocked';

/** UI-friendly label for each status. Paired with a colored dot. */
export const STATUS_LABEL: Record<StoryStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
};

/** Tailwind/CSS-variable color tokens per status. The dot uses these. */
export const STATUS_DOT_VAR: Record<StoryStatus, string> = {
  backlog: 'var(--fg-muted)',
  todo: 'var(--accent-cyan)',
  in_progress: 'var(--accent-primary)',
  in_review: 'var(--accent-amber)',
  done: 'var(--accent-emerald)',
  blocked: 'var(--accent-rose)',
};

/** WIP limit per column. undefined = no limit. */
export const STATUS_WIP_LIMIT: Partial<Record<StoryStatus, number>> = {
  in_progress: 5,
  in_review: 5,
};

/** Columns rendered by default in the kanban (blocked is opt-in). */
export const DEFAULT_KANBAN_COLUMNS: ReadonlyArray<StoryStatus> = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
];

export type StoryPriority = 'P0' | 'P1' | 'P2' | 'P3';

export const PRIORITY_LABEL: Record<StoryPriority, string> = {
  P0: 'P0 · Critical',
  P1: 'P1 · High',
  P2: 'P2 · Medium',
  P3: 'P3 · Low',
};

/** Tailwind/CSS-variable color per priority. Rose for P0 etc. */
export const PRIORITY_DOT_VAR: Record<StoryPriority, string> = {
  P0: 'var(--accent-rose)',
  P1: 'var(--accent-amber)',
  P2: 'var(--accent-cyan)',
  P3: 'var(--fg-muted)',
};

export type Estimate = 'XS' | 'S' | 'M' | 'L' | 'XL';

export const ESTIMATE_POINTS: Record<Estimate, number> = {
  XS: 1,
  S: 2,
  M: 3,
  L: 5,
  XL: 8,
};

export type LabelKind = 'bug' | 'feature' | 'chore' | 'docs' | 'spike';

export const LABEL_LABEL: Record<LabelKind, string> = {
  bug: 'bug',
  feature: 'feature',
  chore: 'chore',
  docs: 'docs',
  spike: 'spike',
};

export const LABEL_DOT_VAR: Record<LabelKind, string> = {
  bug: 'var(--accent-rose)',
  feature: 'var(--accent-primary)',
  chore: 'var(--fg-muted)',
  docs: 'var(--accent-cyan)',
  spike: 'var(--accent-violet)',
};

export interface Assignee {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly online: boolean;
  readonly color: string;
}

export interface Sprint {
  readonly id: string;
  readonly name: string;
  readonly start: string;
  readonly end: string;
  readonly isCurrent: boolean;
  readonly goal?: string;
}

export interface Subtask {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface DefinitionOfDone {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
  readonly locked: boolean; // system items (code reviewed, tests pass) — not removable
}

export interface ActivityEvent {
  readonly id: string;
  readonly kind:
    | 'created'
    | 'status_changed'
    | 'assigned'
    | 'commented'
    | 'linked'
    | 'edited'
    | 'completed';
  readonly actor: Assignee;
  readonly at: string; // ISO
  readonly summary: string;
}

export interface Comment {
  readonly id: string;
  readonly author: Assignee;
  readonly body: string;
  readonly at: string;
}

export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly size: number; // bytes
  readonly mime: string;
}

export interface LinkedItem {
  readonly kind: 'epic' | 'story' | 'adr' | 'pr' | 'run';
  readonly id: string;
  readonly label: string;
  readonly href?: string;
}

/** Story — the canonical shape used by every view (kanban / list / timeline). */
export interface Story {
  readonly id: string;
  readonly identifier: string; // e.g. "S-123"
  readonly title: string;
  readonly status: StoryStatus;
  readonly priority: StoryPriority;
  readonly estimate: Estimate;
  readonly labels: ReadonlyArray<LabelKind>;
  readonly assignee: Assignee | null;
  readonly epicId: string | null;
  readonly sprintId: string | null;
  readonly description: string;
  readonly acceptanceCriteria: ReadonlyArray<AcceptanceCriterion>;
  readonly subtasks: ReadonlyArray<Subtask>;
  readonly definitionOfDone: ReadonlyArray<DefinitionOfDone>;
  readonly linkedItems: ReadonlyArray<LinkedItem>;
  readonly activity: ReadonlyArray<ActivityEvent>;
  readonly comments: ReadonlyArray<Comment>;
  readonly attachments: ReadonlyArray<Attachment>;
  readonly commentCount: number;
  readonly attachmentCount: number;
  readonly blocked: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** Optional absolute date used by the timeline view (start). */
  readonly startDate?: string;
  /** Optional absolute date used by the timeline view (end / due). */
  readonly endDate?: string;
}

export type StoryView = 'kanban' | 'list' | 'timeline';

export type StoryFilter = {
  readonly query: string;
  readonly assignees: ReadonlyArray<string>; // ids; empty = all
  readonly priorities: ReadonlyArray<StoryPriority>;
  readonly labels: ReadonlyArray<LabelKind>;
  readonly estimates: ReadonlyArray<Estimate>;
};

/** Bulk action — surfaced by the list view's floating action bar. */
export type BulkAction = 'assign' | 'move' | 'delete';