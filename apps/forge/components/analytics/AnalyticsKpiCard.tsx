'use client'

/**
 * AnalyticsKpiCard — 160px KPI tile with semantic icon, delta and
 * 40px Recharts sparkline.
 *
 * Replaces the prior 2-line `<Card>` KPI with the Step 4 design
 * language: large metric, semantic icon, signed delta, 40px
 * trend. The sparkline is rendered through the shared
 * `<Sparkline>` primitive (single source of truth for the
 * micro-trend shape).
 *
 * Skill influence:
 *   - `ux` (Color Only) — the delta is always accompanied by an
 *     arrow icon (Up/Down/Flat) in addition to color.
 *   - `web` (nextjs "Avoid layout shifts") — sparkline height is
 *     reserved at 40px even when the trend array is empty (so the
 *     card never resizes on data arrival).
 */

import * as React from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Sparkline } from '@/components/charts'

export type KpiTone = 'positive' | 'negative' | 'neutral'

export interface AnalyticsKpiCardProps {
  /** Short label, e.g. "Total Cost (30d)". */
  label: string
  /** Pre-formatted metric string, e.g. "$1,234.50" or "47". */
  value: string
  /** Signed delta (e.g. -2.4 = -2.4%). */
  deltaPct?: number
  /** Override the auto-derived delta tone. */
  tone?: KpiTone
  /** Semantic icon, 16px, drawn from the design system palette. */
  icon?: React.ReactNode
  /** Sparkline data — oldest first. */
  spark: ReadonlyArray<number>
  /** Accent for the sparkline (CSS variable or hex). */
  accent: string
  className?: string
  testId?: string
}

function toneClass(tone: KpiTone): string {
  if (tone === 'positive') return 'text-[var(--accent-emerald)]'
  if (tone === 'negative') return 'text-[var(--accent-rose)]'
  return 'text-[var(--fg-tertiary)]'
}

function deriveTone(deltaPct: number | undefined, explicit: KpiTone | undefined): KpiTone {
  if (explicit) return explicit
  if (deltaPct == null) return 'neutral'
  if (deltaPct > 0) return 'positive'
  if (deltaPct < 0) return 'negative'
  return 'neutral'
}

export function AnalyticsKpiCard({
  label,
  value,
  deltaPct,
  tone,
  icon,
  spark,
  accent,
  className,
  testId,
}: AnalyticsKpiCardProps) {
  const effective = deriveTone(deltaPct, tone)
  return (
    <Card
      className={cn(
        'flex h-[160px] flex-col justify-between p-4 transition-[transform,box-shadow] duration-200 ease-out-soft',
        className,
      )}
      data-testid={testId ?? 'kpi-card'}
      data-kpi-label={label}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          {label}
        </span>
        {icon ? (
          <span
            aria-hidden="true"
            className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-inset)]"
            style={{ color: accent }}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[var(--text-2xl)] font-semibold leading-none text-[var(--fg-primary)]">
            {value}
          </span>
          {deltaPct != null ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-xs font-medium',
                toneClass(effective),
              )}
              data-testid="kpi-delta"
            >
              {effective === 'positive' ? (
                <ArrowUp className="h-3 w-3" aria-hidden="true" />
              ) : effective === 'negative' ? (
                <ArrowDown className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Minus className="h-3 w-3" aria-hidden="true" />
              )}
              {Math.abs(deltaPct).toFixed(1)}%
            </span>
          ) : null}
        </div>
        <Sparkline
          data={spark}
          color={accent}
          height={40}
          ariaLabel={`${label} trend`}
        />
      </div>
    </Card>
  )
}
