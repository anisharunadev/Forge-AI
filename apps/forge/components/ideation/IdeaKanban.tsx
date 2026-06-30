'use client';

/**
 * Ideation Center — Kanban (Step 5 default view).
 *
 * 5 columns: Captured / Scoring / Approved / In PRD / Archived.
 * Drag-and-drop via @dnd-kit/core + @dnd-kit/sortable.
 * Keyboard-operable: KeyboardSensor (Space pickup, arrows move, Space drop, Esc cancel).
 * Optimistic updates only; persist is a console.log stub.
 * Step 1 design tokens; prefers-reduced-motion respected.
 */

import * as React from 'react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  defaultAnnouncements,
  defaultScreenReaderInstructions,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MessageSquare, MoreHorizontal, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Idea, IdeaStatus } from '@/lib/ideation/data';
import { EmptyState } from '@/src/components/empty-state';
import { Lightbulb } from 'lucide-react';

export type KanbanColumnKey =
  | 'captured'
  | 'scoring'
  | 'approved'
  | 'in_prd'
  | 'archived';

export const KANBAN_COLUMNS: ReadonlyArray<{
  key: KanbanColumnKey;
  label: string;
  dotColor: string;
  pulse?: boolean;
  ideaStatuses: ReadonlyArray<IdeaStatus>;
}> = [
  {
    key: 'captured',
    label: 'Captured',
    dotColor: 'var(--fg-muted)',
    ideaStatuses: ['intake', 'rejected'],
  },
  {
    key: 'scoring',
    label: 'Scoring',
    dotColor: 'var(--accent-cyan)',
    pulse: true,
    ideaStatuses: ['scoring', 'discovery'],
  },
  {
    key: 'approved',
    label: 'Approved',
    dotColor: 'var(--accent-emerald)',
    ideaStatuses: ['approved'],
  },
  {
    key: 'in_prd',
    label: 'In PRD',
    dotColor: 'var(--accent-violet)',
    ideaStatuses: ['prd'],
  },
  {
    key: 'archived',
    label: 'Archived',
    dotColor: 'var(--fg-muted)',
    ideaStatuses: ['shipped'],
  },
];

function scoreChipClass(score: number): string {
  if (score <= 3) return 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]';
  if (score <= 6) return 'bg-[rgba(245,158,11,0.12)] text-[var(--accent-amber)]';
  if (score <= 8) return 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]';
  return 'bg-[rgba(168,85,247,0.12)] text-[var(--accent-violet)]';
}

function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        pulse && 'animate-[pulse-glow_2.4s_ease-in-out_infinite]',
      )}
      style={{ background: color }}
    />
  );
}

