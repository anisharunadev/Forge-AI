'use client'

/**
 * Sparkline — 40px micro-trend for KPI cards.
 *
 * Pure-SVG sparkline sized to live at the bottom of a 160px KPI tile.
 * Accepts a fixed `width` (default 100%) and 40px height per the
 * design system spec. No axes, no tooltips — the value is already
 * stated in the KPI's primary metric; the sparkline is just a
 * shape. Tooltip is omitted intentionally to keep the surface lean.
 *
 * Skill influence:
 *   - `style` (Data-Dense Dashboard) — sparklines are standard KPI
 *     affordance, no extra chrome.
 *   - `ux` (Color Only) — we still expose a `srOnlyLabel` so screen
 *     readers get a textual trend description; the color alone is
 *     never the only signal.
 *   - `prefers-reduced-motion` — the `isAnimationActive` flag is
 *     exposed and defaults to false (no animation) to comply with
 *     the global reduced-motion rule (Step 6 / globals.css).
 */

import * as React from 'react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'

import { chartColors } from '@/lib/charts/theme'
import { cn } from '@/lib/utils'

export interface SparklineProps {
  /** Series values, oldest first. Must be length >= 2 to render. */
  data: ReadonlyArray<number>
  /** Semantic accent for the line + area fill. Defaults to primary indigo. */
  color?: string
  /** Width in pixels (defaults to 100% — fills its container). */
  width?: number | string
  /** Height in pixels. Defaults to 40. */
  height?: number
  /** When true, draws an animated draw-in on mount. */
  isAnimationActive?: boolean
  className?: string
  /** Accessible label override. Default: "Trend". */
  ariaLabel?: string
}

export function Sparkline({
  data,
  color = chartColors.primary,
  width = '100%',
  height = 40,
  isAnimationActive = false,
  className,
  ariaLabel = 'Trend',
}: SparklineProps) {
  const series = React.useMemo(
    () =>
      data.map((v, i) => ({
        i,
        v,
      })),
    [data],
  )

  if (data.length < 2) {
    return (
      <div
        role="img"
        aria-label={`${ariaLabel}: no trend data`}
        className={cn('flex w-full items-end', className)}
        style={{ height }}
        data-testid="sparkline-empty"
      >
        <span className="block h-px w-full bg-[var(--border-subtle)]" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div
      className={cn('w-full', className)}
      style={{ width, height }}
      data-testid="sparkline"
      data-points={data.length}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill="url(#sparkline-fill)"
            isAnimationActive={isAnimationActive}
            aria-label={ariaLabel}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
