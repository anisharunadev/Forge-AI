'use client';

/**
 * RoadmapTimeline — quarterly horizontal timeline (Step 5).
 *
 * Groups roadmap items by `quarter` (e.g. "2026 Q3") into columns.
 * Items can be moved between quarters via dnd-kit KeyboardSensor.
 * Optimistic move with console.log persist.
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, MapPin } from 'lucide-react';

import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';
import type { RoadmapItem } from '@/lib/ideation/data';

function effortChip(effort: 'S' | 'M' | 'L'): string {
  if (effort === 'S') return 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]';
  if (effort === 'M') return 'bg-[rgba(245,158,11,0.12)] text-[var(--accent-amber)]';
  return 'bg-[rgba(244,63,94,0.12)] text-[var(--accent-rose)]';
}

function SortableRoadmapCard({
  item,
  onSelect,
}: {
  item: RoadmapItem;
  onSelect?: (item: RoadmapItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <article
      ref={setNodeRef}
      style={style}
      data-testid={`roadmap-card-${item.id}`}
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-[border,box-shadow] duration-200 ease-out-soft',
        'hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]',
        isDragging && 'scale-[1.02] shadow-[var(--shadow-lg)]',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect?.(item)}
        className="text-left text-sm font-medium text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] rounded-sm"
      >
        {item.title}
      </button>
      <div className="flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
        <span className="font-mono">{item.owner}</span>
        <span className={cn('rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono', effortChip(item.effort))}>
          {item.effort}
        </span>
      </div>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${item.title} between quarters`}
        data-testid={`roadmap-drag-${item.id}`}
        className="cursor-grab text-[10px] text-[var(--fg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] active:cursor-grabbing"
      >
        ⠿ drag to change quarter
      </button>
    </article>
  );
}

export interface RoadmapTimelineProps {
  items: ReadonlyArray<RoadmapItem>;
  onSelect?: (item: RoadmapItem) => void;
  onMoveQuarter?: (itemId: string, toQuarter: string) => void;
}

export function RoadmapTimeline({ items, onSelect, onMoveQuarter }: RoadmapTimelineProps) {
  const [local, setLocal] = React.useState(items);
  React.useEffect(() => setLocal(items), [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const quarters = React.useMemo(() => {
    const set = new Set<string>(local.map((i) => i.quarter));
    if (set.size === 0) set.add(`${new Date().getFullYear()} Q${Math.floor(new Date().getMonth() / 3) + 1}`);
    return Array.from(set).sort();
  }, [local]);

  const byQuarter = React.useMemo(() => {
    const m: Record<string, RoadmapItem[]> = {};
    for (const q of quarters) m[q] = [];
    for (const it of local) (m[it.quarter] ??= []).push(it);
    return m;
  }, [local, quarters]);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const overQ = quarters.find((q) => q === overId);
    const targetItem = local.find((i) => i.id === overId);
    const targetQuarter = overQ ?? targetItem?.quarter;
    if (!targetQuarter) return;
    const activeItem = local.find((i) => i.id === activeId);
    if (!activeItem) return;
    if (activeItem.quarter === targetQuarter && activeId !== overId) {
      const colArr = byQuarter[targetQuarter] ?? [];
      const oldIdx = colArr.findIndex((i) => i.id === activeId);
      const newIdx = colArr.findIndex((i) => i.id === overId);
      if (oldIdx < 0 || newIdx < 0) return;
      const reordered = arrayMove(colArr, oldIdx, newIdx);
      setLocal((curr) => {
        const others = curr.filter((i) => i.quarter !== targetQuarter);
        return [...others, ...reordered];
      });
    } else if (activeItem.quarter !== targetQuarter) {
      setLocal((curr) =>
        curr.map((i) => (i.id === activeId ? { ...i, quarter: targetQuarter } : i)),
      );
      // eslint-disable-next-line no-console
      console.info('[ideation:roadmap] move-quarter', {
        itemId: activeId,
        from: activeItem.quarter,
        to: targetQuarter,
      });
      onMoveQuarter?.(activeId, targetQuarter);
    }
  };

  if (local.length === 0) {
    return (
      <div className="card">
        <EmptyState
          illustration={<Calendar size={40} strokeWidth={1.5} />}
          title="No ideas in the roadmap"
          description="Approve ideas to move them onto the roadmap by quarter."
        />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
    >
      <div
        className="grid gap-4 overflow-x-auto pb-2 thin-scrollbar"
        style={{ gridTemplateColumns: `repeat(${quarters.length}, minmax(220px, 1fr))` }}
        data-testid="roadmap-timeline"
      >
        {quarters.map((q) => {
          const qItems = byQuarter[q] ?? [];
          return (
            <section
              key={q}
              data-testid={`roadmap-quarter-${q}`}
              aria-label={q}
              className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
            >
              <header className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{q}</h3>
                </div>
                <span
                  className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]"
                  data-testid={`roadmap-count-${q}`}
                >
                  {qItems.length}
                </span>
              </header>
              <SortableContext
                id={q}
                items={qItems.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  className="flex min-h-[120px] flex-col gap-2"
                  data-testid={`roadmap-quarter-body-${q}`}
                >
                  {qItems.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] py-8 text-xs text-[var(--fg-muted)]">
                      Drop roadmap items here
                    </div>
                  ) : (
                    qItems.map((item) => (
                      <SortableRoadmapCard key={item.id} item={item} onSelect={onSelect} />
                    ))
                  )}
                </div>
              </SortableContext>
            </section>
          );
        })}
      </div>
    </DndContext>
  );
}
