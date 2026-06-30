'use client';

/**
 * Stories Center — Hero Band (Step 21).
 *
 * Animated gradient border (`.hero-border`, defined in
 * `app/globals.css`) wraps the whole band so it pops without
 * shadow-soup. Top-right cluster hosts the sprint picker,
 * the view toggle, and the primary CTA.
 *
 * Skill influence:
 *   - Always show label above input (story priority filter etc.)
 *   - Use z-index scale 10/20/30/50 (no arbitrary values)
 *   - 4.5:1 contrast maintained via --fg-primary on --bg-surface
 */

import * as React from 'react';
import { Calendar, KanbanSquare, List, LayoutGrid, ListTodo, Plus } from 'lucide-react';

import type { Sprint, StoryView } from '@/lib/stories/types';
import { cn } from '@/lib/utils';

export interface HeroBandProps {
  readonly sprints: ReadonlyArray<Sprint>;
  readonly currentSprintId: string;
  readonly view: StoryView | 'lifecycle';
  readonly onViewChange: (view: StoryView | 'lifecycle') => void;
  readonly onNewStory: () => void;
  readonly onOpenShortcuts?: () => void;
  /** Optional extra element rendered between the view toggle and the
   *  primary CTA (e.g. the QuickActionsMenu). Step 38 Fix 8. */
  readonly rightExtra?: React.ReactNode;
}

export function HeroBand({
  sprints,
  currentSprintId,
  view,
  onViewChange,
  onNewStory,
  onOpenShortcuts,
  rightExtra,
}: HeroBandProps) {
  const [sprintOpen, setSprintOpen] = React.useState(false);
  const current = sprints.find((s) => s.id === currentSprintId) ?? sprints[0] ?? null;

  return (
    <section
      aria-labelledby="stories-hero-title"
      data-testid="stories-hero"
      className="hero-border overflow-hidden rounded-[var(--radius-xl)]"
    >
      <div className="relative rounded-[var(--radius-xl)] bg-[var(--bg-surface)] p-6 md:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          {/* Title block */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
              Center
            </p>
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[rgba(99,102,241,0.12)] text-[var(--accent-primary)]"
              >
                <ListTodo size={20} strokeWidth={1.8} />
              </span>
              <h1
                id="stories-hero-title"
                className="text-3xl font-bold leading-[var(--leading-3xl)] text-[var(--fg-primary)]"
              >
                Stories
              </h1>
            </div>
            <p className="max-w-2xl text-sm text-[var(--fg-secondary)]">
              Every user story across this project. Drag cards across columns to update
              status. Keyboard pickup is Space, arrow keys move, Space drops, Esc cancels.
            </p>
          </div>

          {/* Top-right cluster */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Sprint picker — Combobox-style. Native select with custom
                styling keeps it keyboard-accessible by default. */}
            <div className="relative">
              <label className="sr-only" htmlFor="stories-sprint">
                Sprint
              </label>
              <button
                type="button"
                id="stories-sprint"
                aria-haspopup="listbox"
                aria-expanded={sprintOpen}
                onClick={() => setSprintOpen((v) => !v)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)]',
                  'bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg-primary)]',
                  'hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                )}
                data-testid="stories-sprint-picker"
              >
                <Calendar size={14} aria-hidden="true" className="text-[var(--fg-tertiary)]" />
                <span className="font-medium">
                  {current ? current.name : 'No sprint'}
                </span>
                <span className="font-mono text-xs text-[var(--fg-tertiary)]">
                  {current ? `${current.start} → ${current.end}` : '—'}
                </span>
              </button>
              {sprintOpen ? (
                <ul
                  role="listbox"
                  aria-label="Sprint"
                  className="absolute right-0 z-30 mt-2 w-72 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-lg"
                >
                  {sprints.map((s) => (
                    <li key={s.id} role="option" aria-selected={s.id === current.id}>
                      <button
                        type="button"
                        onClick={() => setSprintOpen(false)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded-[var(--radius-sm)] px-3 py-2 text-left',
                          s.id === current.id
                            ? 'bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                            : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg-primary)]',
                        )}
                      >
                        <span className="text-sm font-medium">{s.name}</span>
                        <span className="font-mono text-xs text-[var(--fg-tertiary)]">
                          {s.start} → {s.end}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/* View toggle — segmented control */}
            <ViewToggle view={view} onViewChange={onViewChange} />

            {/* Optional extra (Quick actions menu etc.) */}
            {rightExtra}

            {/* Shortcuts affordance */}
            {onOpenShortcuts ? (
              <button
                type="button"
                onClick={onOpenShortcuts}
                aria-label="Keyboard shortcuts"
                data-testid="stories-shortcuts"
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)]',
                  'bg-[var(--bg-elevated)] px-2.5 text-xs text-[var(--fg-secondary)]',
                  'hover:bg-[var(--hover)] hover:text-[var(--fg-primary)]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                )}
              >
                <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 font-mono text-[10px]">⌘/</kbd>
              </button>
            ) : null}

            {/* New story CTA */}
            <button
              type="button"
              onClick={onNewStory}
              data-testid="stories-new"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 py-2',
                'text-sm font-semibold text-white shadow-[var(--shadow-glow-primary)]',
                'transition-transform duration-fast ease-out-soft hover:opacity-90',
                'btn-press focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]',
              )}
            >
              <Plus size={14} aria-hidden="true" />
              <span>New story</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Segmented control for view switching. Animates an underline pill. */
function ViewToggle({
  view,
  onViewChange,
}: {
  view: StoryView | 'lifecycle';
  onViewChange: (view: StoryView | 'lifecycle') => void;
}) {
  const options: ReadonlyArray<{ id: StoryView | 'lifecycle'; label: string; icon: React.ReactNode }> = [
    { id: 'kanban', label: 'Kanban', icon: <KanbanSquare size={14} aria-hidden="true" /> },
    { id: 'list', label: 'List', icon: <List size={14} aria-hidden="true" /> },
    { id: 'timeline', label: 'Timeline', icon: <LayoutGrid size={14} aria-hidden="true" /> },
    { id: 'lifecycle', label: 'Lifecycle', icon: <ListTodo size={14} aria-hidden="true" /> },
  ];

  return (
    <div
      role="tablist"
      aria-label="View"
      className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-0.5"
    >
      {options.map((opt) => {
        const active = view === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`stories-view-${opt.id}`}
            onClick={() => onViewChange(opt.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs font-medium',
              'transition-colors duration-fast ease-out-soft',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              active
                ? 'bg-[var(--bg-base)] text-[var(--fg-primary)] shadow-sm'
                : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
            )}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}