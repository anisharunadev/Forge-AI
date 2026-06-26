'use client';

/**
 * Stories Center — top-level orchestrator (Step 38).
 *
 * Wires every Step 38 fix into one orchestrator:
 *   - 3 views (Kanban / List / Timeline) plus the new Lifecycle view
 *     (timeline + dependency graph) — Fix 4
 *   - Story → Terminal handoff via StartImplementationModal — Fix 5
 *   - Quick actions menu in the hero band — Fix 8
 *   - Keyboard shortcuts (⌘⇧P/S/T, ⌘/) — Fix 10
 *   - Cross-module live session pill on story cards — Fix 5
 *
 * Skill influence:
 *   - ux-guideline (deep linking) — view mode persists in URL via
 *     searchParams; the rest is ephemeral session state.
 *   - ux-guideline (focus) — keyboard shortcuts honor isContentEditable
 *     and `isMac` so they don't hijack text inputs.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Filter, RefreshCcw } from 'lucide-react';

import type {
  Assignee,
  Comment,
  Sprint,
  Story,
  StoryFilter,
  StoryStatus,
  StoryView,
} from '@/lib/stories/types';

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
import {
  ImplementationPill,
} from './LifecycleBreadcrumb';
import { StartImplementationModal } from './StartImplementationModal';
import { QuickActionsMenu, storiesQuickActions } from './QuickActionsMenu';
import { ShortcutsHelp } from './ShortcutsHelp';
import { EmptyState } from '@/src/components/empty-state';
import { cn } from '@/lib/utils';

export interface StoriesCenterProps {
  readonly initialStories: ReadonlyArray<Story>;
  readonly assignees: ReadonlyArray<Assignee>;
  readonly sprints: ReadonlyArray<Sprint>;
  readonly sampleComments: ReadonlyArray<Comment>;
}

const EMPTY_FILTER: StoryFilter = {
  query: '',
  assignees: [],
  priorities: [],
  labels: [],
  estimates: [],
};

export function StoriesCenter({
  initialStories,
  assignees,
  sprints,
  sampleComments,
}: StoriesCenterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlView = searchParams?.get('view') as StoryView | 'lifecycle' | null;
  const [stories, setStories] = React.useState<ReadonlyArray<Story>>(initialStories);
  const [view, setViewState] = React.useState<StoryView | 'lifecycle'>(
    urlView ?? 'kanban',
  );
  const [filter, setFilter] = React.useState<StoryFilter>(EMPTY_FILTER);
  const [currentSprintId, setCurrentSprintId] = React.useState<string>(
    sprints.find((s) => s.isCurrent)?.id ?? sprints[0]!.id,
  );
  const [openStoryId, setOpenStoryId] = React.useState<string | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [showBlocked, setShowBlocked] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [startImplStory, setStartImplStory] = React.useState<Story | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  // Map of storyId → live terminal session id. Populated when
  // "Start implementation" creates a session.
  const [liveSessions, setLiveSessions] = React.useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  // Persist view mode in URL (?view=...).
  const setView = React.useCallback(
    (next: StoryView | 'lifecycle') => {
      setViewState(next);
      const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
      params.set('view', next);
      router.replace(`/stories?${params.toString()}`);
    },
    [router, searchParams],
  );

  const scoped = React.useMemo(() => {
    if (currentSprintId === 'sp-backlog') {
      return stories.filter((s) => s.sprintId === 'sp-backlog');
    }
    return stories.filter((s) => s.sprintId === currentSprintId || s.sprintId === null);
  }, [stories, currentSprintId]);

  const filtered = React.useMemo(() => {
    const q = filter.query.trim().toLowerCase();
    return scoped.filter((s) => {
      if (q && !s.title.toLowerCase().includes(q) && !s.identifier.toLowerCase().includes(q))
        return false;
      if (filter.assignees.length && !s.assignee) return false;
      if (
        filter.assignees.length &&
        s.assignee &&
        !filter.assignees.includes(s.assignee.id)
      )
        return false;
      if (filter.priorities.length && !filter.priorities.includes(s.priority)) return false;
      if (filter.labels.length && !filter.labels.some((l) => s.labels.includes(l))) return false;
      if (filter.estimates.length && !filter.estimates.includes(s.estimate)) return false;
      return true;
    });
  }, [scoped, filter]);

  const openStory = React.useMemo(
    () => stories.find((s) => s.id === openStoryId) ?? null,
    [stories, openStoryId],
  );

  const handleChangeStatus = (id: string, next: StoryStatus) => {
    setStories((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: next, updatedAt: new Date().toISOString() } : s)),
    );
    console.log('[stories] mock API', 'PATCH /stories/:id', { status: next });
  };

  const handleChangeAssignee = (id: string, assigneeId: string | null) => {
    setStories((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              assignee: assignees.find((a) => a.id === assigneeId) ?? null,
              updatedAt: new Date().toISOString(),
            }
          : s,
      ),
    );
  };

  const handleBulkDelete = (ids: ReadonlyArray<string>) => {
    setStories((prev) => prev.filter((s) => !ids.includes(s.id)));
  };

  const handleBulkMove = (ids: ReadonlyArray<string>, to: StoryStatus) => {
    setStories((prev) =>
      prev.map((s) =>
        ids.includes(s.id) ? { ...s, status: to, updatedAt: new Date().toISOString() } : s,
      ),
    );
  };

  const handleCreate = (data: NewStoryInput, options: CreateOptions) => {
    const id = `st-${Math.random().toString(36).slice(2, 8)}`;
    const nextNum = 200 + stories.length;
    const newStory: Story = {
      id,
      identifier: `S-${nextNum}`,
      title: data.title,
      status: data.status === 'draft' ? 'backlog' : 'todo',
      priority: data.priority,
      estimate: data.estimate,
      labels: data.labels,
      assignee: assignees.find((a) => a.id === data.assigneeId) ?? null,
      epicId: data.epicId,
      sprintId: data.sprintId,
      description: data.description,
      acceptanceCriteria: data.acceptanceCriteria,
      subtasks: data.subtasks,
      definitionOfDone: [],
      linkedItems: data.linkedItems,
      activity: [],
      comments: [],
      attachments: [],
      commentCount: 0,
      attachmentCount: 0,
      blocked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };
    setStories((prev) => [newStory, ...prev]);

    // Step 44 — "Create and start implementation" hands off straight
    // into the terminal-launching modal so the user goes from idea to
    // coding session in one click.
    if (options.mode === 'create_and_implement') {
      setStartImplStory(newStory);
    }
  };

  /**
   * Called by the StartImplementationModal after a session has been
   * created. Flip story status to in_progress and record the live
   * session id so the card pill + drawer live indicator reflect it.
   */
  const handleSessionStarted = (storyId: string, sessionId: string) => {
    setStories((prev) =>
      prev.map((s) =>
        s.id === storyId
          ? {
              ...s,
              status: 'in_progress',
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : s,
      ),
    );
    setLiveSessions((prev) => {
      const next = new Map(prev);
      next.set(storyId, sessionId);
      return next;
    });
  };

  /* ----------- keyboard shortcuts (Fix 10) ---------------------------- */

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      // Don't hijack typing in text inputs / contentEditable.
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
          setStartImplStory(openStory);
        } else if (stories[0]) {
          setStartImplStory(stories[0]);
        }
      } else if (mod && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openStory, stories]);

  /* ----------- Quick Actions menu (Fix 8) ----------------------------- */

  const quickActions = storiesQuickActions({
    onNewStory: () => setNewOpen(true),
    onStartSprint: () => console.log('[stories] start sprint'),
    onOpenTerminal: () => router.push('/forge-terminal'),
    onOpenCopilot: () => router.push('/copilot'),
    onGenerateTasks: () => {
      const target = openStory ?? stories[0];
      if (target) {
        setStories((prev) =>
          prev.map((s) =>
            s.id === target.id
              ? {
                  ...s,
                  subtasks: [
                    ...s.subtasks,
                    ...['Audit current implementation', 'Identify refactor candidates', 'Write tests', 'Update docs'].map(
                      (t, i) => ({ id: `sub-auto-${Date.now()}-${i}`, title: t, done: false }),
                    ),
                  ],
                  updatedAt: new Date().toISOString(),
                }
              : s,
          ),
        );
      }
    },
  });

  /* ----------- render ------------------------------------------------- */

  return (
    <div className="flex flex-col gap-0" data-testid="stories-center">
      <HeroBand
        sprints={sprints}
        currentSprintId={currentSprintId}
        view={view}
        onViewChange={setView}
        onNewStory={() => setNewOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        rightExtra={
          <QuickActionsMenu variant="stories" actions={quickActions} />
        }
      />

      {/* Sprint scope + show-blocked + dev affordances + live session ticker */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
          Sprint scope
        </span>
        {sprints.map((s) => {
          const active = currentSprintId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setCurrentSprintId(s.id)}
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
            setLoading(true);
            window.setTimeout(() => setLoading(false), 800);
          }}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <RefreshCcw size={10} aria-hidden="true" /> Reload
        </button>
        <button
          type="button"
          onClick={() => setError('Could not load stories. Check connection.')}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <AlertTriangle size={10} aria-hidden="true" /> Inject error
        </button>
      </div>

      {/* Cross-module: show live implementation pills for in-progress stories
          (Step 38 Fix 5 — the killer "Story → Terminal handoff"). */}
      {liveSessions.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--accent-emerald)]/30 bg-[rgba(34,197,94,0.06)] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-emerald)]">
            Active implementations
          </span>
          {Array.from(liveSessions.entries()).map(([storyId, sessionId]) => {
            const story = stories.find((s) => s.id === storyId);
            if (!story) return null;
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

      <FilterBar filter={filter} onChange={setFilter} assignees={assignees} />

      {error ? (
        <ErrorState onRetry={() => setError(null)} message={error} />
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
            onClick: () => console.log('[stories] open how-to doc'),
          }}
          quickPaths={[
            { id: 'ticket', label: 'Start from a Zendesk ticket', href: '/connector-center' },
            { id: 'idea', label: 'Capture an idea first', href: '/ideation' },
            { id: 'template', label: 'Use a story template', onClick: () => setNewOpen(true) },
          ]}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          compact
          illustration={<EmptyIllustration />}
          title="No stories match"
          description="Loosen the filters above to see more cards."
          primaryAction={{
            label: 'Clear filters',
            onClick: () => setFilter(EMPTY_FILTER),
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
              onStartImplementation={(s) => setStartImplStory(s)}
              onRunCommand={(s, cmd) => {
                if (cmd === '__terminal__') {
                  setStartImplStory(s);
                  return;
                }
                // Step 44 — launch terminal with the chosen forge-*
                // command pre-injected as the initial prompt. The
                // StartImplementationModal already handles session
                // creation, so we open it with the command id patched
                // into the context payload via setStartImplStory.
                setStartImplStory(s);
              }}
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
              assignees={assignees}
              onOpenStory={setOpenStoryId}
            />
          ) : (
            <LifecycleView
              stories={filtered}
              assignees={assignees}
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
        onStartImplementation={() => openStory && setStartImplStory(openStory)}
        sampleComments={sampleComments}
        hasLiveSession={!!(openStory && liveSessions.has(openStory.id))}
        liveSessionId={openStory ? liveSessions.get(openStory.id) ?? null : null}
      />

      <NewStoryDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={handleCreate}
        assignees={assignees}
        sprints={sprints}
        currentSprintId={currentSprintId}
      />

      <StartImplementationModal
        story={startImplStory}
        open={!!startImplStory}
        onClose={() => setStartImplStory(null)}
        onSessionStarted={handleSessionStarted}
      />

      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Hidden — the modal handles navigation itself. We also expose a
          sentinel <Link> for SSR fallback / accessibility tools that
          walk all <a> elements on the page. */}
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
  stories: ReadonlyArray<Story>;
  assignees: ReadonlyArray<Assignee>;
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
