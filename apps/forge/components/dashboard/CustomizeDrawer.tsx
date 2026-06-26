'use client';

/**
 * Zone 4 — Customize Drawer (Step 26 polish).
 *
 * Slide-in panel that PUSHES the dashboard content rather than
 * overlaying it (Fix 1). Default width 360 px. Layout:
 *
 *   ┌──────────────────────────────────────────┬────────────────┐
 *   │  dashboard bento content                 │  Customize    │
 *   │                                          │  · widgets    │
 *   │                                          │  · presets    │
 *   │                                          │  · refresh    │
 *   │                                          │  · density    │
 *   └──────────────────────────────────────────┴────────────────┘
 *
 *   grid-template-columns: 1fr 360px          (transitions 250ms)
 *
 * Close behavior: Esc, click outside (not on the dashboard), or the
 * header X button all close it. Body content shifts back smoothly.
 *
 * Drag-to-reorder (Fix 6) — each widget row has a grip handle and
 * can be reordered via @dnd-kit. Order persists in localStorage
 * via `widgetOrder`.
 *
 * Mobile (<1024 px): the drawer becomes a Sheet sliding up from the
 * bottom with a backdrop blur.
 *
 * Skill influence:
 *   - `ux` (Reduced Motion) — drag + push transitions both honor
 *     prefers-reduced-motion.
 *   - `ux` (Confirmation Messages) — "Reset" still prompts.
 */

import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, RotateCcw, X } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  ALL_WIDGETS,
  type DashboardPrefs,
  type RefreshInterval,
  type WidgetId,
  useDashboardPrefs,
} from './preferences';
import type { DashboardSnapshot } from './mock-data';
import type { PinnedItem } from './types';

const WIDGET_LABELS: Record<WidgetId, { name: string; description: string; rowId: string }> = {
  'kpi-strip': { name: 'KPI Strip', description: 'Six headline metrics with sparklines', rowId: 'row-kpi' },
  'live-activity': { name: 'Live activity', description: 'Real-time run stream', rowId: 'row-1' },
  'your-agents': { name: 'Your agents', description: 'Mini-card grid of registered agents', rowId: 'row-1' },
  'today-runs': { name: "Today's runs", description: '24h horizontal timeline', rowId: 'row-1' },
  'cost-breakdown': { name: 'Cost breakdown', description: 'Cost by category (radial)', rowId: 'row-2' },
  'runs-over-time': { name: 'Runs over time', description: 'Stacked area, last 24h', rowId: 'row-2' },
  'top-agents': { name: 'Top agents', description: 'Bar chart of busiest agents', rowId: 'row-2' },
  'pending-approvals': { name: 'Pending approvals', description: 'ADRs and deploys awaiting you', rowId: 'row-3' },
  'recent-ideas': { name: 'Recent ideas', description: 'Latest ideation entries', rowId: 'row-3' },
  'ai-insights': { name: 'AI insights', description: 'Co-pilot generated daily digest', rowId: 'row-4' },
  'personal-stats': { name: 'Personal stats', description: 'Your contribution this week', rowId: 'row-4' },
  pinned: { name: 'Pinned', description: 'Quick-access shortcuts', rowId: 'row-5' },
  'quick-actions': { name: 'Quick actions', description: 'One-click commands', rowId: 'row-5' },
  'team-activity': { name: 'Team activity', description: "What teammates are doing", rowId: 'row-6' },
  'recent-alerts': { name: 'Recent alerts', description: 'Inbox-style notifications', rowId: 'row-7' },
};

const PRESETS: ReadonlyArray<{
  id: 'engineering-lead' | 'product-manager' | 'operator';
  name: string;
  description: string;
}> = [
  { id: 'engineering-lead', name: 'Engineering Lead', description: 'Runs, cost, agents, performance' },
  { id: 'product-manager', name: 'Product Manager', description: 'Ideas, approvals, team insights' },
  { id: 'operator', name: 'Operator', description: 'Minimal, focused on what is broken' },
];

