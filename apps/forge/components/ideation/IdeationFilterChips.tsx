'use client';

/**
 * `<IdeationFilterChips>` — Step-57 Zone 6.
 *
 * Filter chip row for the Ideas tab. The brief asks for chips with
 * labels: All / New / Scored / Approved / Rejected. The wire shape
 * uses `WireIdeaStatus`; the chip labels are user-facing English.
 *
 * Selection is uncontrolled-friendly — the parent owns the selected
 * wire status and passes it back via `onChange`. Counts render next
 * to each label so the PM can see distribution at a glance.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type IdeaChipValue = 'all' | 'new' | 'scored' | 'approved' | 'rejected';

export interface IdeationFilterChipsProps {
  readonly value: IdeaChipValue;
  readonly onChange: (next: IdeaChipValue) => void;
  /** Counts per chip — optional, rendered next to the label. */
  readonly counts?: Partial<Record<IdeaChipValue, number>>;
}

const CHIPS: ReadonlyArray<{ value: IdeaChipValue; label: string; testId: string }> = [
  { value: 'all', label: 'All', testId: 'ideation-chip-all' },
  { value: 'new', label: 'New', testId: 'ideation-chip-new' },
  { value: 'scored', label: 'Scored', testId: 'ideation-chip-scored' },
  { value: 'approved', label: 'Approved', testId: 'ideation-chip-approved' },
  { value: 'rejected', label: 'Rejected', testId: 'ideation-chip-rejected' },
];

export function IdeationFilterChips({
  value,
  onChange,
  counts,
}: IdeationFilterChipsProps) {
  return (
    <div
      role="tablist"
      aria-label="Filter ideas by status"
      data-testid="ideation-filter-chips"
      className="inline-flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1"
    >
      {CHIPS.map((chip) => {
        const active = chip.value === value;
        const count = counts?.[chip.value];
        return (
          <button
            key={chip.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(chip.value)}
            data-testid={chip.testId}
            data-active={active}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium transition-colors duration-150 ease-out-soft',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              active
                ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]',
            )}
          >
            {chip.label}
            {typeof count === 'number' && count > 0 ? (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px]',
                  active
                    ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                    : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
                )}
                data-testid={`${chip.testId}-count`}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}