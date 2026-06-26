'use client';

/**
 * KpiTile — 160px-tall KPI card with sparkline.
 *
 * Design system rules applied:
 *   - `style` (Executive Dashboard) — large metric, semantic icon,
 *     trend arrow, sparkline, at-a-glance status.
 *   - `ux` (Color Only) — never rely on color alone: each tone
 *     pairs its tint with an explicit ArrowUp/ArrowDown/Minus glyph.
 *   - `prefers-reduced-motion` — sparkline draws statically
 *     (isAnimationActive defaults to false; charts/index passes
 *     through reduced-motion state from the page).
 */

import * as React from 'react';
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from 'lucide-react';

import { Sparkline } from '@/components/charts';
import { cn } from '@/lib/utils';

export type KpiTone = 'positive' | 'negative' | 'neutral';

const TONE_TEXT: Record<KpiTone, string> = {
  positive: 'text-[var(--accent-emerald)]',
  negative: 'text-[var(--accent-rose)]',
  neutral: 'text-[var(--fg-tertiary)]',
};

const TONE_BG: Record<KpiTone, string> = {
  positive: 'bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]',
  negative: 'bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]',
  neutral: 'bg-[var(--bg-inset)] text-[var(--fg-secondary)]',
};

function inferTone(deltaPct: number | undefined): KpiTone {
  if (deltaPct == null) return 'neutral';
  if (deltaPct > 0) return 'positive';
  if (deltaPct < 0) return 'negative';
  return 'neutral';
}

export interface KpiTileProps {
  label: string;
  value: string;
  /** Signed delta percentage. Sign alone is conveyed by tone + glyph. */
  deltaPct?: number;
  tone?: KpiTone;
  icon?: LucideIcon;
  /** Sparkline series, oldest first. Optional — KPI still renders without it. */
  sparkline?: ReadonlyArray<number>;
  /** Semantic accent for the sparkline. Defaults to indigo (primary). */
  sparkColor?: string;
  /** ARIA-friendly trend label for screen readers. */
  trendLabel?: string;
  className?: string;
  /** When true, suppresses the sparkline animation (set when reduced-motion). */
  isAnimationActive?: boolean;
}

export function KpiTile({
  label,
  value,
  deltaPct,
  tone,
  icon: Icon,
  sparkline,
  sparkColor = 'var(--accent-primary)',
  trendLabel,
  className,
  isAnimationActive = false,
}: KpiTileProps) {
  const effectiveTone: KpiTone = tone ?? inferTone(deltaPct);
  const Glyph =
    effectiveTone === 'positive' ? ArrowUp : effectiveTone === 'negative' ? ArrowDown : Minus;

  return (
    <div
      role="group"
      aria-label={`${label}: ${value}`}
      data-testid="kpi-tile"
      data-kpi-label={label}
      className={cn(
        'flex h-[160px] flex-col justify-between rounded-[var(--radius-lg)]',
        'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--fg-tertiary)]">
          {label}
        </p>
        {Icon ? (
          <span
            aria-hidden="true"
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)]',
              TONE_BG[effectiveTone],
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        ) : null}
      </div>

      <div className="flex items-end justify-between gap-2">
        <p
          className={cn(
            'text-[26px] font-bold leading-none tabular-nums tracking-tight',
            'text-[var(--fg-primary)]',
          )}
        >
          {value}
        </p>
        {typeof deltaPct === 'number' ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
              TONE_BG[effectiveTone],
            )}
            aria-label={trendLabel ?? `${effectiveTone} ${Math.abs(deltaPct).toFixed(1)} percent`}
          >
            <Glyph className="h-3 w-3" aria-hidden="true" />
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        ) : null}
      </div>

      {sparkline && sparkline.length > 0 ? (
        <div className="-mx-1">
          <Sparkline
            data={sparkline}
            color={sparkColor}
            height={40}
            isAnimationActive={isAnimationActive}
            ariaLabel={trendLabel ?? `${label} trend`}
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="h-[40px] w-full rounded-[var(--radius-md)] bg-[var(--bg-inset)]/60"
        />
      )}
    </div>
  );
}