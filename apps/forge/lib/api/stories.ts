/**
 * Stories REST API types — step-58.
 *
 * Typed mirror of the Pydantic schemas served by
 * `backend/app/api/v1/stories.py`, `sprints.py`, and `epics.py`.
 * The Pydantic schemas are the source of truth; if you change one
 * side, change the other.
 *
 * Skill rules adopted:
 *   - **Tenant scoping (Rule 2)** — every entity carries `tenant_id`
 *     and `project_id`. The backend reads `tenant_id` from the JWT
 *     and scopes every query to it.
 *   - **Typed artifacts (Rule 4)** — no free-form blobs; every shape
 *     here is a structured payload the UI can render directly.
 *   - **No `@fora/*` (v2.0 naming)** — types live in `lib/api/`.
 */

// ---------------------------------------------------------------------------
// Re-exports — keep parity with `lib/stories/types.ts` so consumers
// can import everything from a single path.
// ponytail: Day 5 — added re-exports for types that consumers imported
// from `@/lib/api/stories` before this file existed.
// ---------------------------------------------------------------------------
export type { Assignee } from '@/lib/stories/types';

// ---------------------------------------------------------------------------
// Story status — kanban column buckets
// ---------------------------------------------------------------------------

export type StoryStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'qa'
  | 'done'
  | 'blocked';

export type StoryPriority = 'P0' | 'P1' | 'P2' | 'P3';

export type StoryEstimate = 'XS' | 'S' | 'M' | 'L' | 'XL';

export type StorySource =
  | 'manual'
  | 'jira'
  | 'github'
  | 'linear'
  | 'ideation'
  | 'prd'
  | 'auto';

export type StoryJiraSyncStatus =
  | 'synced'
  | 'pending'
  | 'conflict'
  | 'failed'
  | 'disconnected';

// ---------------------------------------------------------------------------
// Embedded sub-records
// ---------------------------------------------------------------------------

export interface StoryAcceptanceCriterion {
  id: string;
  text: string;
  done: boolean;
}

export interface StorySubtask {
  id: string;
  title: string;
  done: boolean;
  estimate?: StoryEstimate;
}

export type StoryLinkedItemType =
  | 'prd'
  | 'adr'
  | 'idea'
  | 'epic'
  | 'run'
  | 'comment'
  | 'task'
  | 'subtask';

export interface StoryLinkedItem {
  type: StoryLinkedItemType;
  id: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Story — the canonical shape returned by `/stories/*` endpoints
// ---------------------------------------------------------------------------

export interface Story {
  id: string;
  tenant_id: string;
  project_id: string;
  epic_id?: string;
  sprint_id?: string;

  // Core
  title: string;
  description?: string;
  acceptance_criteria: StoryAcceptanceCriterion[];
  subtasks: StorySubtask[];

  // Metadata
  status: StoryStatus;
  priority: StoryPriority;
  estimate: StoryEstimate;
  labels: string[];
  assignee_id?: string;
  reporter_id: string;

  // Jira sync
  jira_key?: string;
  jira_url?: string;
  jira_synced_at?: string;
  jira_sync_status: StoryJiraSyncStatus;

  // Run integration
  active_run_id?: string;
  last_run_id?: string;
  run_count: number;

  // Source tracking
  source: StorySource;
  source_id?: string;

  // Audit
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;

