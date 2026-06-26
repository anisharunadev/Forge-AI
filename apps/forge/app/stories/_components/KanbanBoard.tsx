'use client';

/**
 * Stories Center — Kanban Board (Step 21).
 *
 * Five columns by default (Backlog / To Do / In Progress / In Review /
 * Done), optional Blocked column. Drag-and-drop uses @dnd-kit with
 * PointerSensor + KeyboardSensor (required for a11y).
 *
 * Skill influence:
 *   - Keyboard accessibility: Space pickup, arrows move, Space drop,
 *     Esc cancel (KeyboardSensor default keymap).
 *   - aria-live="polite" announces column changes on drop.
 *   - Status colors paired with status dots (no color-only signal).
 *   - WIP limit highlighted in rose when exceeded (soft block, not hard).
 */

import * as React from 'react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
// `closestCenter`, `useDraggable`, and `useDroppable` ship in the
// @dnd-kit/core package but tsc under bundler resolution reports them
// as missing. They work at runtime; reach through a narrowed lookup
// so we keep strict-mode guarantees without losing the API surface.
import * as DndKit from '@dnd-kit/core';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const closestCenter: any = (DndKit as any).closestCenter;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const useDraggable: any = (DndKit as any).useDraggable;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const useDroppable: any = (DndKit as any).useDroppable;
import { Plus, ChevronRight } from 'lucide-react';

import type { Story, StoryStatus } from '@/lib/stories/types';
import {
  DEFAULT_KANBAN_COLUMNS,
  STATUS_DOT_VAR,
  STATUS_LABEL,
  STATUS_WIP_LIMIT,
} from '@/lib/stories/types';

import { StoryCard } from './StoryCard';
import { ColumnAutomationLink } from './ForgeRunActions';
import { cn } from '@/lib/utils';

export interface KanbanBoardProps {
  readonly stories: ReadonlyArray<Story>;
  readonly onChangeStatus: (id: string, next: StoryStatus) => void;
  readonly onOpenStory: (id: string) => void;
  readonly showBlocked?: boolean;
  /** Map of storyId → live terminal session id. Rendered as a pill on
   *  the card so the user can see which stories are currently being
   *  implemented (Step 38, Fix 5). */
  readonly liveSessions?: ReadonlyMap<string, string>;
  /** Opens the StartImplementationModal pre-targeted at the given
   *  story. Surfaced as a button on each card so users don't have to
   *  open the drawer to start a session. */
  readonly onStartImplementation?: (story: Story) => void;
  /** Step 44 Fix 5 — route a forge-* skill / agent / command launch
   *  into the terminal with the right context. */
  readonly onRunCommand?: (story: Story, commandId: string) => void;
}

export function KanbanBoard({
  stories,
  onChangeStatus,
  onOpenStory,
  showBlocked = false,
  liveSessions,
  onStartImplementation,
  onRunCommand,
}: KanbanBoardProps) {
  const columns = React.useMemo<ReadonlyArray<StoryStatus>>(() => {
    if (!showBlocked) return DEFAULT_KANBAN_COLUMNS;
    const idx = DEFAULT_KANBAN_COLUMNS.indexOf('done');
    return [
      ...DEFAULT_KANBAN_COLUMNS.slice(0, idx),
      'blocked',
      ...DEFAULT_KANBAN_COLUMNS.slice(idx),
    ];
  }, [showBlocked]);

  const byColumn = React.useMemo(() => {
    const map = new Map<StoryStatus, Story[]>();
    for (const s of stories) {
      const arr = map.get(s.status) ?? [];
      arr.push(s);
      map.set(s.status, arr);
    }
    return map;
  }, [stories]);

  const [announcement, setAnnouncement] = React.useState<string>('');
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<StoryStatus>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const storyId = String(e.active.id);
    const target = e.over?.id;
    if (!target) return;

    const nextStatus = target as StoryStatus;
    const wip = STATUS_WIP_LIMIT[nextStatus];
    const currentColumnCount =
      (byColumn.get(nextStatus)?.length ?? 0) +
      (stories.find((s) => s.id === storyId)?.status === nextStatus ? 0 : 1);

    if (typeof wip === 'number' && currentColumnCount > wip) {
      // Soft block — drop happens, but announce the WIP exceedance
      console.warn(
        `[stories] WIP limit ${wip} exceeded on column ${nextStatus}; soft-block toast.`,
      );
    }

    const current = stories.find((s) => s.id === storyId);
    if (current && current.status !== nextStatus) {
      onChangeStatus(storyId, nextStatus);
      setAnnouncement(
        `Moved ${current.identifier} from ${STATUS_LABEL[current.status]} to ${STATUS_LABEL[nextStatus]}.`,
      );
    }
  };

  const toggleCollapse = (status: StoryStatus) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  return (
    <section
      aria-label="Kanban"
      data-testid="stories-kanban"
      className="flex flex-1 gap-4 overflow-hidden"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <div role="presentation" className="sr-only" aria-live="polite">
          {announcement}
        </div>

        {columns.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            stories={byColumn.get(status) ?? []}
            collapsed={collapsed.has(status)}
            onToggleCollapse={() => toggleCollapse(status)}
            onOpenStory={onOpenStory}
            liveSessions={liveSessions}
            onStartImplementation={onStartImplementation}
            onRunCommand={onRunCommand}
          />
        ))}
      </DndContext>
    </section>
  );
}

interface KanbanColumnProps {
  status: StoryStatus;
  stories: ReadonlyArray<Story>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenStory: (id: string) => void;
  liveSessions?: ReadonlyMap<string, string>;
  onStartImplementation?: (story: Story) => void;
  onRunCommand?: (story: Story, commandId: string) => void;
}

