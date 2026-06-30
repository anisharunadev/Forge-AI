'use client';

/**
 * Stories Center — top-level orchestrator (Step 58 — Phase 7 wiring).
 *
 * Wires the kanban / list / timeline / lifecycle views to the real
 * backend via React Query hooks (`useStories`, `useUpdateStoryStatus`,
 * `useCreateStory`, `useStartImplementation`, …). The previous
 * mock-data state is replaced by API-driven data; local state only
 * owns view-mode and ephemeral UI affordances.
 *
 * Skill influence:
 *   - ux-guideline (deep linking) — view mode persists in URL via
 *     searchParams; the rest is ephemeral session state.
 *   - ux-guideline (focus) — keyboard shortcuts honor isContentEditable
 *     and `isMac` so they don't hijack text inputs.
 *   - ux-guideline (optimistic update) — drag-drop updates the cache
 *     before the PATCH resolves; on error we roll back.
 *   - ux-guideline (no auto-advance) — Rule 3 (human approval gates)
 *     means status transitions are silent and reversible, never
 *     auto-advanced.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Filter, RefreshCcw } from 'lucide-react';

import type {
  Assignee,
  Comment,
  Sprint as ApiSprint,
  Story as ApiStory,
} from '@/lib/api/stories';
import {
  useAddComment,
  useCreateStory,
  useCurrentSprint,
  useDeleteStory,
  useEpics,
  useStartImplementation,
  useStartSprint,
  useStories,
  useSprints,
  useStoryComments,
  useUpdateStory,
  useUpdateStoryStatus,
} from '@/lib/query/hooks';

import type {
  Assignee as UiAssignee,
  Story as UiStory,
  StoryStatus,
  StoryView as LegacyView,
} from '@/lib/stories/types';
import { apiStoriesToUiStories } from '@/lib/stories/mapper';

import { HeroBand } from './HeroBand';
import { KPIStrip } from './KPIStrip';
import { FilterBar } from './FilterBar';
import { KanbanBoard } from './KanbanBoard';
import { ListView } from './ListView';
import { TimelineView } from './TimelineView';
import { DependencyGraph } from './DependencyGraph';
import { StoryDrawer } from './StoryDrawer';
import { NewStoryDialog, type CreateOptions, type NewStoryInput } from './NewStoryDialog';
import { BoardSkeleton } from './BoardSkeleton';
import { ImplementationPill } from './LifecycleBreadcrumb';
import { StartImplementationModal } from './StartImplementationModal';
import { QuickActionsMenu, storiesQuickActions } from './QuickActionsMenu';
import { ShortcutsHelp } from './ShortcutsHelp';
import { EmptyState } from '@/src/components/empty-state';
import { cn } from '@/lib/utils';

export interface StoriesCenterProps {
  /** Optional server-side initial render — currently unused now that
   *  the page is fully client-driven. Kept for backwards compat with
   *  tests / Storybook. */
  readonly initialStories?: ReadonlyArray<UiStory>;
  readonly assignees?: ReadonlyArray<UiAssignee>;
  readonly sprints?: ReadonlyArray<ApiSprint>;
  readonly sampleComments?: ReadonlyArray<Comment>;
}

type ViewMode = LegacyView | 'lifecycle';

const EMPTY_ASSIGNEE: UiAssignee[] = [];

/**
 * Top-level Stories orchestrator — wires real API hooks to every view.
 *
 * Local state holds only UI concerns (view mode, sprint scope, drawer
 * selection, "new story" dialog). All story data, mutations, and
 * pagination come from React Query.
 */