  // Relationships (denormalized)
  linked_items: StoryLinkedItem[];
}

// ---------------------------------------------------------------------------
// Filters / inputs
// ---------------------------------------------------------------------------

export interface StoryFilter {
  project_id?: string;
  sprint_id?: string;
  status?: StoryStatus;
  priority?: StoryPriority;
  assignee_id?: string;
  label?: string;
  search?: string;
}

export interface StoryCreateInput {
  title: string;
  description?: string;
  acceptance_criteria?: StoryAcceptanceCriterion[];
  subtasks?: StorySubtask[];
  status?: StoryStatus;
  priority?: StoryPriority;
  estimate?: StoryEstimate;
  labels?: string[];
  assignee_id?: string;
  reporter_id?: string;
  epic_id?: string;
  sprint_id?: string;
  linked_items?: StoryLinkedItem[];
}

export interface StoryUpdateInput {
  title?: string;
  description?: string;
  status?: StoryStatus;
  priority?: StoryPriority;
  estimate?: StoryEstimate;
  labels?: string[];
  assignee_id?: string;
  epic_id?: string;
  sprint_id?: string;
  acceptance_criteria?: StoryAcceptanceCriterion[];
  subtasks?: StorySubtask[];
}

export interface StoryBulkUpdate {
  updates: { id: string; data: StoryUpdateInput }[];
}

export interface StoryLinkedRead {
  prds: { id: string; title: string }[];
  adrs: { id: string; title: string }[];
  ideas: { id: string; title: string }[];
  epics: { id: string; title: string }[];
  runs: { id: string; status: string; started_at: string }[];
}

// ---------------------------------------------------------------------------
// Sprint
// ---------------------------------------------------------------------------

export type SprintStatus = 'planning' | 'active' | 'completed';

export interface Sprint {
  id: string;
  tenant_id: string;
  project_id: string;
  name: string;
  goal?: string;
  start_date: string;
  end_date: string;
  status: SprintStatus;
  story_ids: string[];
  total_points: number;
  completed_points: number;
  created_at: string;
}

export interface SprintCreateInput {
  project_id: string;
  name: string;
  goal?: string;
  start_date: string;
  end_date: string;
}

// ---------------------------------------------------------------------------
// Epic
// ---------------------------------------------------------------------------

export type EpicStatus =
  | 'planning'
  | 'in_progress'
  | 'on_track'
  | 'at_risk'
  | 'blocked'
  | 'completed';

export interface Epic {
  id: string;
  tenant_id: string;
  project_id: string;
  title: string;
  description?: string;
  status: EpicStatus;
  start_date?: string;
  target_date?: string;
  progress: number;
  story_count: number;
  completed_story_count: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------

export interface Comment {
  id: string;
  tenant_id: string;
  story_id: string;
  author_id: string;
  author_name: string;
  author_avatar_url?: string;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at?: string;
}

export interface CommentCreateInput {
  body: string;
  mentions?: string[];
}

// ---------------------------------------------------------------------------
// Jira sync
// ---------------------------------------------------------------------------

export interface LinkToJiraInput {
  jira_key: string;
}

// ---------------------------------------------------------------------------
// Start implementation — returns a new terminal session descriptor
// ---------------------------------------------------------------------------

export interface StartImplementationResponse {
  story_id: string;
  run_id: string;
  session_id: string;
  context: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Query keys — centralized so any mutation can invalidate the right
// slice without string-typing itself into a corner.
// ---------------------------------------------------------------------------

export const storiesQueryKeys = {
  stories: {
    all: ['stories'] as const,
    list: (filter?: StoryFilter) =>
      [...storiesQueryKeys.stories.all, 'list', filter ?? {}] as const,
    detail: (id: string) =>
      [...storiesQueryKeys.stories.all, 'detail', id] as const,
    linked: (id: string) =>
      [...storiesQueryKeys.stories.all, 'detail', id, 'linked'] as const,
  },
  sprints: {
    all: ['sprints'] as const,
    list: (projectId?: string) =>
      [...storiesQueryKeys.sprints.all, 'list', projectId ?? 'all'] as const,
    current: (projectId: string) =>
      [...storiesQueryKeys.sprints.all, 'current', projectId] as const,
  },
  epics: {
    all: ['epics'] as const,
    list: (projectId?: string) =>
      [...storiesQueryKeys.epics.all, 'list', projectId ?? 'all'] as const,
  },
  comments: {
    all: ['story-comments'] as const,
    list: (storyId: string) =>
      [...storiesQueryKeys.comments.all, storyId] as const,
  },
};
