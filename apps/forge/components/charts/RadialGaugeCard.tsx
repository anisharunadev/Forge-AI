'use client'

/**
 * RadialGaugeCard — half-circle percentage gauge with delta.
 *
 * A single-value ring (Knowledge Reuse, SLA attainment, etc.) that
 * the Step 4–15 charts don't otherwise express. Renders a 180°
 * arc as inline SVG so the result is themable via CSS variables
 * and zero-dependency at runtime.
 *
 * Skill influence:
 *   - `ux` (Color Only) — the percentage is also rendered as text;
 *     a colored arc alone would not pass the high-severity rule.
 *   - `prefers-reduced-motion` — arc transitions disabled when the
 *     user has motion preferences set (handled via the global rule
 *     in globals.css for `*` transitions on accent properties).
 */


import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface RadialGaugeCardProps {
  title: string
  description?: string
  /** 0–100. */
  value: number
  /** Label rendered beneath the value (default: "of target"). */
  unit?: string
  /** Delta vs previous period (e.g. +4.2). */
  delta?: number
  /** Color of the foreground arc (CSS variable or hex). */
  color?: string
  className?: string
  /** Force-empty (no data) visual. Hides arc and shows placeholder. */
  empty?: boolean
  /** Vertical pixel height of the SVG arc (default: 180). */
  height?: number
}

function tone(pct: number): {
  bg: string
  fg: string
  badge: string
} {
  if (pct >= 60) {
    return {
      bg: 'var(--accent-emerald)',
      fg: 'text-[var(--accent-emerald)]',
      badge:
        'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]',
    }
  }
  if (pct >= 30) {
    return {
      bg: 'var(--accent-amber)',
      fg: 'text-[var(--accent-amber)]',
      badge:
        'border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]',
    }
  }
  return {
    bg: 'var(--accent-rose)',
    fg: 'text-[var(--accent-rose)]',
    badge:
      'border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]',
  }
}

export function RadialGaugeCard({
  title,
  description,
  value,
  unit = 'reuse',
  delta,
  color = 'var(--accent-cyan)',
  className,
  empty = false,
  height = 180,
}: RadialGaugeCardProps) {
  const clamped = Math.max(0, Math.min(100, value))
  // 200x110 viewBox — half-circle gauge per Step 4 design.
  const cx = 100
  const cy = 90
  const r = 70
  const startAngle = 180
  const endAngle = 360
  const sweep = ((endAngle - startAngle) * clamped) / 100 + startAngle
  const polar = (a: number) => ({
    x: cx + r * Math.cos((a * Math.PI) / 180),
    y: cy + r * Math.sin((a * Math.PI) / 180),
  })
  const start = polar(startAngle)
  const end = polar(endAngle)
  const cur = polar(sweep)
  const largeArc = sweep - startAngle > 180 ? 1 : 0
  const dBg = `M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y}`
  const dFg = `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${cur.x} ${cur.y}`

  const t = tone(clamped)
  const fg = empty ? 'var(--border-default)' : color
  const valueText = empty ? '0%' : `${clamped}%`
  const deltaText =
    empty || delta == null
      ? null
      : delta > 0
        ? `+${delta.toFixed(1)}%`
        : `${delta.toFixed(1)}%`

  return (
    <Card data-testid="radial-gauge-card" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-14 font-semibold">{title}</CardTitle>
        {description && (
          <CardDescription className="text-12">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div
          className="flex flex-col items-center gap-2"
          data-testid="knowledge-reuse-gauge"
          data-value={clamped}
        >
          <svg
            viewBox="0 0 200 110"
            width="100%"
            height={height}
            role="img"
            aria-label={`${title}: ${valueText}`}
          >
            <path
              d={dBg}
              stroke="var(--border-default)"
              strokeWidth={14}
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={dFg}
              stroke={fg}
              strokeWidth={14}
              fill="none"
              strokeLinecap="round"
            />
            <text
              x={cx}
              y={cy - 6}
              textAnchor="middle"
              fontSize={28}
              fontWeight="600"
              fill="var(--fg-primary)"
            >
              {valueText}
            </text>
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              fontSize={11}
              fill="var(--fg-tertiary)"
            >
              {unit}
            </text>
          </svg>
          {deltaText ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                t.badge,
              )}
              data-testid="radial-gauge-delta"
            >
              {deltaText} vs prev
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]"
              data-testid="radial-gauge-status"
            >
              {empty ? 'No data' : 'Stable'}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
