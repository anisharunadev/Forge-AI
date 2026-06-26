'use client';

/**
 * HeroBand — animated gradient-border hero for the Project Intelligence
 * center (Step 20).
 *
 * Visual contract:
 *   - `.hero-border` (CSS in `globals.css`) gives a slow conic gradient
 *     sweep that respects prefers-reduced-motion.
 *   - Eyebrow (uppercase, tracking-widest) + h1 title (with lucide
 *     Layers icon) + body copy.
 *   - Top-right: SegmentedControl for "All / Mine / At risk / Recent".
 */

import * as React from 'react';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

export type HeroViewFilter = 'all' | 'mine' | 'at-risk' | 'recent';

export interface HeroBandProps {
  eyebrow?: string;
  title: string;
  description: string;
  /** Active view filter (server-rendered initially; client can switch). */
  activeView: HeroViewFilter;
  onViewChange?: (view: HeroViewFilter) => void;
}

const VIEW_OPTIONS: ReadonlyArray<{ value: HeroViewFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'at-risk', label: 'At risk' },
  { value: 'recent', label: 'Recent' },
];

export function HeroBand({
  eyebrow = 'Center · audit view',
  title,
  description,
  activeView,
  onViewChange,
}: HeroBandProps) {
  return (
    <section
      className={cn(
        'hero-border relative mt-6 overflow-hidden rounded-[var(--radius-lg)]',
        'border border-transparent bg-[var(--bg-surface)]',
      )}
      data-testid="project-hero-band"
    >
      <div className="flex flex-col gap-3 p-6 md:flex-row md:items-start md:justify-between md:gap-6 md:p-7">
        <div className="flex flex-col gap-2 md:max-w-[60%]">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
            {eyebrow}
          </p>
          <h1 className="flex items-center gap-2 text-[24px] font-bold leading-tight text-[var(--fg-primary)] md:text-[28px]">
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
              aria-hidden="true"
            >
              <Layers className="h-5 w-5" strokeWidth={2} />
            </span>
            {title}
          </h1>
          <p className="max-w-2xl text-[13px] leading-relaxed text-[var(--fg-secondary)]">
            {description}
          </p>
        </div>

        <SegmentedControl
          value={activeView}
          onChange={onViewChange}
          options={VIEW_OPTIONS}
        />
      </div>
    </section>
  );
}

interface SegmentedControlProps {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange?: (value: any) => void;
}

function SegmentedControl({ value, options, onChange }: SegmentedControlProps) {
  return (
    <div
      role="tablist"
      aria-label="View filter"
      className="inline-flex h-9 items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5"
      data-testid="hero-view-toggle"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange?.(opt.value)}
            data-testid={`hero-view-${opt.value}`}
            data-active={isActive ? 'true' : 'false'}
            className={cn(
              'seg-pill h-8 rounded-[6px] px-3 text-[12px] font-medium',
              isActive
                ? 'bg-[var(--accent-primary)]/15 text-[var(--fg-primary)] shadow-[inset_0_0_0_1px_var(--accent-primary)]/40'
                : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