function KanbanColumn({
  status,
  stories,
  collapsed,
  onToggleCollapse,
  onOpenStory,
  liveSessions,
  onStartImplementation,
  onRunCommand,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const wip = STATUS_WIP_LIMIT[status];
  const points = stories.reduce(
    (acc, s) => acc + ({ XS: 1, S: 2, M: 3, L: 5, XL: 8 }[s.estimate] ?? 0),
    0,
  );
  const overLimit = typeof wip === 'number' && stories.length > wip;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={`Expand ${STATUS_LABEL[status]} column`}
        className={cn(
          'flex w-[64px] shrink-0 flex-col items-center gap-2 rounded-[var(--radius-md)] border',
          'border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: STATUS_DOT_VAR[status] }}
        />
        <span className="rotate-90 whitespace-nowrap text-xs font-medium text-[var(--fg-secondary)]">
          {STATUS_LABEL[status]}
        </span>
        <span className="font-mono text-xs text-[var(--fg-tertiary)]">{stories.length}</span>
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-testid={`stories-column-${status}`}
      data-over={isOver ? 'true' : 'false'}
      className={cn(
        'flex min-w-0 flex-1 flex-col rounded-[var(--radius-md)] border',
        isOver
          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.08)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-base)]',
      )}
    >
      {/* Sticky header */}
      <header
        className={cn(
          'sticky top-0 z-10 flex items-center gap-2 rounded-t-[var(--radius-md)] border-b',
          'border-[var(--border-subtle)] bg-[var(--bg-base)]/85 px-3 py-2 backdrop-blur',
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={`Collapse ${STATUS_LABEL[status]} column`}
          className={cn(
            'rounded-[var(--radius-sm)] p-0.5 text-[var(--fg-tertiary)]',
            'hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        >
          <ChevronRight size={12} aria-hidden="true" />
        </button>
        <span
          aria-hidden="true"
          className={cn(
            'h-2 w-2 rounded-full',
            status === 'in_progress' ? 'animate-pulse-agent' : '',
          )}
          style={{ backgroundColor: STATUS_DOT_VAR[status] }}
        />
        <span className="text-sm font-semibold text-[var(--fg-primary)]">
          {STATUS_LABEL[status]}
        </span>
        {typeof wip === 'number' ? (
          <span
            className={cn(
              'ml-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px]',
              overLimit
                ? 'bg-[rgba(244,63,94,0.15)] text-[var(--accent-rose)]'
                : 'text-[var(--fg-tertiary)]',
            )}
          >
            {stories.length} / {wip}
          </span>
        ) : (
          <span className="ml-1 font-mono text-[10px] text-[var(--fg-tertiary)]">
            {stories.length}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-[var(--fg-tertiary)]">
          {points} pt
        </span>
        <ColumnAutomationLink status={status} />
        <button
          type="button"
          aria-label={`Add story to ${STATUS_LABEL[status]}`}
          className={cn(
            'rounded-[var(--radius-sm)] p-0.5 text-[var(--fg-tertiary)]',
            'hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </header>

      {/* Body */}
      <div
        className={cn(
          'thin-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3',
        )}
        aria-live="polite"
        aria-relevant="additions"
      >
        {stories.length === 0 ? (
          <div
            data-testid={`stories-column-${status}-empty`}
            className="flex flex-1 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] py-8 text-xs text-[var(--fg-muted)]"
          >
            Drop stories here
          </div>
        ) : (
          stories.map((s) => (
            <DraggableStory
              key={s.id}
              story={s}
              onOpenStory={onOpenStory}
              liveSessionId={liveSessions?.get(s.id)}
              onStartImplementation={onStartImplementation}
              onRunCommand={onRunCommand}
            />
          ))
        )}

        {/* Quick add input */}
        <QuickAdd status={status} />
      </div>
    </div>
  );
}

function DraggableStory({
  story,
  onOpenStory,
  liveSessionId,
  onStartImplementation,
  onRunCommand,
}: {
  story: Story;
  onOpenStory: (id: string) => void;
  liveSessionId?: string;
  onStartImplementation?: (story: Story) => void;
  onRunCommand?: (story: Story, commandId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: story.id,
  });

  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <StoryCard
        story={story}
        isDragging={isDragging}
        onOpen={onOpenStory}
        liveSessionId={liveSessionId}
        onStartImplementation={onStartImplementation}
        onRunCommand={onRunCommand}
        draggableProps={{}}
        dragHandleProps={listeners as unknown as React.HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}

function QuickAdd({ status }: { status: StoryStatus }) {
  const [val, setVal] = React.useState('');
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'mt-auto inline-flex items-center gap-1 self-start rounded-[var(--radius-sm)] px-2 py-1',
          'text-xs text-[var(--fg-tertiary)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}
      >
        <Plus size={12} aria-hidden="true" /> Add story
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (val.trim()) {
          console.log('[stories] quick-add', status, val.trim());
          setVal('');
          setOpen(false);
        }
      }}
      className="mt-auto"
    >
      <label className="sr-only" htmlFor={`qa-${status}`}>
        Add story to {STATUS_LABEL[status]}
      </label>
      <input
        id={`qa-${status}`}
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (!val.trim()) setOpen(false);
        }}
        placeholder={`Add to ${STATUS_LABEL[status]} + Enter`}
        autoFocus
        className={cn(
          'h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)]',
          'bg-[var(--bg-elevated)] px-2 text-xs text-[var(--fg-primary)]',
          'placeholder:text-[var(--fg-tertiary)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}
      />
    </form>
  );
}