# step-58

> **Status:** completed
> **Last classified:** 2026-07-05

/goal


Wire the Stories page to the real backend — Stories only (Project Intelligence is a separate phase). Replace all dummy data with real API calls. Build on Phase 1 (auth) + Phase 2 (React Query) + Phase 5 (Dashboard). Read .claude/design-system/ first.


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "kanban drag drop @dnd-kit virtualized columns" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "story management acceptance criteria subtasks sprint" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "Jira bidirectional sync story status webhook" --domain ux-guideline -f markdown


Adopt every rule. Then build:


==========================================================

ZONE 1 — TYPE DEFINITIONS

==========================================================


Add to src/lib/api/types.ts:


```typescript

// STORIES

export type StoryStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done' | 'blocked';

export type StoryPriority = 'P0' | 'P1' | 'P2' | 'P3';

export type StoryEstimate = 'XS' | 'S' | 'M' | 'L' | 'XL';


export interface Story {

  id: string;

  tenant_id: string;

  project_id: string;

  epic_id?: string;

  sprint_id?: string;

  

  // Core fields

  title: string;

  description?: string;             // markdown

  acceptance_criteria: { id: string; text: string; done: boolean }[];

  subtasks: { id: string; title: string; done: boolean; estimate?: StoryEstimate }[];

  

  // Metadata

  status: StoryStatus;

  priority: StoryPriority;

  estimate: StoryEstimate;

  labels: string[];

  assignee_id?: string;

  reporter_id: string;

  

  // Jira sync

  jira_key?: string;                // e.g., "ACME-123"

  jira_url?: string;

  jira_synced_at?: string;

  jira_sync_status: 'synced' | 'pending' | 'conflict' | 'failed' | 'disconnected';

  

  // Run integration

  active_run_id?: string;

  last_run_id?: string;

  run_count: number;

  

  // Source tracking

  source: 'manual' | 'jira' | 'github' | 'linear' | 'ideation' | 'prd' | 'auto';

  source_id?: string;

  

  // Audit

  created_at: string;

  updated_at: string;

  started_at?: string;              // when moved to in_progress

  completed_at?: string;            // when moved to done

  

  // Relationships (denormalized for display)

  linked_items: {

    type: 'prd' | 'adr' | 'idea' | 'epic' | 'run' | 'comment' | 'task' | 'subtask';

    id: string;

    title: string;

  }[];

}


export interface Sprint {

  id: string;

  tenant_id: string;

  project_id: string;

  name: string;

  goal?: string;

  start_date: string;

  end_date: string;

  status: 'planning' | 'active' | 'completed';

  story_ids: string[];

  total_points: number;

  completed_points: number;

  created_at: string;

}


export interface Epic {

  id: string;

  tenant_id: string;

  project_id: string;

  title: string;

  description?: string;

  status: 'planning' | 'in_progress' | 'on_track' | 'at_risk' | 'blocked' | 'completed';

  start_date?: string;

  target_date?: string;

  progress: number;                  // 0-100

  story_count: number;

  completed_story_count: number;

  created_at: string;

}


export interface Comment {

  id: string;

  tenant_id: string;

  story_id: string;

  author_id: string;

  author_name: string;

  author_avatar_url?: string;

  body: string;                      // markdown

  mentions: string[];                // user IDs

  created_at: string;

  edited_at?: string;

}


// Query keys

export const queryKeys = {

  stories: {

    all: ['stories'] as const,

    list: (filter?: any) => [...queryKeys.stories.all, 'list', filter] as const,

    detail: (id: string) => [...queryKeys.stories.all, 'detail', id] as const,

    linked: (id: string) => [...queryKeys.stories.all, 'detail', id, 'linked'] as const,

  },

  sprints: {

    all: ['sprints'] as const,

    list: (projectId?: string) => [...queryKeys.sprints.all, projectId || 'all'] as const,

    current: (projectId: string) => [...queryKeys.sprints.all, 'current', projectId] as const,

  },

  epics: {

    all: ['epics'] as const,

    list: (projectId?: string) => [...queryKeys.epics.all, projectId || 'all'] as const,

  },

};
========================================================== ZONE 2 — REACT QUERY HOOKS (Stories only)
Add to src/lib/query/hooks.ts:

typescript

Copy
// STORIES

export function useStories(filter?: {

  project_id?: string;

  sprint_id?: string;

  status?: StoryStatus;

  priority?: StoryPriority;

  assignee_id?: string;

  label?: string;

  search?: string;

}) {

  return useQuery({

    queryKey: queryKeys.stories.list(filter),

    queryFn: () => {

      const params = new URLSearchParams();

      Object.entries(filter || {}).forEach(([k, v]) => {

        if (v !== undefined && v !== null) params.set(k, String(v));

      });

      return api.get<Story[]>(`/stories?${params}`);

    },

  });

}


export function useStory(id: string) {

  return useQuery({

    queryKey: queryKeys.stories.detail(id),

    queryFn: () => api.get<Story>(`/stories/${id}`),

    enabled: !!id,

  });

}


export function useStoryLinkedItems(id: string) {

  return useQuery({

    queryKey: queryKeys.stories.linked(id),

    queryFn: () => api.get<{

      prds: { id: string; title: string }[];

      adrs: { id: string; title: string }[];

      ideas: { id: string; title: string }[];

      epics: { id: string; title: string }[];

      runs: { id: string; status: string; started_at: string }[];

    }>(`/stories/${id}/linked`),

    enabled: !!id,

  });

}


export function useCreateStory() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<Story>) => api.post<Story>('/stories', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.stories.all }),

  });

}


export function useUpdateStory() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, ...data }: Partial<Story> & { id: string }) =>

      api.patch<Story>(`/stories/${id}`, data),

    onSuccess: (_, { id }) => {

      qc.invalidateQueries({ queryKey: queryKeys.stories.all });

      qc.invalidateQueries({ queryKey: queryKeys.stories.detail(id) });

    },

  });

}


export function useUpdateStoryStatus() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, status }: { id: string; status: StoryStatus }) =>

      api.patch<Story>(`/stories/${id}`, { status }),

    // Optimistic update for drag-drop UX

    onMutate: async ({ id, status }) => {

      await qc.cancelQueries({ queryKey: queryKeys.stories.all });

      const previous = qc.getQueriesData<Story[]>({ queryKey: queryKeys.stories.all });

      previous.forEach(([key, stories]) => {

        if (stories) {

          qc.setQueryData<Story[]>(key, stories.map(s => 

            s.id === id ? { ...s, status } : s

          ));

        }

      });

      return { previous };

    },

    onError: (err, vars, context) => {

      context?.previous.forEach(([key, data]: [any, any]) => {

        qc.setQueryData(key, data);

      });

      toast.error('Failed to update status');

    },

    onSettled: () => {

      qc.invalidateQueries({ queryKey: queryKeys.stories.all });

    },

  });

}


export function useDeleteStory() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.delete(`/stories/${id}`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.stories.all }),

  });

}


export function useBulkUpdateStories() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (updates: { id: string; data: Partial<Story> }[]) =>

      api.patch('/stories/bulk', { updates }),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.stories.all }),

  });

}


// SPRINTS

export function useSprints(projectId?: string) {

  return useQuery({

    queryKey: queryKeys.sprints.list(projectId),

    queryFn: () => api.get<Sprint[]>(projectId ? `/sprints?project_id=${projectId}` : '/sprints'),

  });

}


export function useCurrentSprint(projectId: string) {

  return useQuery({

    queryKey: queryKeys.sprints.current(projectId),

    queryFn: () => api.get<Sprint>(`/sprints/current?project_id=${projectId}`),

    enabled: !!projectId,

  });

}


export function useStartSprint() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post<Sprint>(`/sprints/${id}/start`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sprints.all }),

  });

}


// EPICS

export function useEpics(projectId?: string) {

  return useQuery({

    queryKey: queryKeys.epics.list(projectId),

    queryFn: () => api.get<Epic[]>(projectId ? `/epics?project_id=${projectId}` : '/epics'),

  });

}


// COMMENTS

export function useStoryComments(storyId: string) {

  return useQuery({

    queryKey: ['story-comments', storyId],

    queryFn: () => api.get<Comment[]>(`/stories/${storyId}/comments`),

    enabled: !!storyId,

  });

}


export function useAddComment() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ storyId, body, mentions }: { storyId: string; body: string; mentions?: string[] }) =>

      api.post<Comment>(`/stories/${storyId}/comments`, { body, mentions }),

    onSuccess: (_, { storyId }) => {

      qc.invalidateQueries({ queryKey: ['story-comments', storyId] });

    },

  });

}


// JIRA SYNC

export function useSyncToJira() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (storyId: string) => api.post<Story>(`/stories/${storyId}/sync-jira`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.stories.all }),

  });

}


export function useLinkToJira() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ storyId, jiraKey }: { storyId: string; jiraKey: string }) =>

      api.post<Story>(`/stories/${storyId}/link-jira`, { jira_key: jiraKey }),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.stories.all }),

  });

}
========================================================== ZONE 3 — STORIES PAGE (4 views)
In src/app/(workspace)/stories/page.tsx:

typescript

Copy
'use client';

import { useState, useMemo } from 'react';

import { useStories, useCurrentSprint, useSprints } from '@/lib/query/hooks';


export default function StoriesPage() {

  const [view, setView] = useState<'kanban' | 'list' | 'timeline' | 'lifecycle'>('kanban');

  const [search, setSearch] = useState('');

  const [sprintId, setSprintId] = useState<string | null>('current');

  const [priorityFilter, setPriorityFilter] = useState<StoryPriority | null>(null);

  const [labelFilter, setLabelFilter] = useState<string | null>(null);

  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);

  const [showBlocked, setShowBlocked] = useState(false);

  

  // Real data hooks

  const { data: stories, isLoading } = useStories({

    sprint_id: sprintId === 'current' ? undefined : sprintId,

    search,

    priority: priorityFilter || undefined,

    label: labelFilter || undefined,

    assignee_id: assigneeFilter || undefined,

  });

  const { data: sprints } = useSprints();

  const { data: currentSprint } = useCurrentSprint(useAuth().tenant?.default_project_id || '');

  

  // KPI cards (real numbers)

  const kpis = useMemo(() => {

    if (!stories || !currentSprint) return null;

    const sprintStories = stories.filter(s => s.sprint_id === currentSprint.id);

    return {

      totalInSprint: sprintStories.length,

      backlog: stories.filter(s => s.status === 'backlog').length,

      inProgress: stories.filter(s => s.status === 'in_progress').length,

      inReview: stories.filter(s => s.status === 'in_review' || s.status === 'qa').length,

      done: stories.filter(s => s.status === 'done' && s.sprint_id === currentSprint.id).length,

    };

  }, [stories, currentSprint]);

  

  if (isLoading) return <FullPageSpinner />;

  

  return (

    <div>

      <HeroBand

        title="Stories"

        description="Every user story across this project. Drag cards across columns to update status. Keyboard pickup is Space, arrow keys move, Space drops, Esc cancels."

        action={<SprintPicker sprints={sprints} value={sprintId} onChange={setSprintId} />}

        rightSlot={

          <div className="flex items-center gap-2">

            <Button variant="ghost" onClick={() => setView('kanban')} active={view === 'kanban'}>

              <LayoutGrid /> Kanban

            </Button>

            <Button variant="ghost" onClick={() => setView('list')} active={view === 'list'}>

              <List /> List

            </Button>

            <Button variant="ghost" onClick={() => setView('timeline')} active={view === 'timeline'}>

              <Calendar /> Timeline

            </Button>

            <Button variant="ghost" onClick={() => setView('lifecycle')} active={view === 'lifecycle'}>

              <GitBranch /> Lifecycle

            </Button>

            <Button variant="ghost"><Zap /> Quick actions</Button>

            <Button onClick={() => setNewStoryOpen(true)}><Plus /> New story</Button>

          </div>

        }

      />

      

      {kpis && <KPICards kpis={kpis} />}

      

      <FilterBar

        search={search}

        onSearchChange={setSearch}

        priority={priorityFilter}

        onPriorityChange={setPriorityFilter}

        label={labelFilter}

        onLabelChange={setLabelFilter}

        assignee={assigneeFilter}

        onAssigneeChange={setAssigneeFilter}

        showBlocked={showBlocked}

        onShowBlockedChange={setShowBlocked}

      />

      

      {view === 'kanban' && (

        <KanbanBoard

          stories={stories || []}

          onStatusChange={(id, status) => useUpdateStoryStatus().mutate({ id, status })}

        />

      )}

      {view === 'list' && (

        <StoryList

          stories={stories || []}

          onOpen={(id) => setSelectedStoryId(id)}

        />

      )}

      {view === 'timeline' && (

        <TimelineView stories={stories || []} sprint={currentSprint} />

      )}

      {view === 'lifecycle' && (

        <LifecycleView stories={stories || []} />

      )}

      

      {newStoryOpen && (

        <NewStoryDialog onClose={() => setNewStoryOpen(false)} />

      )}

      

      {selectedStoryId && (

        <StoryDetailDrawer

          storyId={selectedStoryId}

          onClose={() => setSelectedStoryId(null)}

        />

      )}

    </div>

  );

}
========================================================== ZONE 4 — KANBAN BOARD (drag-drop)
In src/components/stories/kanban-board.tsx:

typescript

Copy
'use client';

import { DndContext, DragOverlay, closestCorners, useSensor, useSensors, PointerSensor, KeyboardSensor } from '@dnd-kit/core';

import { SortableContext, useSortable, arrayMove } from '@dnd-kit/sortable';

import { useUpdateStoryStatus } from '@/lib/query/hooks';


const COLUMNS: { id: StoryStatus; label: string; color: string }[] = [

  { id: 'backlog', label: 'Backlog', color: 'muted' },

  { id: 'todo', label: 'To Do', color: 'cyan' },

  { id: 'in_progress', label: 'In Progress', color: 'indigo' },

  { id: 'in_review', label: 'In Review', color: 'amber' },

  { id: 'qa', label: 'QA', color: 'amber' },

  { id: 'done', label: 'Done', color: 'emerald' },

];


export function KanbanBoard({ stories, onStatusChange }: KanbanBoardProps) {

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  const [activeStory, setActiveStory] = useState<Story | null>(null);

  

  // Group by status

  const byStatus = useMemo(() => {

    const map: Record<StoryStatus, Story[]> = {} as any;

    COLUMNS.forEach(c => map[c.id] = []);

    stories.forEach(s => { if (map[s.status]) map[s.status].push(s); });

    return map;

  }, [stories]);

  

  function handleDragEnd(event: any) {

    const { active, over } = event;

    if (!over) return;

    

    const storyId = active.id;

    const newStatus = over.id as StoryStatus;

    

    if (COLUMNS.find(c => c.id === newStatus)) {

      onStatusChange(storyId, newStatus);

    }

    setActiveStory(null);

  }

  

  return (

    <DndContext

      sensors={sensors}

      collisionDetection={closestCorners}

      onDragStart={(e) => setActiveStory(stories.find(s => s.id === e.active.id) || null)}

      onDragEnd={handleDragEnd}

    >

      <div className="grid grid-cols-6 gap-3 min-h-[600px]">

        {COLUMNS.map(col => (

          <KanbanColumn

            key={col.id}

            column={col}

            stories={byStatus[col.id] || []}

            totalPoints={byStatus[col.id]?.reduce((sum, s) => sum + estimatePoints(s.estimate), 0) || 0}

          />

        ))}

      </div>

      <DragOverlay>

        {activeStory && <StoryCard story={activeStory} dragging />}

      </DragOverlay>

    </DndContext>

  );

}


function KanbanColumn({ column, stories, totalPoints }: KanbanColumnProps) {

  return (

    <div className="flex flex-col bg-base rounded-lg p-2">

      <ColumnHeader

        title={column.label}

        count={stories.length}

        points={totalPoints}

        color={column.color}

      />

      <SortableContext items={stories.map(s => s.id)} strategy={verticalListSortingStrategy}>

        <div className="flex-1 space-y-2 p-1 min-h-[100px]">

          {stories.map(story => (

            <DraggableStoryCard key={story.id} story={story} />

          ))}

        </div>

      </SortableContext>

    </div>

  );

}
========================================================== ZONE 5 — STORY CARD (with real data)
In src/components/stories/story-card.tsx:

typescript

Copy
function StoryCard({ story, onOpen, onUpdateStatus, dragging }: StoryCardProps) {

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: story.id });

  

  const style = {

    transform: CSS.Transform.toString(transform),

    transition,

    opacity: isDragging ? 0.4 : 1,

  };

  

  return (

    <div

      ref={setNodeRef}

      style={style}

      {...attributes}

      {...listeners}

      onClick={(e) => {

        if (!dragging) onOpen?.(story.id);

      }}

      className={cn(

        'rounded-md p-3 cursor-pointer',

        'bg-surface border border-subtle',

        'hover:border-default transition-colors',

        story.status === 'blocked' && 'border-rose-500',

      )}

    >

      {/* Header: id + status + menu */}

      <div className="flex items-center justify-between mb-2">

        <span className="text-xs text-fg-tertiary font-mono">{story.id}</span>

        <div className="flex items-center gap-1">

          {story.jira_key && (

            <a href={story.jira_url} target="_blank" rel="noopener noreferrer"

               className="text-xs text-blue-400 hover:underline"

               onClick={(e) => e.stopPropagation()}>

              {story.jira_key}

            </a>

          )}

          <StoryMenu story={story} />

        </div>

      </div>

      

      {/* Title */}

      <h3 className="text-sm font-medium line-clamp-2 mb-2">{story.title}</h3>

      

      {/* Start Implementation button (when in 'todo' or 'in_progress') */}

      {(story.status === 'todo' || story.status === 'in_progress') && (

        <button

          onClick={(e) => { e.stopPropagation(); onStartImplementation(story); }}

          className="text-xs text-accent-primary hover:underline mb-2"

        >

          {story.status === 'in_progress' ? 'View in terminal →' : '🚀 Start implementation →'}

        </button>

      )}

      

      {/* Labels */}

      {story.labels.length > 0 && (

        <div className="flex flex-wrap gap-1 mb-2">

          {story.labels.slice(0, 3).map(label => (

            <Chip key={label} size="sm" color={getLabelColor(label)}>

              {label}

            </Chip>

          ))}

        </div>

      )}

      

      {/* Subtask progress */}

      {story.subtasks.length > 0 && (

        <div className="mb-2">

          <div className="text-xs text-fg-tertiary mb-1">

            {story.subtasks.filter(s => s.done).length}/{story.subtasks.length} subtasks

          </div>

          <div className="h-1 bg-elevated rounded-full overflow-hidden">

            <div

              className="h-full bg-accent-primary"

              style={{ width: `${(story.subtasks.filter(s => s.done).length / story.subtasks.length) * 100}%` }}

            />

          </div>

        </div>

      )}

      

      {/* Footer: assignee + estimate + time */}

      <div className="flex items-center justify-between text-xs text-fg-tertiary">

        <div className="flex items-center gap-2">

          {story.assignee_id && <Avatar src={...} size="xs" />}

          <span>{estimateLabel(story.estimate)}</span>

        </div>

        <span>{timeAgo(story.updated_at)}</span>

      </div>

    </div>

  );

}
========================================================== ZONE 6 — LIST VIEW (virtualized table)
In src/components/stories/story-list.tsx:

typescript

Copy
'use client';

import { useVirtualizer } from '@tanstack/react-virtual';

import { useStories } from '@/lib/query/hooks';


export function StoryList({ stories, onOpen }: StoryListProps) {

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({

    count: stories.length,

    getScrollElement: () => parentRef.current,

    estimateSize: () => 56,

    overscan: 10,

  });

  

  return (

    <div ref={parentRef} className="h-[600px] overflow-auto border rounded-lg">

      {/* Header row */}

      <div className="sticky top-0 bg-elevated grid grid-cols-[80px_1fr_120px_80px_100px_120px_80px_60px] gap-2 px-3 py-2 text-xs uppercase tracking-wider text-fg-tertiary border-b">

        <div>ID</div>

        <div>Title</div>

        <div>Status</div>

        <div>Priority</div>

        <div>Assignee</div>

        <div>Estimate</div>

        <div>Labels</div>

        <div>Updated</div>

      </div>

      

      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>

        {virtualizer.getVirtualItems().map(virtualRow => {

          const story = stories[virtualRow.index];

          return (

            <div

              key={story.id}

              onClick={() => onOpen(story.id)}

              className="absolute top-0 left-0 right-0 grid grid-cols-[80px_1fr_120px_80px_100px_120px_80px_60px] gap-2 px-3 py-3 border-b cursor-pointer hover:bg-elevated"

              style={{ transform: `translateY(${virtualRow.start}px)` }}

            >

              <div className="font-mono text-xs">{story.id}</div>

              <div className="text-sm font-medium truncate">{story.title}</div>

              <div><StatusBadge status={story.status} /></div>

              <div><PriorityDot priority={story.priority} /></div>

              <div>{story.assignee_id && <Avatar size="xs" />}</div>

              <div>{estimateLabel(story.estimate)}</div>

              <div className="flex gap-1">

                {story.labels.slice(0, 2).map(l => <Chip key={l} size="sm">{l}</Chip>)}

              </div>

              <div className="text-xs text-fg-tertiary">{timeAgo(story.updated_at)}</div>

            </div>

          );

        })}

      </div>

    </div>

  );

}
========================================================== ZONE 7 — TIMELINE VIEW (gantt-style)
In src/components/stories/timeline-view.tsx:

typescript

Copy
function TimelineView({ stories, sprint }: TimelineViewProps) {

  const days = useMemo(() => {

    if (!sprint) return [];

    return eachDayOfInterval({

      start: new Date(sprint.start_date),

      end: new Date(sprint.end_date),

    });

  }, [sprint]);

  

  return (

    <div>

      {/* Day headers */}

      <div className="grid sticky top-0 bg-elevated" style={{ gridTemplateColumns: `200px repeat(${days.length}, 1fr)` }}>

        <div></div>

        {days.map(d => (

          <div key={d.toISOString()} className="text-xs text-center py-2 border-l">

            <div>{format(d, 'EEE')}</div>

            <div>{format(d, 'd')}</div>

          </div>

        ))}

      </div>

      

      {/* Group by assignee */}

      {Object.entries(groupBy(stories, 'assignee_id')).map(([assigneeId, assigneeStories]) => (

        <div key={assigneeId} className="grid border-b" style={{ gridTemplateColumns: `200px repeat(${days.length}, 1fr)` }}>

          <div className="p-2 flex items-center gap-2">

            <Avatar size="sm" />

            <span className="text-sm">{assigneeId ? getUserName(assigneeId) : 'Unassigned'}</span>

          </div>

          <div className="col-span-full relative" style={{ gridColumn: `2 / span ${days.length}` }}>

            {assigneeStories.map(story => (

              <TimelineBar

                key={story.id}

                story={story}

                days={days}

                sprint={sprint}

              />

            ))}

          </div>

        </div>

      ))}

    </div>

  );

}


function TimelineBar({ story, days, sprint }: any) {

  const startDay = dayDiff(new Date(sprint.start_date), new Date(story.started_at || sprint.start_date));

  const duration = estimatePoints(story.estimate) * 0.5; // 0.5 days per point

  const left = (startDay / days.length) * 100;

  const width = (duration / days.length) * 100;

  

  return (

    <div

      className={cn(

        'absolute h-8 rounded px-2 flex items-center text-xs',

        getStatusColor(story.status),

      )}

      style={{ left: `${left}%`, width: `${width}%`, top: '4px' }}

      onClick={() => onOpen(story.id)}

    >

      <span className="truncate">{story.title}</span>

    </div>

  );

}
========================================================== ZONE 8 — LIFECYCLE VIEW (dependency graph)
In src/components/stories/lifecycle-view.tsx:

typescript

Copy
function LifecycleView({ stories }: LifecycleViewProps) {

  // Build dependency graph from linked_items

  const { nodes, edges } = useMemo(() => {

    const nodes: GraphNode[] = stories.map(s => ({

      id: s.id,

      label: s.id,

      data: s,

    }));

    const edges: GraphEdge[] = [];

    stories.forEach(s => {

      s.linked_items.forEach(item => {

        if (item.type === 'subtask' || item.type === 'task') {

          edges.push({ source: s.id, target: item.id });

        }

      });

    });

    return { nodes, edges };

  }, [stories]);

  

  return (

    <div>

      <div className="text-sm text-fg-secondary mb-4">

        Stories across time and their dependencies. Click any node to open.

      </div>

      <div className="grid grid-cols-[1fr_360px] gap-4">

        <DependencyGraph

          nodes={nodes}

          edges={edges}

          onNodeClick={(id) => onOpen(id)}

        />

        <ActiveImplementations stories={stories} />

      </div>

    </div>

  );

}
========================================================== ZONE 9 — NEW STORY DIALOG (rich editor)
In src/components/stories/new-story-dialog.tsx:

typescript

Copy
'use client';

import { useForm } from 'react-hook-form';

import MDEditor from '@uiw/react-md-editor';

import { useCreateStory, useStartImplementation, useEpics, useSprints } from '@/lib/query/hooks';


export function NewStoryDialog({ onClose }: { onClose: () => void }) {

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm();

  const [description, setDescription] = useState('');

  const [criteria, setCriteria] = useState([{ id: crypto.randomUUID(), text: 'Given [context]...', done: false }]);

  const [subtasks, setSubtasks] = useState([]);

  

  const createStory = useCreateStory();

  const startImpl = useStartImplementation();

  const { data: epics } = useEpics();

  const { data: sprints } = useSprints();

  

  async function handleSubmit(data, startImplNow = false) {

    const result = await createStory.mutateAsync({

      ...data,

      description,

      acceptance_criteria: criteria,

      subtasks,

    });

    

    if (startImplNow) {

      // Immediately start implementation

      await startImpl.mutate(result.id);

    }

    

    onClose();

  }

  

  return (

    <Dialog open onOpenChange={(o) => !o && onClose()}>

      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">

        <DialogHeader>

          <DialogTitle>New story</DialogTitle>

          <DialogDescription>Create a user story with rich description, acceptance criteria, and subtasks.</DialogDescription>

        </DialogHeader>

        

        <form onSubmit={handleSubmit((data) => handleSubmit(data, false))}>

          {/* Title */}

          <Field>

            <Label>Title *</Label>

            <Input

              {...register('title', { required: true })}

              autoFocus

              placeholder="As a [user], I want [feature] so that [benefit]"

            />

            {errors.title && <ErrorMessage>Title is required</ErrorMessage>}

          </Field>

          

          {/* Description (markdown) */}

          <Field>

            <Label>Description</Label>

            <MDEditor

              value={description}

              onChange={setDescription}

              height={200}

              preview="edit"

              data-color-mode="dark"

            />

          </Field>

          

          {/* Acceptance Criteria (checklist) */}

          <Field>

            <Label>Acceptance criteria</Label>

            <ChecklistEditor items={criteria} onChange={setCriteria} />

          </Field>

          

          {/* Subtasks */}

          <Field>

            <Label>Subtasks (optional)</Label>

            <SubtaskEditor items={subtasks} onChange={setSubtasks} />

          </Field>

          

          {/* Metadata */}

          <div className="grid grid-cols-2 gap-4">

            <Field>

              <Label>Epic</Label>

              <Select {...register('epic_id')}>

                <option value="">Select an epic...</option>

                {epics?.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}

              </Select>

            </Field>

            <Field>

              <Label>Sprint</Label>

              <Select {...register('sprint_id')}>

                <option value="">Backlog</option>

                {sprints?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}

              </Select>

            </Field>

          </div>

          

          <div className="grid grid-cols-2 gap-4">

            <Field>

              <Label>Priority</Label>

              <RadioGroup {...register('priority', { required: true })} defaultValue="P2">

                <Radio value="P0">P0 · Critical</Radio>

                <Radio value="P1">P1 · High</Radio>

                <Radio value="P2">P2 · Medium</Radio>

                <Radio value="P3">P3 · Low</Radio>

              </RadioGroup>

            </Field>

            <Field>

              <Label>Estimate</Label>

              <RadioGroup {...register('estimate', { required: true })} defaultValue="M">

                <Radio value="XS">XS · 1</Radio>

                <Radio value="S">S · 2</Radio>

                <Radio value="M">M · 3</Radio>

                <Radio value="L">L · 5</Radio>

                <Radio value="XL">XL · 8</Radio>

              </RadioGroup>

            </Field>

          </div>

          

          {/* Labels */}

          <Field>

            <Label>Labels</Label>

            <LabelPicker {...register('labels')} />

          </Field>

          

          {/* Assignee */}

          <Field>

            <Label>Assignee</Label>

            <UserPicker {...register('assignee_id')} />

          </Field>

          

          <DialogFooter>

            <Button variant="ghost" type="button">Save as draft</Button>

            <Button variant="outline" type="button" onClick={handleSubmit((d) => handleSubmit(d, false))}>

              Create

            </Button>

            <Button type="button" onClick={handleSubmit((d) => handleSubmit(d, true))}>

              Create and start implementation →

            </Button>

          </DialogFooter>

        </form>

      </DialogContent>

    </Dialog>

  );

}
========================================================== ZONE 10 — STORY DETAIL DRAWER
In src/components/stories/story-detail-drawer.tsx:

typescript

Copy
function StoryDetailDrawer({ storyId, onClose }: StoryDetailDrawerProps) {

  const { data: story } = useStory(storyId);

  const { data: linked } = useStoryLinkedItems(storyId);

  const updateStory = useUpdateStory();

  const syncJira = useSyncToJira();

  const [tab, setTab] = useState<'overview' | 'context' | 'implementation' | 'tests' | 'discussion' | 'history'>('overview');

  

  return (

    <Drawer open onClose={onClose} className="w-[720px]">

      <DrawerHeader>

        <div className="flex items-center justify-between">

          <div>

            <span className="text-xs text-fg-tertiary font-mono">{story.id}</span>

            <StatusBadge status={story.status} />

            <PriorityDot priority={story.priority} />

            {story.jira_key && (

              <a href={story.jira_url} className="text-xs text-blue-400 ml-2">

                {story.jira_key} ↗

              </a>

            )}

          </div>

          <Button onClick={onClose}><X /></Button>

        </div>

        <TitleEditor

          value={story.title}

          onSave={(title) => updateStory.mutate({ id: story.id, title })}

        />

        <div className="flex items-center gap-2 mt-2 text-xs text-fg-tertiary">

          <span>Reporter: {story.reporter_id}</span>

          <span>·</span>

          <span>Created {timeAgo(story.created_at)}</span>

        </div>

      </DrawerHeader>

      

      <Tabs value={tab} onChange={setTab}>

        <Tab value="overview">Overview</Tab>

        <Tab value="context">Context</Tab>

        <Tab value="implementation">Implementation</Tab>

        <Tab value="tests">Tests</Tab>

        <Tab value="discussion">Discussion</Tab>

        <Tab value="history">History</Tab>

      </Tabs>

      

      <TabContent value="overview">

        {/* Description, acceptance criteria, subtasks */}

      </TabContent>

      <TabContent value="context">

        {/* Linked items: PRDs, ADRs, ideas, epics, runs */}

        <ContextTab linked={linked} />

      </TabContent>

      <TabContent value="implementation">

        {/* Active run, PR, files changed */}

        <ImplementationTab story={story} />

      </TabContent>

      <TabContent value="tests">

        {/* Test results */}

      </TabContent>

      <TabContent value="discussion">

        <CommentsThread storyId={storyId} />

      </TabContent>

      <TabContent value="history">

        {/* Version history */}

      </TabContent>

    </Drawer>

  );

}
========================================================== ZONE 11 — REMOVE DUMMY DATA
bash

Copy
grep -r "S-101\|S-102\|S-103\|S-110\|S-117" apps/forge/  # your dummy story IDs

grep -r "Story detail drawer\|WIP limit exceeded\|drawer traps focus" apps/forge/  # dummy titles
Remove ALL hardcoded story data. Every story comes from useStories().

========================================================== ZONE 12 — BACKEND ENDPOINTS (Stories only)
python

Copy
# backend/app/api/v1/stories.py

> **Status:** completed
> **Last classified:** 2026-07-05

@router.get("/stories")

@router.post("/stories")

@router.get("/stories/{id}")

@router.patch("/stories/{id}")

@router.delete("/stories/{id}")

@router.patch("/stories/bulk")

@router.get("/stories/{id}/linked")

@router.get("/stories/{id}/comments")

@router.post("/stories/{id}/comments")

@router.post("/stories/{id}/sync-jira")

@router.post("/stories/{id}/link-jira")

@router.post("/stories/{id}/start-implementation")  # opens terminal session


# backend/app/api/v1/sprints.py

@router.get("/sprints")

@router.get("/sprints/current")

@router.post("/sprints/{id}/start")


# backend/app/api/v1/epics.py

@router.get("/epics")
All endpoints use tenant_id from JWT (Rule 2). All stories have project_id scoping.

========================================================== CONSTRAINTS
Only stories wiring — Project Intelligence is a separate phase
All story data tenant-scoped (Rule 2)
Drag-drop optimistic updates (instant feel)
Jira sync is the headline feature
"Start implementation" must use real terminal session creation
Don't break the existing UI design (Step 21)
Don't break the kanban + list + timeline + lifecycle views
All 4 views share the same data hooks
========================================================== DELIVERABLE
files modified, new files in src/components/stories/ + src/lib/query/
All 4 views wired (Kanban, List, Timeline, Lifecycle)
New story dialog with markdown editor + acceptance criteria + subtasks
Story detail drawer with 6 tabs (Overview, Context, Implementation, Tests, Discussion, History)
Jira sync (link + push)
Start implementation flow (opens terminal session)
Real-time updates via WebSocket (story status changes propagate across views)
All dummy data removed
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the 4 views, keep the kanban drag-drop, keep the sprint picker, keep the filter bar
Test: create story → appears in kanban within 1s
Test: drag story across columns → status persists, no API call until drop
Test: link to Jira → jira_key appears, sync indicator turns green
Test: start implementation → terminal session opens with story context
Test: switch to List view → see all stories in virtualized table
Test: switch to Timeline view → see gantt-style timeline
