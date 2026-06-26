'use client';

/**
 * Stories Center — Filter Bar (Step 21).
 *
 * Single horizontal row containing:
 *   * Search input
 *   * Assignee pill (avatars)
 *   * Priority pill (P0 rose / P1 amber / P2 cyan / P3 muted)
 *   * Label pill (bug, feature, chore, docs, spike)
 *   * Estimate pill (XS / S / M / L / XL)
 *   * Active filter count badge + "Clear filters" link
 *
 * Skill influence:
 *   - Always show visible label above input (no placeholder-only)
 *   - Combine filters with AND semantics — surfaced via badges
 *   - aria-live announces count changes
 */

import * as React from 'react';
import { Search, X } from 'lucide-react';

import type {
  Assignee,
  Estimate,
  LabelKind,
  StoryFilter,
  StoryPriority,
} from '@/lib/stories/types';
import {
  ESTIMATE_POINTS,
  LABEL_DOT_VAR,
  LABEL_LABEL,
  PRIORITY_DOT_VAR,
  PRIORITY_LABEL,
} from '@/lib/stories/types';
import { cn } from '@/lib/utils';

export interface FilterBarProps {
  readonly filter: StoryFilter;
  readonly onChange: (next: StoryFilter) => void;
  readonly assignees: ReadonlyArray<Assignee>;
}

export function FilterBar({ filter, onChange, assignees }: FilterBarProps) {
  const activeCount =
    (filter.query.trim() ? 1 : 0) +
    filter.assignees.length +
    filter.priorities.length +
    filter.labels.length +
    filter.estimates.length;

  return (
    <section
      aria-label="Filter stories"
      data-testid="stories-filterbar"
      className={cn(
        'mb-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)]',
        'bg-[var(--bg-surface)] p-4',
      )}
    >
      {/* Search */}
      <label className="sr-only" htmlFor="stories-search">
        Search stories
      </label>
      <div className="relative flex flex-1 min-w-[180px] items-center">
        <Search
          size={14}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 text-[var(--fg-tertiary)]"
        />
        <input
          id="stories-search"
          type="search"
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
          placeholder="Search stories..."
          className={cn(
            'h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-default)]',
            'bg-[var(--bg-elevated)] pl-8 pr-3 text-sm text-[var(--fg-primary)]',
            'placeholder:text-[var(--fg-tertiary)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
          data-testid="stories-search"
        />
      </div>

      {/* Priority */}
      <PillGroup
        label="Priority"
        options={(['P0', 'P1', 'P2', 'P3'] as ReadonlyArray<StoryPriority>).map((id) => ({
          id,
          label: id,
          color: PRIORITY_DOT_VAR[id],
          active: filter.priorities.includes(id),
        }))}
        onToggle={(id) =>
          onChange({
            ...filter,
            priorities: toggle(filter.priorities, id as StoryPriority),
          })
        }
      />

      {/* Label */}
      <PillGroup
        label="Label"
        options={(['bug', 'feature', 'chore', 'docs', 'spike'] as ReadonlyArray<LabelKind>).map(
          (id) => ({
            id,
            label: LABEL_LABEL[id],
            color: LABEL_DOT_VAR[id],
            active: filter.labels.includes(id),
          }),
        )}
        onToggle={(id) =>
          onChange({
            ...filter,
            labels: toggle(filter.labels, id as LabelKind),
          })
        }
      />

      {/* Estimate */}
      <PillGroup
        label="Estimate"
        options={(['XS', 'S', 'M', 'L', 'XL'] as ReadonlyArray<Estimate>).map((id) => ({
          id,
          label: `${id} (${ESTIMATE_POINTS[id]})`,
          color: 'var(--fg-secondary)',
          active: filter.estimates.includes(id),
        }))}
        onToggle={(id) =>
          onChange({
            ...filter,
            estimates: toggle(filter.estimates, id as Estimate),
          })
        }
      />

      {/* Assignee */}
      <PillGroup
        label="Assignee"
        options={assignees.map((a) => ({
          id: a.id,
          label: a.initials,
          color: a.color,
          active: filter.assignees.includes(a.id),
          avatar: a,
        }))}
        onToggle={(id) =>
          onChange({ ...filter, assignees: toggle(filter.assignees, id) })
        }
      />

      {/* Active count + clear */}
      <div className="ml-auto flex items-center gap-2" aria-live="polite">
        {activeCount > 0 ? (
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1.5 text-[10px] font-semibold text-white"
            data-testid="stories-filter-count"
          >
            {activeCount}
          </span>
        ) : null}
        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() =>
              onChange({ query: '', assignees: [], priorities: [], labels: [], estimates: [] })
            }
            className={cn(
              'inline-flex items-center gap-1 text-xs font-medium text-[var(--fg-secondary)]',
              'underline-offset-2 hover:text-[var(--fg-primary)] hover:underline',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] rounded-[var(--radius-sm)]',
            )}
            data-testid="stories-clear-filters"
          >
            <X size={12} aria-hidden="true" />
            Clear filters
          </button>
        ) : null}
      </div>
    </section>
  );
}

interface PillOption {
  id: string;
  label: string;
  color: string;
  active: boolean;
  avatar?: Assignee;
}

function PillGroup({
  label,
  options,
  onToggle,
}: {
  label: string;
  options: ReadonlyArray<PillOption>;
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset
      data-testid={`stories-filter-${label.toLowerCase()}`}
      className="flex items-center gap-1.5"
    >
      <legend className="sr-only">{label} filter</legend>
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="checkbox"
            aria-checked={opt.active}
            aria-label={`${label}: ${opt.label}`}
            onClick={() => onToggle(opt.id)}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-xs font-medium',
              'transition-colors duration-fast ease-out-soft',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              opt.active
                ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                : 'border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg-primary)]',
            )}
          >
            {opt.avatar ? (
              <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                style={{ backgroundColor: opt.avatar.color }}
              >
                {opt.avatar.initials}
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: opt.color }}
              />
            )}
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function toggle<T>(arr: ReadonlyArray<T>, item: T): ReadonlyArray<T> {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}