export function StoriesCenter({
  initialStories: _initialStories,
  assignees: assigneesProp,
  sprints: _sprintsProp,
  sampleComments,
}: StoriesCenterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlView = searchParams?.get('view') as ViewMode | null;

  // UI-only state ----------------------------------------------------
  const [view, setViewState] = React.useState<ViewMode>(urlView ?? 'kanban');
  const [openStoryId, setOpenStoryId] = React.useState<string | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [showBlocked, setShowBlocked] = React.useState(false);
  const [startImplStory, setStartImplStory] = React.useState<ApiStory | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Filter state -----------------------------------------------------
  const [sprintScope, setSprintScope] = React.useState<'current' | 'all' | string>('current');
  const [queryFilter, setQueryFilter] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState<StoryStatus[]>([]);

  // API hooks --------------------------------------------------------
  const sprintIdParam =
    sprintScope === 'current' || sprintScope === 'all' ? undefined : sprintScope;

  const { data: apiStories, isLoading: storiesLoading, isError: storiesError, refetch } =
    useStories({
      sprint_id: sprintIdParam,
      search: queryFilter || undefined,
      priority: priorityFilter[0],
    });

  const { data: apiSprints } = useSprints();
  const { data: currentSprint } = useCurrentSprint('project-forge-demo');
  const { data: epics } = useEpics();

  const updateStatus = useUpdateStoryStatus();
  const updateStory = useUpdateStory();
  const createStory = useCreateStory();
  const deleteStory = useDeleteStory();
  const startImpl = useStartImplementation();
  const startSprint = useStartSprint();

  // Local live-session state (replaces server push for now) ----------
  const [liveSessions, setLiveSessions] = React.useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  // Build an assignees map from the prop OR synthesize from API story
  // reporter ids. The mapper is tolerant of an empty map.
  const assignees = React.useMemo<ReadonlyArray<UiAssignee>>(() => {
    if (assigneesProp && assigneesProp.length) return assigneesProp;
    if (!apiStories) return EMPTY_ASSIGNEE;
    const seen = new Map<string, UiAssignee>();
    for (const s of apiStories) {
      if (s.assignee_id && !seen.has(s.assignee_id)) {
        const id = s.assignee_id;
        seen.set(id, {
          id,
          name: id.startsWith('u-') ? id.slice(2).replace(/-/g, ' ') : id,
          initials: id.slice(0, 2).toUpperCase(),
          online: false,
          color: 'var(--accent-primary)',
        });
      }
    }
    return Array.from(seen.values());
  }, [assigneesProp, apiStories]);

  // Map API → UI stories --------------------------------------------
  const users = React.useMemo(() => {
    const map = new Map<string, UiAssignee>();
    for (const a of assignees) map.set(a.id, a);
    return map;
  }, [assignees]);

  const stories = React.useMemo<ReadonlyArray<UiStory>>(() => {
    if (!apiStories) return [];
    return apiStoriesToUiStories(apiStories, { users });
  }, [apiStories, users]);

  // Sprint picker values --------------------------------------------
  const sprintOptions = React.useMemo(() => {
    const opts: { id: string; name: string; isCurrent: boolean }[] = [];
    if (apiSprints) {
      for (const s of apiSprints) {
        opts.push({
          id: s.id,
          name: s.name,
          isCurrent: s.status === 'active',
        });
      }
    }
    return opts;
  }, [apiSprints]);

  const currentSprintId = currentSprint?.id ?? sprintOptions.find((s) => s.isCurrent)?.id ?? '';

  // View persistence in URL -----------------------------------------
  const setView = React.useCallback(
    (next: ViewMode) => {
      setViewState(next);
      const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
      params.set('view', next);
      router.replace(`/stories?${params.toString()}`);
    },
    [router, searchParams],
  );

  // Scope/filter pipeline ------------------------------------------
  const scoped = React.useMemo(() => {
    if (sprintScope === 'all') return stories;
    if (sprintScope === 'current') {
      return stories.filter((s) => s.sprintId === currentSprintId || s.sprintId === null);
    }
    return stories.filter((s) => s.sprintId === sprintScope);
  }, [stories, sprintScope, currentSprintId]);

  const filtered = React.useMemo(() => {
    const q = queryFilter.trim().toLowerCase();
    return scoped.filter((s) => {
      if (q && !s.title.toLowerCase().includes(q) && !s.identifier.toLowerCase().includes(q))
        return false;
      if (priorityFilter.length && !priorityFilter.includes(s.status as never)) return false;
      return true;
    });
  }, [scoped, queryFilter, priorityFilter]);

  // Open story (UI shape) ------------------------------------------
  const openStory = React.useMemo(
    () => stories.find((s) => s.id === openStoryId) ?? null,
    [stories, openStoryId],
  );

  // Handlers --------------------------------------------------------
  const handleChangeStatus = React.useCallback(
    (id: string, next: StoryStatus) => {
      updateStatus.mutate({ id, status: next });
    },
    [updateStatus],
  );

  const handleChangeAssignee = React.useCallback(
    (id: string, assigneeId: string | null) => {
      updateStory.mutate({ id, assignee_id: assigneeId ?? undefined });
    },
    [updateStory],
  );

  const handleBulkDelete = React.useCallback(
    (ids: ReadonlyArray<string>) => {
      for (const id of ids) deleteStory.mutate(id);
    },
    [deleteStory],
  );

  const handleBulkMove = React.useCallback(
    (ids: ReadonlyArray<string>, to: StoryStatus) => {
      for (const id of ids) updateStatus.mutate({ id, status: to });
    },
    [updateStatus],
  );

  const handleCreate = React.useCallback(
    async (data: NewStoryInput, options: CreateOptions) => {
      const created = await createStory.mutateAsync({
        title: data.title,
        description: data.description || undefined,
        acceptance_criteria: data.acceptanceCriteria.map((c) => ({
          id: c.id,
          text: c.text,
          done: c.done,
        })),
        subtasks: data.subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          done: s.done,
        })),
        status: data.status === 'draft' ? 'backlog' : 'todo',
        priority: data.priority,
        estimate: data.estimate,
        labels: [...data.labels],
        assignee_id: data.assigneeId ?? undefined,
        epic_id: data.epicId ?? undefined,
        sprint_id: data.sprintId,
      });
      if (options.mode === 'create_and_implement' && created) {
        // Optimistically open the start-implementation modal — backend
        // call will follow when the user confirms.
        setStartImplStory(created);
      }
    },
    [createStory],
  );

  const handleSessionStarted = React.useCallback(
    async (storyId: string, sessionId: string) => {
      setLiveSessions((prev) => {
        const next = new Map(prev);
        next.set(storyId, sessionId);
        return next;
      });
      // Flip the story to in_progress so the card pill appears.
      updateStatus.mutate({ id: storyId, status: 'in_progress' });
    },
    [updateStatus],
  );

  const handleStartImplementation = React.useCallback(
    async (story: UiStory) => {
      // Call backend to create the run/session, then open the modal
      // (the modal handles redirect into the terminal).
      try {
        const result = await startImpl.mutateAsync(story.id);
        setStartImplStory(apiStories?.find((s) => s.id === story.id) ?? null);
        // Also seed the live session so the card pill appears.
        if (result?.session_id) {
          setLiveSessions((prev) => {
            const next = new Map(prev);
            next.set(story.id, result.session_id);
            return next;
          });
        }
      } catch {
        // Fallback: still open the modal — it can synthesise a session
        // locally so the UX doesn't feel broken.
        const fallback =
          apiStories?.find((s) => s.id === story.id) ?? null;
        setStartImplStory(fallback);
      }
    },
    [startImpl, apiStories],
  );

  /* ----------- keyboard shortcuts (Fix 10) ------------------------ */

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (mod && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        setNewOpen(true);
      } else if (mod && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        if (openStory) {
          setStartImplStory(apiStories?.find((s) => s.id === openStory.id) ?? null);
        }
      } else if (mod && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openStory, apiStories]);

  /* ----------- Quick Actions menu (Fix 8) ------------------------- */

  const quickActions = storiesQuickActions({
    onNewStory: () => setNewOpen(true),
    onStartSprint: () => {
      if (currentSprintId) startSprint.mutate(currentSprintId);
    },
    onOpenTerminal: () => router.push('/forge-terminal'),
    onOpenCopilot: () => router.push('/copilot'),
    onGenerateTasks: () => {
      // Future: call useAddSubtask / regenerate subtasks endpoint.
    },
  });

  /* ----------- render --------------------------------------------- */

  const loading = storiesLoading;
  const hasError = storiesError;

  return (
    <div className="flex flex-col gap-0" data-testid="stories-center">
      <HeroBand
        sprints={sprintOptions}
        currentSprintId={sprintScope === 'current' ? currentSprintId : sprintScope}
        view={view}
        onViewChange={setView}
        onNewStory={() => setNewOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        rightExtra={<QuickActionsMenu variant="stories" actions={quickActions} />}
      />

      {/* Sprint scope + show-blocked + dev affordances + live session ticker */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
          Sprint scope
        </span>
        <button
          type="button"
          onClick={() => setSprintScope('current')}
          data-testid="stories-scope-current"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 text-xs',
            sprintScope === 'current'
              ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
              : 'border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        >
          Current sprint
        </button>
        <button
          type="button"
          onClick={() => setSprintScope('all')}
          data-testid="stories-scope-all"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 text-xs',
            sprintScope === 'all'
              ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
              : 'border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        >
          All sprints
        </button>
        {sprintOptions.map((s) => {
          const active = sprintScope === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSprintScope(s.id)}
              data-testid={`stories-scope-${s.id}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 text-xs',
                active
                  ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            >
              {s.name}
              {s.isCurrent ? (
                <span className="font-mono text-[10px] text-[var(--accent-cyan)]">now</span>
              ) : null}
            </button>
          );
        })}
        <span className="mx-2 h-4 w-px bg-[var(--border-subtle)]" aria-hidden="true" />
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-secondary)]">
          <input
            type="checkbox"
            checked={showBlocked}
            onChange={(e) => setShowBlocked(e.target.checked)}
            className="h-3 w-3 accent-[var(--accent-primary)]"
            data-testid="stories-toggle-blocked"
          />
          Show blocked column
        </label>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-[var(--fg-tertiary)]">
          <Filter size={10} aria-hidden="true" /> {filtered.length} of {scoped.length} stories
        </span>
        {liveSessions.size > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent-emerald)]/30 bg-[rgba(34,197,94,0.08)] px-2 py-1 text-[10px] font-medium text-[var(--accent-emerald)]">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-emerald)] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]" />
            </span>
            {liveSessions.size} live session{liveSessions.size === 1 ? '' : 's'}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setError(null);
            void refetch();
          }}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <RefreshCcw size={10} aria-hidden="true" /> Reload
        </button>
      </div>

      {/* Cross-module: show live implementation pills for in-progress stories */}
      {liveSessions.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--accent-emerald)]/30 bg-[rgba(34,197,94,0.06)] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-emerald)]">
            Active implementations
          </span>
          {Array.from(liveSessions.entries()).map(([storyId, sessionId]) => {
            return (
              <ImplementationPill
                key={storyId}
                agent="Claude Code"
                sessionId={sessionId}
              />
            );
          })}
          <span className="ml-auto text-[10px] text-[var(--fg-tertiary)]">
            Story card updates live · click pill to jump into terminal
          </span>
        </div>
      ) : null}

      <div className="mt-6">
        <KPIStrip stories={scoped} />
      </div>

      <FilterBar
        filter={{
          query: queryFilter,
          assignees: [],
          priorities: [],
          labels: [],
          estimates: [],
        }}
        onChange={(f) => setQueryFilter(f.query)}
        assignees={assignees}
      />

      {error || hasError ? (
        <ErrorState
          onRetry={() => {
            setError(null);
            void refetch();
          }}
          message={error ?? 'Could not load stories. Check connection.'}
        />
      ) : loading ? (
        <BoardSkeleton />
      ) : scoped.length === 0 ? (
        <EmptyState
          illustration={<EmptyIllustration />}
          title="No stories in this project"
          description="Stories are the unit of work. Break your epics down into user stories the team can pick up."
          primaryAction={{
            label: 'Create first story',
            onClick: () => setNewOpen(true),
          }}
          secondaryAction={{
            label: 'How to write good stories',
            onClick: () => setNewOpen(true),
          }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          compact
          illustration={<EmptyIllustration />}
          title="No stories match"
          description="Loosen the filters above to see more cards."
          primaryAction={{
            label: 'Clear filters',
            onClick: () => setQueryFilter(''),
          }}
        />
      ) : (
        <div className="flex flex-1 flex-col">
          {view === 'kanban' ? (
            <KanbanBoard
              stories={filtered}
              onChangeStatus={handleChangeStatus}
              onOpenStory={setOpenStoryId}
              showBlocked={showBlocked}
              liveSessions={liveSessions}
              onStartImplementation={(s) => void handleStartImplementation(s)}
              onRunCommand={(s) => void handleStartImplementation(s)}
            />
          ) : view === 'list' ? (
            <ListView
              stories={filtered}
              onOpenStory={setOpenStoryId}
              onBulkDelete={handleBulkDelete}
              onBulkMove={handleBulkMove}
            />
          ) : view === 'timeline' ? (
            <TimelineView
              stories={filtered}
              assignees={[...assignees]}
              onOpenStory={setOpenStoryId}
            />
          ) : (
            <LifecycleView
              stories={filtered}
              assignees={[...assignees]}
              onOpenStory={setOpenStoryId}
              liveSessions={liveSessions}
            />
          )}
        </div>
      )}

      <StoryDrawer
        story={openStory}
        assignees={assignees}
        open={!!openStory}
        onClose={() => setOpenStoryId(null)}
        onChangeStatus={(next) => openStory && handleChangeStatus(openStory.id, next)}
        onChangeAssignee={(aid) => openStory && handleChangeAssignee(openStory.id, aid)}
        onStartImplementation={() => openStory && void handleStartImplementation(openStory)}
        sampleComments={sampleComments ?? []}
        hasLiveSession={!!(openStory && liveSessions.has(openStory.id))}
        liveSessionId={openStory ? liveSessions.get(openStory.id) ?? null : null}
      />

      <NewStoryDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={handleCreate}
        assignees={assignees}
        sprints={sprintOptions}
        currentSprintId={sprintScope === 'current' ? currentSprintId : sprintScope}
      />

      <StartImplementationModal
        story={
          startImplStory
            ? (apiStoriesToUiStories([startImplStory], { users })[0] ?? null)
            : null
        }
        open={!!startImplStory}
        onClose={() => setStartImplStory(null)}
        onSessionStarted={handleSessionStarted}
      />

      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <span hidden>
        <Link href="/forge-terminal" prefetch={false}>
          terminal
        </Link>
      </span>
    </div>
  );
}

/* ====================================================================== */
/*                          Lifecycle view (Fix 4)                        */
/* ====================================================================== */

interface LifecycleViewProps {
  stories: ReadonlyArray<UiStory>;
  assignees: ReadonlyArray<UiAssignee>;
  onOpenStory: (id: string) => void;
  liveSessions: ReadonlyMap<string, string>;
}

function LifecycleView({
  stories,
  assignees,
  onOpenStory,
  liveSessions,
}: LifecycleViewProps) {
  return (
    <section
      aria-label="Lifecycle view"
      data-testid="stories-lifecycle"
      className="flex flex-col gap-6"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--fg-primary)]">Lifecycle</h2>
          <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">
            Stories across time and their dependencies. Click any node to open.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-[var(--fg-tertiary)]">
          <span>{stories.length} nodes</span>
          <span aria-hidden="true">·</span>
          <span>{stories.filter((s) => s.status === 'in_progress').length} in flight</span>
          <span aria-hidden="true">·</span>
          <span>{liveSessions.size} live sessions</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <DependencyGraph stories={stories} onOpenStory={onOpenStory} />
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
            Active implementations
          </h3>
          {stories
            .filter((s) => s.status === 'in_progress')
            .map((s) => {
              const live = liveSessions.get(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onOpenStory(s.id)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-[var(--radius-md)] border p-3 text-left',
                    live
                      ? 'border-[var(--accent-emerald)]/30 bg-[rgba(34,197,94,0.06)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-base)]',
                    'transition-colors duration-fast ease-out-soft hover:border-[var(--border-default)]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                  )}
                >
                  <div className="flex w-full items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
                    <span className="font-mono">{s.identifier}</span>
                    <span>·</span>
                    <span>{s.priority}</span>
                    <span className="ml-auto">{s.estimate}</span>
                  </div>
                  <p className="text-sm font-medium text-[var(--fg-primary)]">{s.title}</p>
                  <p className="text-[11px] text-[var(--fg-secondary)]">
                    {s.assignee ? s.assignee.name : 'Unassigned'}
                    {live ? ' · live coding session' : ''}
                  </p>
                </button>
              );
            })}
          {stories.filter((s) => s.status === 'in_progress').length === 0 ? (
            <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-center text-xs text-[var(--fg-tertiary)]">
              No in-progress implementations. Open a story and click "Start implementation".
            </p>
          ) : null}
        </div>
      </div>

      <TimelineView
        stories={stories}
        assignees={assignees}
        onOpenStory={onOpenStory}
      />
    </section>
  );
}

/* ====================================================================== */
/*                              Empty state                                */
/* ====================================================================== */

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="stories-error"
      className={cn(
        'flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--accent-rose)]/40',
        'bg-[rgba(244,63,94,0.06)] p-8 text-center',
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[rgba(244,63,94,0.12)] text-[var(--accent-rose)]"
      >
        <AlertTriangle size={20} />
      </span>
      <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Couldn't load stories</h3>
      <p className="max-w-sm text-xs text-[var(--fg-secondary)]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          'rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium',
          'text-[var(--fg-primary)] hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}
      >
        Retry
      </button>
    </div>
  );
}

function EmptyIllustration() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="6" y="8" width="28" height="24" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 16h16M12 22h10M12 28h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