const REFRESH_OPTIONS: ReadonlyArray<{ value: RefreshInterval; label: string }> = [
  { value: 'realtime', label: 'Real-time' },
  { value: '30s', label: 'Every 30s' },
  { value: '5m', label: 'Every 5m' },
  { value: 'manual', label: 'Manual' },
];

const DRAWER_WIDTH = 360; // px — Fix 1 spec

// ---------------------------------------------------------------------------
//  Push Drawer — grid 1fr {DRAWER_WIDTH}px
// ---------------------------------------------------------------------------

export interface CustomizeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ref to the bento content container so we can scroll-to on row click. */
  bentoAnchor?: string; // CSS selector
}

export function CustomizeDrawer({ open, onOpenChange, bentoAnchor = '[data-testid="mission-control"]' }: CustomizeDrawerProps) {
  const { prefs, mounted, toggleWidget, reorderWidgets, applyPreset, resetToDefault, setRefresh, setDensity } =
    useDashboardPrefs();

  // Esc to close (the sheet already handles its own focus trap, but we
  // also want it to close when in push mode and user hits Esc).
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const jumpToWidget = React.useCallback(
    (w: WidgetId) => {
      const rowId = WIDGET_LABELS[w].rowId;
      const target = document.querySelector(`[data-row-id="${rowId}"]`);
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('tile-pulse');
        setTimeout(() => target.classList.remove('tile-pulse'), 1100);
      }
      onOpenChange(false);
      // bentoAnchor currently unused but kept for future "close + return focus"
      void bentoAnchor;
    },
    [onOpenChange, bentoAnchor],
  );

  // Mobile: render as Sheet; Desktop: render as a fixed push panel
  // alongside the bento content. We always wrap both layouts and let
  // CSS choose (Sheet is only mounted when open too).
  return (
    <>
      {/* Desktop push panel — always present, animates open/closed via translate. */}
      <aside
        aria-label="Customize dashboard"
        aria-hidden={!open}
        data-testid="customize-push-drawer"
        data-state={open ? 'open' : 'closed'}
        className={cn(
          'hidden lg:flex shrink-0 flex-col overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]',
          'transition-[width,opacity] duration-[250ms] ease-out',
          open ? 'opacity-100' : 'pointer-events-none w-0 opacity-0 overflow-hidden',
        )}
        style={open ? { width: DRAWER_WIDTH } : { width: 0 }}
      >
        <DrawerBody
          mounted={mounted}
          prefs={prefs}
          onReset={() => {
            if (window.confirm('Reset all dashboard widgets to defaults?')) resetToDefault();
          }}
          onClose={() => onOpenChange(false)}
          onToggle={toggleWidget}
          onReorder={reorderWidgets}
          onApplyPreset={applyPreset}
          onSetRefresh={setRefresh}
          onSetDensity={setDensity}
          onJumpTo={jumpToWidget}
          variant="push"
        />
      </aside>

      {/* Mobile sheet — slides up from bottom */}
      <div className="lg:hidden">
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            aria-describedby={undefined}
            className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden rounded-t-[var(--radius-xl)] border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0 backdrop-blur-md"
            data-testid="customize-drawer"
          >
            <SheetTitle className="sr-only">Customize dashboard</SheetTitle>
            <DrawerBody
              mounted={mounted}
              prefs={prefs}
              onReset={() => {
                if (window.confirm('Reset all dashboard widgets to defaults?')) resetToDefault();
              }}
              onClose={() => onOpenChange(false)}
              onToggle={toggleWidget}
              onReorder={reorderWidgets}
              onApplyPreset={applyPreset}
              onSetRefresh={setRefresh}
              onSetDensity={setDensity}
              onJumpTo={jumpToWidget}
              variant="sheet"
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

interface DrawerBodyProps {
  mounted: boolean;
  prefs: DashboardPrefs;
  onReset: () => void;
  onClose: () => void;
  onToggle: (w: WidgetId) => void;
  onReorder: (orderedIds: ReadonlyArray<WidgetId>) => void;
  onApplyPreset: (p: 'engineering-lead' | 'product-manager' | 'operator') => void;
  onSetRefresh: (r: RefreshInterval) => void;
  onSetDensity: (d: 'comfortable' | 'compact') => void;
  onJumpTo: (w: WidgetId) => void;
  variant: 'push' | 'sheet';
}

function DrawerBody(props: DrawerBodyProps) {
  const { mounted, prefs, onReset, onClose, onToggle, onReorder, onApplyPreset, onSetRefresh, onSetDensity, onJumpTo, variant } = props;

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">
            Customize dashboard
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--accent-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            data-testid="customize-reset"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset
          </button>
          <Button type="button" size="sm" onClick={onClose} data-testid="customize-done">
            Done
          </Button>
          {variant === 'push' ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close customize drawer"
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="thin-scrollbar flex-1 space-y-6 overflow-y-auto p-4">
        {/* Widgets — drag-to-reorder (Fix 6) */}
        <Section title="Widgets" hint="Drag to reorder. Click name to jump.">
          <DndContext sensors={useSensorsFn()} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(e, prefs, onReorder)}>
            <SortableContext items={prefs.widgetOrder as WidgetId[]} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1" data-testid="customize-widget-list">
                {prefs.widgetOrder.map((w) => (
                  <SortableWidgetRow
                    key={w}
                    id={w}
                    on={prefs.visibility[w]}
                    mounted={mounted}
                    onToggle={() => onToggle(w)}
                    onJump={() => onJumpTo(w)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </Section>

        {/* Presets */}
        <Section title="Presets">
          <ul className="space-y-2">
            {PRESETS.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
              >
                <PresetThumbnail id={p.id} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">{p.name}</p>
                  <p className="truncate text-[11px] text-[var(--fg-tertiary)]">{p.description}</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => onApplyPreset(p.id)} disabled={!mounted}>
                  Apply
                </Button>
              </li>
            ))}
          </ul>
        </Section>

        {/* Refresh interval */}
        <Section title="Refresh interval">
          <div className="grid grid-cols-2 gap-2">
            {REFRESH_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-[var(--text-sm)]',
                  prefs.refresh === opt.value ? 'border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/40' : '',
                )}
              >
                <input
                  type="radio"
                  name="refresh"
                  value={opt.value}
                  checked={prefs.refresh === opt.value}
                  onChange={() => onSetRefresh(opt.value)}
                  className="accent-[var(--accent-primary)]"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </Section>

        {/* Density */}
        <Section title="Density">
          <div className="grid grid-cols-2 gap-2">
            {(['comfortable', 'compact'] as const).map((d) => (
              <label
                key={d}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-[var(--text-sm)] capitalize',
                  prefs.density === d ? 'border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/40' : '',
                )}
              >
                <input
                  type="radio"
                  name="density"
                  value={d}
                  checked={prefs.density === d}
                  onChange={() => onSetDensity(d)}
                  className="accent-[var(--accent-primary)]"
                />
                {d}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--fg-tertiary)]">
            Compact reduces tile padding for users who want maximum density.
          </p>
        </Section>
      </div>
    </div>
  );
}

