'use client';

/**
 * Agent Center — SegmentedControl + FilterBar (Step 4 + Step 6).
 *
 * SegmentedControl: a tab bar with bg --bg-inset container. The
 * active pill slides via Framer Motion `layoutId` (200ms ease-out)
 * so the indicator glides between segments and survives re-renders.
 *
 * FilterBar: status pills with counts, type chips, a "More filters"
 * button with active-count badge, and an X to clear all.
 */

import * as React from 'react';
import { X, SlidersHorizontal } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface SegmentOption {
  readonly value: string;
  readonly label: string;
  readonly testId?: string;
}

export function SegmentedControl({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<SegmentOption>;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="relative inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--bg-inset)] p-1"
      data-testid="segmented-control"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-state={active ? 'active' : 'inactive'}
            onClick={() => onChange(opt.value)}
            data-testid={opt.testId ?? `segment-${opt.value}`}
            className={cn(
              'relative z-10 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors duration-200 ease-out-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              active
                ? 'font-medium text-[var(--fg-primary)]'
                : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
            )}
          >
            {active ? (
              <motion.span
                layoutId="forge-segmented-pill"
                className="absolute inset-0 -z-10 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]"
                transition={{ type: 'tween', duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                data-testid="segmented-pill"
              />
            ) : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function StatusPill({
  label,
  count,
  active,
  onClick,
  testId,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-150 ease-out-soft',
        active
          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.12)] text-[var(--fg-primary)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)]',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-sm px-1 font-mono text-[10px]',
          active ? 'bg-[var(--accent-primary)] text-white' : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function FilterBar({
  statusOptions,
  statusValue,
  onStatusChange,
  typeOptions,
  typeValue,
  onTypeChange,
  activeFilterCount,
  onClearAll,
}: {
  statusOptions: ReadonlyArray<{ value: string; label: string; count: number }>;
  statusValue: string;
  onStatusChange: (v: string) => void;
  typeOptions: ReadonlyArray<{ value: string; label: string }>;
  typeValue: string;
  onTypeChange: (v: string) => void;
  activeFilterCount: number;
  onClearAll: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
      data-testid="filter-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Status
        </span>
        {statusOptions.map((opt) => (
          <StatusPill
            key={opt.value}
            label={opt.label}
            count={opt.count}
            active={opt.value === statusValue}
            onClick={() => onStatusChange(opt.value)}
            testId={`filter-pill-status-${opt.value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Type
        </span>
        {typeOptions.map((opt) => {
          const active = opt.value === typeValue;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onTypeChange(opt.value)}
              aria-pressed={active}
              data-testid={`filter-chip-type-${opt.value}`}
              className={cn(
                'rounded-[var(--radius-md)] border px-2.5 py-1 text-xs transition-colors duration-150 ease-out-soft',
                active
                  ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.12)] text-[var(--fg-primary)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)]',
              )}
            >
              {opt.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="filter-more"
            className="relative inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)]"
          >
            <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
            More filters
            {activeFilterCount > 0 ? (
              <span
                className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 font-mono text-[10px] text-white"
                data-testid="filter-more-badge"
              >
                {activeFilterCount}
              </span>
            ) : null}
          </button>
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={onClearAll}
              data-testid="filter-clear-all"
              aria-label="Clear all filters"
              className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)]"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Clear all
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
