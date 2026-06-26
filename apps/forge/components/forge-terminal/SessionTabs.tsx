'use client';

/**
 * Terminal — Session Tabs bar.
 *
 * Features:
 *   - Each tab shows its label, lifecycle status dot, and a close button.
 *   - The active tab gets the elevated background + 2px primary underline.
 *   - Drag-to-reorder via @dnd-kit (same primitives used by the Ideation
 *     Kanban — Step 5). Keyboard-operable through the same KeyboardSensor.
 *   - Closed tabs fade to muted and expose a Reopen action in the menu.
 *   - Newly created tabs animate in with slide-from-right + fade.
 *   - "+" trailing button opens the New Session dialog.
 *
 * Skill influence:
 *   - ux-guideline (status indicator) — colored dot paired with the
 *     session title; never color-only.
 *   - ux-guideline (loading indicators) — creating sessions show a
 *     spinner; closed sessions render muted.
 *   - prefers-reduced-motion — drag uses CSS transforms with the
 *     project's standard 200ms ease-out; the global reduced-motion
 *     rule zeros the duration.
 */

import * as React from 'react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import type { SortingStrategy } from '@dnd-kit/sortable/dist/types';

// Turbopack can't resolve named re-exports from @dnd-kit/sortable's top-level
// barrel (`horizontalListSortingStrategy` exists in the bundled .esm.js but the
// type re-export chain through `./strategies` is invisible under bundler
// resolution). Inline the trivial horizontal-list strategy instead.
const horizontalListSortingStrategy: SortingStrategy = ({
  activeIndex,
  overIndex,
  index,
  rects,
}) => {
  if (activeIndex === overIndex) return null;
  const activeRect = rects[activeIndex];
  const overRect = rects[overIndex];
  if (!activeRect || !overRect) return null;
  const widthDelta = overRect.left - activeRect.left;
  const x = activeIndex < overIndex ? overRect.width - widthDelta : -widthDelta;
  return { x, y: 0, scaleX: 1, scaleY: 1 };
};
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  X,
  GripVertical,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  useTerminalStore,
  type SessionStatus,
  type TerminalSession,
} from '@/lib/store';

const STATUS_DOT: Record<SessionStatus, { color: string; label: string }> = {
  creating: { color: 'var(--accent-cyan)', label: 'Initializing' },
  active:   { color: 'var(--accent-emerald)', label: 'Active' },
  closed:   { color: 'var(--fg-muted)', label: 'Closed' },
  error:    { color: 'var(--accent-rose)', label: 'Error' },
};

interface TabProps {
  session: TerminalSession;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onReopen: () => void;
  onRemove: () => void;
  /** Newly-created in the last `slideInWindowMs` ms animate in. */
  isFresh: boolean;
}

function SortableTab({
  session,
  active,
  onSelect,
  onClose,
  onReopen,
  onRemove,
  isFresh,
}: TabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  const dot = STATUS_DOT[session.status];
  const isClosed = session.status === 'closed';

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={isFresh ? { opacity: 0, x: 24, scale: 0.96 } : false}
      animate={{ opacity: isClosed ? 0.55 : 1, x: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      role="tab"
      aria-selected={active}
      data-testid={`session-tab-${session.id}`}
      data-status={session.status}
      onClick={onSelect}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      className={cn(
        'group relative inline-flex h-9 max-w-[220px] cursor-pointer select-none items-center gap-2 rounded-t-md border-x border-t px-3 text-xs btn-press',
        active
          ? 'border-[var(--border-default)] border-b-transparent bg-[var(--bg-elevated)] text-[var(--fg-primary)]'
          : isClosed
            ? 'border-transparent text-[var(--fg-muted)] hover:bg-[var(--bg-inset)]'
            : 'border-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)]',
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--accent-primary)]"
        />
      ) : null}

      <button
        type="button"
        aria-label="Drag to reorder"
        className="-ml-1 cursor-grab text-[var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
        data-testid={`session-tab-handle-${session.id}`}
      >
        <GripVertical className="h-3 w-3" aria-hidden="true" />
      </button>

      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: dot.color }}
        title={dot.label}
      />

      <span className="truncate font-medium">
        {isClosed ? <s className="opacity-80">{session.title}</s> : session.title}
      </span>

      {session.status === 'creating' ? (
        <Loader2 className="h-3 w-3 animate-spin text-[var(--accent-cyan)]" aria-hidden="true" />
      ) : null}

      {isClosed ? (
        <button
          type="button"
          aria-label={`Reopen ${session.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onReopen();
          }}
          className="ml-1 rounded p-0.5 text-[var(--accent-cyan)] opacity-70 transition-opacity hover:bg-[rgba(34,211,238,0.12)] hover:opacity-100"
          data-testid={`session-tab-reopen-${session.id}`}
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Close ${session.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            'ml-1 rounded p-0.5 text-[var(--fg-muted)] transition-opacity',
            'hover:bg-[rgba(244,63,94,0.12)] hover:text-[var(--accent-rose)]',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          data-testid={`session-tab-close-${session.id}`}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}

      {/* Overflow menu — available on every tab for power users. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Tab actions"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'ml-0.5 rounded p-0.5 text-[var(--fg-muted)] transition-opacity',
              'hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]',
              active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            data-testid={`session-tab-menu-${session.id}`}
          >
            <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          {isClosed ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onReopen();
              }}
              data-testid={`session-tab-menu-reopen-${session.id}`}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              Reopen session
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onClose();
              }}
              data-testid={`session-tab-menu-close-${session.id}`}
            >
              <X className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              Close session
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onRemove();
            }}
            className="text-[var(--accent-rose)] focus:text-[var(--accent-rose)]"
            data-testid={`session-tab-menu-remove-${session.id}`}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Remove permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  );
}

const SLIDE_IN_WINDOW_MS = 1500;

export interface SessionTabsProps {
  onNewSession: () => void;
}

export function SessionTabs({ onNewSession }: SessionTabsProps) {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const setActive = useTerminalStore((s) => s.setActiveSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const reopenSession = useTerminalStore((s) => s.reopenSession);
  const removeSession = useTerminalStore((s) => s.removeSession);
  const reorderSessions = useTerminalStore((s) => s.reorderSessions);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sessions.map((s) => s.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    reorderSessions(arrayMove(ids, from, to));
  };

  const freshIds = React.useMemo(() => {
    const cutoff = Date.now() - SLIDE_IN_WINDOW_MS;
    return new Set(
      sessions
        .filter(
          (s) =>
            new Date(s.createdAt).getTime() > cutoff &&
            s.status === 'creating',
        )
        .map((s) => s.id),
    );
  }, [sessions]);

  return (
    <div
      role="tablist"
      aria-label="Terminal sessions"
      data-testid="session-tabs"
      className="flex items-end gap-1 overflow-x-auto border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-2 pt-1.5"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sessions.map((s) => s.id)}
          strategy={horizontalListSortingStrategy}
        >
          <AnimatePresence>
            {sessions.map((s) => (
              <SortableTab
                key={s.id}
                session={s}
                active={activeId === s.id}
                isFresh={freshIds.has(s.id)}
                onSelect={() => setActive(s.id)}
                onClose={() => closeSession(s.id)}
                onReopen={() => reopenSession(s.id)}
                onRemove={() => removeSession(s.id)}
              />
            ))}
          </AnimatePresence>
        </SortableContext>
      </DndContext>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mb-1 ml-1 h-7 w-7 text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
        onClick={onNewSession}
        aria-label="New session"
        data-testid="session-tabs-new"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
