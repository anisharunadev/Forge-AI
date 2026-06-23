'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * ChartTooltip — themed Recharts tooltip.
 *
 * Reads `active`, `payload`, and `label` from Recharts via a function-as-child
 * pattern. Renders a `bg-popover` panel with the series name and value.
 * Returns null when not active so Recharts does not flash a blank popup.
 */
export interface ChartTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<{
    name?: string
    value?: number | string
    color?: string
  }>
  label?: string | number
  className?: string
}

export function ChartTooltip({
  active,
  payload,
  label,
  className,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null
  }
  return (
    <div
      data-testid="chart-tooltip"
      className={cn(
        'rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md',
        className,
      )}
    >
      {label !== undefined && (
        <div className="mb-1 font-medium text-foreground">{String(label)}</div>
      )}
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li
            key={`${entry.name ?? 'series'}-${i}`}
            className="flex items-center gap-2"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color ?? 'currentColor' }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              {entry.name ?? 'value'}:
            </span>
            <span className="font-medium text-foreground">
              {typeof entry.value === 'number'
                ? entry.value.toLocaleString()
                : String(entry.value ?? '')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}