function SortableIdeaCard({
  idea,
  onSelect,
  onMenu,
}: {
  idea: Idea;
  onSelect?: (idea: Idea) => void;
  onMenu?: (idea: Idea) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: idea.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      data-testid="kanban-card"
      data-idea-id={idea.id}
      className={cn(
        'group flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[14px] transition-[border,transform,box-shadow] duration-200 ease-out-soft',
        'hover:-translate-y-px hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]',
        isDragging && 'scale-[1.02] rotate-1 opacity-90 shadow-[var(--shadow-lg)]',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onSelect?.(idea)}
          className="line-clamp-2 text-left text-sm font-medium text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] rounded-sm"
        >
          {idea.title}
        </button>
        <span
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-mono"
          data-testid="kanban-score-chip"
          data-score={idea.score}
        >
          <span
            className="h-1.5 w-6 rounded-full"
            style={{
              background: `linear-gradient(to right, currentColor ${(idea.score / 10) * 100}%, var(--bg-inset) 0%)`,
            }}
            aria-hidden="true"
          />
          <span className={scoreChipClass(idea.score)}>{idea.score.toFixed(1)}</span>
        </span>
      </header>

      <p className="line-clamp-2 text-xs text-[var(--fg-secondary)]">{idea.summary}</p>

      <footer className="mt-1 flex items-center justify-between text-[var(--fg-tertiary)]">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)] font-mono text-[10px] text-[var(--fg-primary)]"
            aria-label={`Owner ${idea.owner}`}
          >
            {idea.ownerAvatar}
          </span>
          <span className="font-mono text-[10px]">
            {new Date(idea.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: '2-digit',
            })}
          </span>
          <span className="inline-flex items-center gap-0.5 font-mono text-[10px]">
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            {idea.tags.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag handle for ${idea.title}`}
            data-testid="kanban-drag-handle"
            className="cursor-grab text-[var(--fg-muted)] opacity-0 transition-opacity duration-150 ease-out-soft group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMenu?.(idea)}
            aria-label={`More actions for ${idea.title}`}
            data-testid="kanban-card-menu"
            className="text-[var(--fg-muted)] opacity-0 transition-opacity duration-150 ease-out-soft group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </article>
  );
}

function KanbanColumn({
  column,
  ideas,
  onSelect,
  onAddNew,
  onMenu,
  isOver,
}: {
  column: (typeof KANBAN_COLUMNS)[number];
  ideas: ReadonlyArray<Idea>;
  onSelect?: (idea: Idea) => void;
  onAddNew?: (key: KanbanColumnKey) => void;
  onMenu?: (idea: Idea) => void;
  isOver: boolean;
}) {
  // ponytail: useDroppable gives every column (including empties) a
  // valid drop target. Without this, keyboard users navigating to an
  // empty column have nowhere to drop — closestCorners only matches
  // card ids, so the empty-state placeholder swallows the drop.
  const { setNodeRef, isOver: isDroppableOver } = useDroppable({
    id: column.key,
  });
  const showHighlight = isOver || isDroppableOver;
  return (
    <section
      aria-label={column.label}
      data-testid={`kanban-column-${column.key}`}
      className={cn(
        'flex h-full min-w-[260px] flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 transition-colors duration-200 ease-out-soft',
        showHighlight && 'bg-[rgba(99,102,241,0.06)]',
      )}
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-[var(--bg-base)] pb-1">
        <div className="flex items-center gap-2">
          <StatusDot color={column.dotColor} pulse={column.pulse} />
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{column.label}</h3>
          <span
            className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]"
            data-testid={`kanban-count-${column.key}`}
          >
            {ideas.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onAddNew?.(column.key)}
          aria-label={`Add idea to ${column.label}`}
          data-testid={`kanban-add-${column.key}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] transition-colors duration-150 ease-out-soft hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>

      <SortableContext items={ideas.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex min-h-[120px] flex-1 flex-col gap-3 overflow-y-auto pb-2 thin-scrollbar"
          data-testid={`kanban-column-body-${column.key}`}
        >
          {ideas.length === 0 ? (
            <div
              className="flex flex-1 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] py-8 text-xs text-[var(--fg-muted)]"
              data-testid={`kanban-empty-${column.key}`}
            >
              Drop ideas here
            </div>
          ) : (
            ideas.map((idea) => (
              <SortableIdeaCard key={idea.id} idea={idea} onSelect={onSelect} onMenu={onMenu} />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export interface IdeaKanbanProps {
  ideas: ReadonlyArray<Idea>;
  onSelect?: (idea: Idea) => void;
  onAddNew?: (key: KanbanColumnKey) => void;
  onMenu?: (idea: Idea) => void;
  onMove?: (ideaId: string, toColumn: KanbanColumnKey) => void;
}

export function IdeaKanban({ ideas, onSelect, onAddNew, onMenu, onMove }: IdeaKanbanProps) {
  const [overColumn, setOverColumn] = React.useState<KanbanColumnKey | null>(null);
  const [localIdeas, setLocalIdeas] = React.useState<ReadonlyArray<Idea>>(ideas);

  React.useEffect(() => {
    setLocalIdeas(ideas);
  }, [ideas]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ideasByColumn = React.useMemo(() => {
    const map: Record<KanbanColumnKey, Idea[]> = {
      captured: [],
      scoring: [],
      approved: [],
      in_prd: [],
      archived: [],
    };
    for (const idea of localIdeas) {
      for (const col of KANBAN_COLUMNS) {
        if (col.ideaStatuses.includes(idea.status)) {
          map[col.key].push(idea);
          break;
        }
      }
    }
    return map;
  }, [localIdeas]);

  const findColumnOfIdea = (id: string): KanbanColumnKey | null => {
    for (const col of KANBAN_COLUMNS) {
      if (ideasByColumn[col.key].some((i) => i.id === id)) return col.key;
    }
    return null;
  };

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setOverColumn(null);
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);

      const activeCol = findColumnOfIdea(activeId);
      if (!activeCol) return;

      // over can be a column key (drop on body) or an idea id (reorder/transfer)
      const overCol =
        (KANBAN_COLUMNS.find((c) => c.key === overId)?.key) ?? findColumnOfIdea(overId);
      if (!overCol) return;

      if (activeCol === overCol && activeId !== overId) {
        // Same column reorder
        const col = ideasByColumn[activeCol];
        const oldIdx = col.findIndex((i) => i.id === activeId);
        const newIdx = col.findIndex((i) => i.id === overId);
        if (oldIdx < 0 || newIdx < 0) return;
        const reordered = arrayMove(col, oldIdx, newIdx);
        setLocalIdeas((curr) => {
          const others = curr.filter((i) => !col.some((c) => c.id === i.id));
          return [...others, ...reordered];
        });
      } else if (activeCol !== overCol) {
        // Cross-column move
        const statusForCol = KANBAN_COLUMNS.find((c) => c.key === overCol)?.ideaStatuses[0];
        if (!statusForCol) return;
        setLocalIdeas((curr) =>
          curr.map((i) => (i.id === activeId ? { ...i, status: statusForCol } : i)),
        );
        // eslint-disable-next-line no-console
        console.info('[ideation:kanban] move', { ideaId: activeId, from: activeCol, to: overCol });
        onMove?.(activeId, overCol);
      }
    },
    [ideasByColumn, onMove],
  );

  if (localIdeas.length === 0) {
    return (
      <div className="card" data-testid="kanban-empty-board">
        <EmptyState
          illustration={<Lightbulb size={40} strokeWidth={1.5} />}
          title="Capture your first idea"
          description="Drop in a rough thought — AI will score it and draft a PRD."
          primaryAction={
            onAddNew ? { label: 'New Idea', onClick: () => onAddNew('captured') } : undefined
          }
          suggestions={['AI code reviewer', 'Slack summarizer', 'Invoice parser']}
        />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      // ponytail: default announcements + screen-reader instructions
      // cover pickup / move / drop / cancel. `restoreFocus` returns
      // focus to the moved card after drop so keyboard users land
      // where they expect. Without this prop dnd-kit runs silently
      // for assistive tech.
      accessibility={{
        announcements: defaultAnnouncements,
        screenReaderInstructions: defaultScreenReaderInstructions,
        restoreFocus: true,
      }}
      onDragOver={(e: { over: { id: string | number } | null }) => {
        const overId = e.over ? String(e.over.id) : null;
        if (!overId) {
          setOverColumn(null);
          return;
        }
        const col = KANBAN_COLUMNS.find((c) => c.key === overId)?.key ?? findColumnOfIdea(overId);
        setOverColumn(col);
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setOverColumn(null)}
    >
      <div
        className="grid grid-cols-5 gap-4 overflow-x-auto pb-2 thin-scrollbar"
        data-testid="idea-kanban"
      >
        {KANBAN_COLUMNS.map((col) => (
          <KanbanColumn
            key={col.key}
            column={col}
            ideas={ideasByColumn[col.key]}
            onSelect={onSelect}
            onAddNew={onAddNew}
            onMenu={onMenu}
            isOver={overColumn === col.key}
          />
        ))}
      </div>
    </DndContext>
  );
}
