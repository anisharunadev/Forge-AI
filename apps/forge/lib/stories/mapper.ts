/**
 * Story API → UI mapper (step-58).
 *
 * The REST API returns a flat `Story` (Rule 4 — typed artifacts):
 *   - assignee as `assignee_id` string
 *   - `jira_key` instead of a Jira link
 *   - no `commentCount` / `activity` denormalized
 *
 * The existing UI components (`KanbanBoard`, `StoryCard`, `StoryDrawer`)
 * expect a richer view-model:
 *   - `assignee` as an `Assignee` object (with name, color, initials)
 *   - `identifier` (e.g. "S-101") separate from `id`
 *   - `commentCount`, `attachmentCount`
 *   - `activity` events for the History tab
 *
 * This mapper bridges the two so the existing components keep working
 * unchanged while the data layer is the real backend.
 *
 * Skill rules adopted:
 *   - **Tenant scoping (Rule 2)** — mapper is pure: no fetches, no
 *     side effects. Caller is responsible for providing all data.
 *   - **Typed artifacts (Rule 4)** — input and output are typed.
 */

import type { Story as ApiStory } from '@/lib/api/stories';
import type {
  AcceptanceCriterion,
  ActivityEvent,
  Assignee,
  Comment,
  DefinitionOfDone,
  LinkedItem,
  Story,
  StoryPriority,
  StoryStatus,
  Subtask,
} from '@/lib/stories/types';
import { ESTIMATE_POINTS } from '@/lib/stories/types';

const PRIORITY_LABELS: ReadonlyArray<StoryPriority> = ['P0', 'P1', 'P2', 'P3'];

const STATUS_LABELS: ReadonlyArray<StoryStatus> = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'qa',
  'done',
  'blocked',
];

function asPriority(value: string): StoryPriority {
  return (PRIORITY_LABELS as ReadonlyArray<string>).includes(value)
    ? (value as StoryPriority)
    : 'P2';
}

function asStatus(value: string): StoryStatus {
  return (STATUS_LABELS as ReadonlyArray<string>).includes(value)
    ? (value as StoryStatus)
    : 'todo';
}

function asEstimate(value: string): keyof typeof ESTIMATE_POINTS {
  if (value in ESTIMATE_POINTS) return value as keyof typeof ESTIMATE_POINTS;
  return 'M';
}

function deriveIdentifier(id: string, fallback: string): string {
  // The backend may already return an `identifier` (e.g. S-101). If it
  // does, use that. Otherwise we derive a short readable token from the
  // UUID so the UI never shows raw UUIDs to users.
  if (fallback && fallback !== id) return fallback;
  return `S-${id.slice(0, 4).toUpperCase()}`;
}

export interface MapOptions {
  /** User lookup map. Keys: user IDs. */
  readonly users?: ReadonlyMap<string, Assignee>;
  /** Comments keyed by story id. */
  readonly commentsByStory?: ReadonlyMap<string, ReadonlyArray<Comment>>;
  /** Project default reporter (the current user) for activity events. */
  readonly reporter?: Assignee;
}

/**
 * Convert one API Story to the UI view-model. Pure function — the
 * caller is responsible for all data fetches.
 */
export function apiStoryToUiStory(
  api: ApiStory,
  options: MapOptions = {},
): Story {
  const users = options.users ?? new Map<string, Assignee>();
  const comments = options.commentsByStory?.get(api.id) ?? [];
  const assignee = api.assignee_id ? users.get(api.assignee_id) ?? null : null;
  const reporter = options.reporter ?? null;

  const acceptanceCriteria: AcceptanceCriterion[] = api.acceptance_criteria.map(
    (c) => ({ id: c.id, text: c.text, done: c.done }),
  );
  const subtasks: Subtask[] = api.subtasks.map((s) => ({
    id: s.id,
    title: s.title,
    done: s.done,
  }));

  // Linked items — convert API linked_items to the UI's LinkedItem shape.
  const linkedItems: LinkedItem[] = api.linked_items
    .filter((i) =>
      ['prd', 'adr', 'idea', 'epic', 'run', 'comment', 'task', 'subtask'].includes(
        i.type,
      ),
    )
    .map((i) => ({
      // UI uses singular kinds; map API types to the closest.
      kind: (
        {
          prd: 'pr' as const,
          adr: 'adr' as const,
          idea: 'story' as const,
          epic: 'epic' as const,
          run: 'run' as const,
          comment: 'story' as const,
          task: 'run' as const,
          subtask: 'story' as const,
        } as const
      )[i.type] ?? 'story',
      id: i.id,
      label: i.title,
    }));

  // Synthesise a minimal activity trail from the timestamps we have.
  const activity: ActivityEvent[] = [];
  if (reporter) {
    activity.push({
      id: `${api.id}-created`,
      kind: 'created',
      actor: reporter,
      at: api.created_at,
      summary: `Created story ${api.title}`,
    });
    if (api.started_at) {
      activity.push({
        id: `${api.id}-started`,
        kind: 'status_changed',
        actor: reporter,
        at: api.started_at,
        summary: 'Moved to In Progress',
      });
    }
    if (api.completed_at) {
      activity.push({
        id: `${api.id}-completed`,
        kind: 'completed',
        actor: reporter,
        at: api.completed_at,
        summary: 'Marked Done',
      });
    }
    activity.push({
      id: `${api.id}-updated`,
      kind: 'edited',
      actor: reporter,
      at: api.updated_at,
      summary: 'Updated',
    });
  }

  // Definition of Done — system items derived from status.
  const definitionOfDone: DefinitionOfDone[] = [
    {
      id: 'dod-code-reviewed',
      label: 'Code reviewed',
      done: api.status === 'done' || api.status === 'qa',
      locked: true,
    },
    {
      id: 'dod-tests-pass',
      label: 'Tests pass',
      done: api.status === 'done' || api.status === 'qa',
      locked: true,
    },
    {
      id: 'dod-docs',
      label: 'Documentation updated',
      done: api.status === 'done',
      locked: true,
    },
    {
      id: 'dod-deploy',
      label: 'Deployed',
      done: api.status === 'done',
      locked: true,
    },
  ];

  return {
    id: api.id,
    identifier: deriveIdentifier(api.id, api.jira_key ?? ''),
    title: api.title,
    status: asStatus(api.status),
    priority: asPriority(api.priority),
    estimate: asEstimate(api.estimate),
    labels: api.labels
      .map((l) => l.toLowerCase())
      .filter((l): l is 'bug' | 'feature' | 'chore' | 'docs' | 'spike' =>
        ['bug', 'feature', 'chore', 'docs', 'spike'].includes(l),
      ) as Story['labels'],
    assignee,
    epicId: api.epic_id ?? null,
    sprintId: api.sprint_id ?? null,
    description: api.description ?? '',
    acceptanceCriteria,
    subtasks,
    definitionOfDone,
    linkedItems,
    activity,
    comments: [...comments],
    attachments: [],
    commentCount: comments.length,
    attachmentCount: 0,
    blocked: api.status === 'blocked',
    createdAt: api.created_at,
    updatedAt: api.updated_at,
    startedAt: api.started_at ?? null,
    completedAt: api.completed_at ?? null,
  };
}

/**
 * Bulk mapper — used by the Stories page to project the API array into
 * the UI shape. Accepts pre-fetched comments and a user lookup so we
 * don't fetch N+1.
 */
export function apiStoriesToUiStories(
  stories: ReadonlyArray<ApiStory>,
  options: MapOptions = {},
): ReadonlyArray<Story> {
  return stories.map((s) => apiStoryToUiStory(s, options));
}
