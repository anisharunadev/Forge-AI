'use client';

/**
 * Architecture Center — Risk Register kanban (Step 5 @dnd-kit + Step 6 vocab).
 *
 * Three columns: Open · Mitigating · Closed. Severity badge + owner +
 * linked ADR. Drag with @dnd-kit PointerSensor; optimistic local state
 * only (persist is a `console.info` stub — backend wiring tracked in
 * /v1/architecture/risk-registers).
 *
 * Skill influence:
 *   - `08-empty-ux.md` — empty column reads "All clear — no risks".
 *   - `prefers-reduced-motion` — `AnimatePresence` cards collapse to
 *     instant transitions under the global media query.
 */

import * as React from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';
import type { Risk, RiskRegister } from '@/lib/architecture/data';

type RiskStatus = Risk['status'];

const COLUMNS: ReadonlyArray<{ id: RiskStatus; label: string; tone: string }> = [
  { id: 'open', label: 'Open', tone: 'border-[var(--accent-rose)]/40 bg-[rgba(244,63,94,0.10)] text-[var(--accent-rose)]' },
  { id: 'mitigating', label: 'Mitigating', tone: 'border-[var(--accent-cyan)]/40 bg-[rgba(34,211,238,0.10)] text-[var(--accent-cyan)]' },
  { id: 'closed', label: 'Closed', tone: 'border-[var(--accent-emerald)]/40 bg-[rgba(16,185,129,0.10)] text-[var(--accent-emerald)]' },
];

function severityTone(score: number): string {
  if (score >= 16) return 'border-[var(--accent-rose)] bg-[rgba(244,63,94,0.15)] text-[var(--accent-rose)]';
  if (score >= 9) return 'border-[var(--accent-amber)] bg-[rgba(245,158,11,0.15)] text-[var(--accent-amber)]';
  return 'border-[var(--accent-emerald)] bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]';
}

function severityLabel(score: number): 'Critical' | 'High' | 'Med' | 'Low' {
  if (score >= 20) return 'Critical';
  if (score >= 12) return 'High';
  if (score >= 6) return 'Med';
  return 'Low';
}

function RiskCard({ risk, adrLabel }: { risk: Risk; adrLabel?: string }) {
  const score = risk.likelihood * risk.impact;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: risk.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      {...attributes}
      {...listeners}
      data-testid={`risk-card-${risk.id}`}
      className={cn(
        'group cursor-grab rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-sm)]',
        'hover:border-[var(--border-default)] active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight text-[var(--fg-primary)]">
          {risk.title}
        </p>
        <span
          className={cn(
            'inline-flex shrink-0 rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[10px] font-semibold',
            severityTone(score),
          )}
          aria-label={`Severity ${severityLabel(score)} score ${score}`}
        >
          {severityLabel(score)} · {score}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs text-[var(--fg-secondary)]">
        {risk.mitigation}
      </p>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[10px] text-[var(--fg-tertiary)]">
        <span className="font-mono">L{risk.likelihood}·I{risk.impact}</span>
        <div className="flex items-center gap-1.5">
          {adrLabel ? (
            <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono">
              {adrLabel}
            </span>
          ) : null}
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-primary)]">
            {risk.owner.slice(0, 1).toUpperCase()}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export interface RiskRegisterKanbanProps {
  register: RiskRegister | null;
  adrIndex: Readonly<Record<string, string>>;
}

export function RiskRegisterKanban({ register, adrIndex }: RiskRegisterKanbanProps) {
  const initial = React.useMemo(() => {
    if (!register) return { open: [], mitigating: [], closed: [] } as Record<RiskStatus, Risk[]>;
    const map: Record<RiskStatus, Risk[]> = { open: [], mitigating: [], closed: [] };
    for (const r of register.risks) map[r.status].push(r);
    return map;
  }, [register]);
  const [columns, setColumns] = React.useState(initial);
  React.useEffect(() => setColumns(initial), [initial]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!register) {
    return (
      <div data-testid="risk-kanban-empty">
        <EmptyState
          illustration={<ShieldAlert size={40} strokeWidth={1.5} />}
          title="No risk register yet"
          description="Risk registers surface threats and mitigations across every ADR."
        />
      </div>
    );
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const sourceCol = COLUMNS.find((c) => columns[c.id].some((r) => r.id === activeId))?.id;
    const targetCol = COLUMNS.find((c) => c.id === overId || columns[c.id].some((r) => r.id === overId))?.id;
    if (!sourceCol || !targetCol) return;
    if (sourceCol === targetCol) {
      const arr = columns[sourceCol];
      const from = arr.findIndex((r) => r.id === activeId);
      const to = arr.findIndex((r) => r.id === overId);
      if (from === -1 || to === -1 || from === to) return;
      setColumns((prev) => ({ ...prev, [sourceCol]: arrayMove(arr, from, to) }));
    } else {
      const next = { ...columns };
      next[sourceCol] = next[sourceCol].filter((r) => r.id !== activeId);
      const moved = columns[sourceCol].find((r) => r.id === activeId);
      if (!moved) return;
      next[targetCol] = [{ ...moved, status: targetCol }, ...next[targetCol]];
      setColumns(next);
      // eslint-disable-next-line no-console
      console.info('[architecture] risk moved', { id: activeId, to: targetCol });
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
        data-testid="risk-kanban"
        data-register-id={register.id}
      >
        {COLUMNS.map((col) => (
          <div
            key={col.id}
            data-testid={`risk-col-${col.id}`}
            className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
          >
            <header className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs font-medium',
                  col.tone,
                )}
              >
                {col.label}
                <span className="font-mono text-[10px] opacity-80">
                  {columns[col.id].length}
                </span>
              </span>
            </header>
            <SortableContext items={columns[col.id].map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <div className="flex min-h-[60px] flex-col gap-2">
                <AnimatePresence>
                  {columns[col.id].map((risk) => (
                    <RiskCard
                      key={risk.id}
                      risk={risk}
                      adrLabel={adrIndex[risk.id]}
                    />
                  ))}
                </AnimatePresence>
                {columns[col.id].length === 0 ? (
                  <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] p-3 text-center text-[10px] text-[var(--fg-muted)]">
                    All clear — no risks
                  </p>
                ) : null}
              </div>
            </SortableContext>
          </div>
        ))}
      </div>
    </DndContext>
  );
}