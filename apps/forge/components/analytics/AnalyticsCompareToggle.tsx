'use client';

/**
 * AnalyticsCompareToggle — small "Compare vs prior period" pill.
 *
 * Renders a Switch with a label so the affordance is obvious at a
 * glance. When on, the parent will typically re-issue data fetches
 * with `compare=true` and overlay the prior period as a dashed
 * ghost line on each chart.
 *
 * Skill influence:
 *   - `ux` (Color Only) — the toggle state is conveyed by BOTH
 *     the switch thumb position AND an `aria-checked` / label
 *     change ("On" / "Off").
 */

import * as React from 'react';
import { GitCompareArrows } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface AnalyticsCompareToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}

export function AnalyticsCompareToggle({
  checked,
  onChange,
  className,
}: AnalyticsCompareToggleProps) {
  return (
    <label
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-xs font-medium text-[var(--fg-primary)] cursor-pointer select-none transition-colors duration-150 ease-out-soft hover:bg-[rgba(255,255,255,0.04)]',
        className,
      )}
      data-testid="analytics-compare-toggle"
    >
      <GitCompareArrows className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
      <span>Compare</span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label="Compare to prior period"
        className="ml-1 scale-90"
        data-testid="analytics-compare-switch"
      />
      <span
        className={cn(
          'ml-0.5 rounded-full px-1.5 py-px text-[10px] font-medium',
          checked
            ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
            : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
        )}
        aria-hidden="true"
      >
        {checked ? 'On' : 'Off'}
      </span>
    </label>
  );
}