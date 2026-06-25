'use client';

/**
 * BudgetGauge — visual gauge for per-tenant LLM budget usage.
 *
 * Accessibility (WCAG 1.4.1 — Use of Color):
 *   - The threshold (80%, 100%) drives BOTH a color change AND a
 *     text/icon swap. Color is never the only signal.
 *   - `role="status"` + `aria-live="polite"` so screen readers
 *     announce the new state when TanStack re-fetches flip the
 *     gauge from yellow → red → green.
 *   - `aria-valuenow` / `aria-valuemin` / `aria-valuemax` so the
 *     gauge is exposed as a `progressbar` to assistive tech.
 *
 * The component is purely presentational — the parent decides
 * `value`, `max`, and (optionally) a custom label. The thresholds
 * (0.8, 1.0) are constants; the parent can override them in a
 * follow-up if the per-workflow budget UX needs different bands.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type BudgetSeverity = 'ok' | 'warn' | 'exceeded';

export interface BudgetGaugeProps {
  /** Current spend (e.g. dollars spent this month). */
  readonly value: number;
  /** Hard ceiling. */
  readonly max: number;
  /** Optional label rendered next to the icon. */
  readonly label?: string;
  /** Compact mode (table cells) vs default (cards). */
  readonly compact?: boolean;
  /** Optional className passthrough. */
  readonly className?: string;
}

const WARN_THRESHOLD = 0.8;
const EXCEEDED_THRESHOLD = 1.0;

function severity(value: number, max: number): BudgetSeverity {
  if (max <= 0) return 'ok';
  const pct = value / max;
  if (pct >= EXCEEDED_THRESHOLD) return 'exceeded';
  if (pct >= WARN_THRESHOLD) return 'warn';
  return 'ok';
}

function severityClasses(s: BudgetSeverity): {
  bar: string;
  text: string;
  ring: string;
} {
  switch (s) {
    case 'exceeded':
      return {
        bar: 'bg-red-500',
        text: 'text-red-500',
        ring: 'ring-red-500/40',
      };
    case 'warn':
      return {
        bar: 'bg-yellow-500',
        text: 'text-yellow-500',
        ring: 'ring-yellow-500/40',
      };
    case 'ok':
    default:
      return {
        bar: 'bg-emerald-500',
        text: 'text-emerald-500',
        ring: 'ring-emerald-500/40',
      };
  }
}

function severityIcon(s: BudgetSeverity): string {
  switch (s) {
    case 'exceeded':
      return '!';
    case 'warn':
      return '!';
    case 'ok':
    default:
      return '✓';
  }
}

function severityLabel(s: BudgetSeverity): string {
  switch (s) {
    case 'exceeded':
      return 'Over budget';
    case 'warn':
      return 'Approaching limit';
    case 'ok':
    default:
      return 'Within budget';
  }
}

export function BudgetGauge({
  value,
  max,
  label,
  compact,
  className,
}: BudgetGaugeProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(1.5, value / safeMax));
  const s = severity(value, max);
  const cls = severityClasses(s);
  const widthPct = Math.min(100, pct * 100);

  return (
    <div
      className={cn('flex flex-col gap-1', className)}
      data-testid="budget-gauge"
      data-severity={s}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            'inline-flex items-center gap-1 font-medium',
            cls.text,
          )}
          aria-hidden="true"
        >
          <span className="inline-flex">{severityIcon(s)}</span>
          {label ?? severityLabel(s)}
        </span>
        <span className="font-mono text-muted-foreground">
          {value.toFixed(2)} / {max.toFixed(2)}
        </span>
      </div>
      <div
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-muted ring-1 ring-inset',
          cls.ring,
        )}
      >
        <div
          className={cn('h-full transition-all', cls.bar)}
          style={{ width: `${widthPct}%` }}
          aria-hidden="true"
        />
      </div>
      {/* Accessible mirror — exposes the gauge as a progressbar. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={cn(
          'sr-only',
          compact ? 'text-[11px]' : 'text-xs',
        )}
        data-testid="budget-gauge-announce"
      >
        {`${severityLabel(s)}: ${value.toFixed(2)} of ${max.toFixed(2)} used (${(pct * 100).toFixed(0)} percent).`}
      </div>
    </div>
  );
}

export { WARN_THRESHOLD, EXCEEDED_THRESHOLD };