function useSensorsFn() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

function handleDragEnd(
  event: DragEndEvent,
  prefs: DashboardPrefs,
  onReorder: (orderedIds: ReadonlyArray<WidgetId>) => void,
) {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const ids = prefs.widgetOrder as WidgetId[];
  const from = ids.indexOf(active.id as WidgetId);
  const to = ids.indexOf(over.id as WidgetId);
  if (from < 0 || to < 0) return;
  onReorder(arrayMove(ids, from, to));
}

function SortableWidgetRow({
  id,
  on,
  mounted,
  onToggle,
  onJump,
}: {
  id: WidgetId;
  on: boolean;
  mounted: boolean;
  onToggle: () => void;
  onJump: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
    boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.35)' : undefined,
  };
  const meta = WIDGET_LABELS[id];
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2',
        isDragging ? 'opacity-90' : '',
      )}
      data-testid={`customize-widget-${id}`}
      data-dragging={isDragging ? 'true' : 'false'}
    >
      <button
        type="button"
        aria-label={`Drag to reorder ${meta.name}`}
        className="cursor-grab text-[var(--fg-tertiary)] opacity-0 transition-opacity hover:text-[var(--fg-primary)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
        data-testid={`customize-drag-${id}`}
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onJump}
        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        data-testid={`customize-jump-${id}`}
      >
        <p className="truncate text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">{meta.name}</p>
        <p className="truncate text-[11px] text-[var(--fg-tertiary)]">{meta.description}</p>
      </button>
      <Switch
        checked={on}
        onCheckedChange={onToggle}
        aria-label={`Toggle ${meta.name}`}
        disabled={!mounted}
      />
    </li>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          {title}
        </h3>
        {hint ? <span className="text-[10px] text-[var(--fg-muted)]">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function PresetThumbnail({ id }: { id: 'engineering-lead' | 'product-manager' | 'operator' }) {
  return (
    <div
      aria-hidden="true"
      className="grid h-12 w-20 shrink-0 gap-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1"
    >
      {id === 'engineering-lead' ? (
        <>
          <span className="col-span-3 h-1.5 rounded-sm bg-[var(--accent-primary)]/40" />
          <span className="col-span-2 h-2.5 rounded-sm bg-[var(--accent-cyan)]/30" />
          <span className="col-span-1 h-2.5 rounded-sm bg-[var(--accent-violet)]/30" />
          <span className="col-span-2 h-2.5 rounded-sm bg-[var(--accent-emerald)]/30" />
          <span className="col-span-1 h-2.5 rounded-sm bg-[var(--accent-amber)]/30" />
        </>
      ) : id === 'product-manager' ? (
        <>
          <span className="col-span-3 h-1.5 rounded-sm bg-[var(--accent-violet)]/40" />
          <span className="col-span-1 h-2.5 rounded-sm bg-[var(--accent-amber)]/30" />
          <span className="col-span-2 h-2.5 rounded-sm bg-[var(--accent-cyan)]/30" />
          <span className="col-span-3 h-2.5 rounded-sm bg-[var(--accent-emerald)]/30" />
        </>
      ) : (
        <>
          <span className="col-span-1 h-2.5 rounded-sm bg-[var(--accent-rose)]/30" />
          <span className="col-span-2 h-2.5 rounded-sm bg-[var(--accent-cyan)]/30" />
          <span className="col-span-3 h-2.5 rounded-sm bg-[var(--accent-amber)]/30" />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Pin Manager
// ---------------------------------------------------------------------------

export function PinManagerDrawer({
  open,
  onOpenChange,
  snapshot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: DashboardSnapshot;
}) {
  const { prefs, mounted, togglePin } = useDashboardPrefs();
  const pinnedSet = new Set(prefs.pins);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[420px]"
        data-testid="pin-manager-drawer"
      >
        <SheetTitle className="sr-only">Pin things for one-click access</SheetTitle>
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
          <div>
            <h2 className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">Pin things for one-click access</h2>
            <p className="text-[11px] text-[var(--fg-tertiary)]">Up to 8 pins. Click to add or remove.</p>
          </div>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </header>
        <ul className="thin-scrollbar flex-1 space-y-1 overflow-y-auto p-3">
          {snapshot.pinnedCatalog.map((item: PinnedItem) => {
            const isPinned = pinnedSet.has(item.id);
            const overCap = !isPinned && prefs.pins.length >= 8;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-tertiary)]">
                    {item.label.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">{item.label}</p>
                    <p className="truncate text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">{item.kind}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={isPinned ? 'outline' : 'default'}
                  onClick={() => togglePin(item.id)}
                  disabled={!mounted || overCap}
                  data-testid={`pin-toggle-${item.id}`}
                >
                  {isPinned ? 'Unpin' : 'Pin'}
                </Button>
              </li>
            );
          })}
        </ul>
        <footer className="border-t border-[var(--border-subtle)] p-3 text-[11px] text-[var(--fg-tertiary)]">
          {prefs.pins.length} / 8 pins
        </footer>
      </SheetContent>
    </Sheet>
  );
}

void ALL_WIDGETS; // keep export live for downstream imports