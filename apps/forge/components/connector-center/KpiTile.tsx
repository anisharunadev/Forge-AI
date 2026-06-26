'use client';

/**
 * KpiTile — 120px KPI card for the Overview strip.
 *
 * Composes a label, a large numeric value, a delta hint and a sparkline.
 * Color is driven by `accent` and renders a thin left rule plus a
 * muted sparkline in the same hue.
 */

import * as React from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

import { Sparkline } from '@/components/charts/Sparkline';
import { cn } from '@/lib/utils';

const ACCENT_BAR: Record<string, string> = {
  cyan: 'before:bg-[var(--accent-cyan)]',
  emerald: 'before:bg-[var(--accent-emerald)]',
  rose: 'before:bg-[var(--accent-rose)]',
  indigo: 'before:bg-[var(--accent-primary)]',
  amber: 'before:bg-[var(--accent-amber)]',
  violet: 'before:bg-[var(--accent-violet)]',
};

const ACCENT_FG: Record<string, string> = {
  cyan: 'text-[var(--accent-cyan)]',
  emerald: 'text-[var(--accent-emerald)]',
  rose: 'text-[var(--accent-rose)]',
  indigo: 'text-[var(--accent-primary)]',
  amber: 'text-[var(--accent-amber)]',
  violet: 'text-[var(--accent-violet)]',
};

const ACCENT_HEX: Record<string, string> = {
  cyan: 'var(--accent-cyan)',
  emerald: 'var(--accent-emerald)',
  rose: 'var(--accent-rose)',
  indigo: 'var(--accent-primary)',
  amber: 'var(--accent-amber)',
  violet: 'var(--accent-violet)',
};

export interface KpiTileProps {
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
  readonly trend?: 'up' | 'down' | 'flat';
  readonly Icon: LucideIcon;
  readonly accent: 'cyan' | 'emerald' | 'rose' | 'indigo' | 'amber' | 'violet';
  readonly sparkData: ReadonlyArray<number>;
  readonly sub?: string;
  readonly onClick?: () => void;
  readonly className?: string;
}

export function KpiTile({
  label,
  value,
  delta,
  trend = 'flat',
  Icon,
  accent,
  sparkData,
  sub,
  onClick,
  className,
}: KpiTileProps) {
  const Trend =
    trend === 'up' ? '▲' : trend === 'down' ? '▼' : '·';
  const trendClass =
    trend === 'up'
      ? 'text-[var(--accent-emerald)]'
      : trend === 'down'
        ? 'text-[var(--accent-rose)]'
        : 'text-fg-tertiary';

  const Wrapper: React.ElementType = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      data-testid="kpi-tile"
      data-accent={accent}
      className={cn(
        'relative flex h-[120px] w-full flex-col justify-between gap-1 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-left transition-colors',
        'before:absolute before:inset-y-0 before:left-0 before:w-0.5',
        ACCENT_BAR[accent],
        onClick && 'cursor-pointer hover:border-[var(--border-default)] hover:bg-[var(--bg-surface)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-fg-tertiary">{label}</span>
        <Icon className={cn('h-4 w-4', ACCENT_FG[accent])} aria-hidden="true" />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-fg-primary font-mono">{value}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px]">
            {delta ? (
              <span className={cn('font-medium', trendClass)}>
                {Trend} {delta}
              </span>
            ) : null}
            {sub ? <span className="text-fg-tertiary">{sub}</span> : null}
          </div>
        </div>
        <Sparkline
          data={sparkData}
          color={ACCENT_HEX[accent]}
          height={32}
          width={88}
          ariaLabel={`${label} trend`}
        />
      </div>

      {onClick ? (
        <ChevronRight className="absolute right-2 top-2 h-3 w-3 text-fg-tertiary" aria-hidden="true" />
      ) : null}
    </Wrapper>
  );
}