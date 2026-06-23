'use client'

import * as React from 'react'
import { ResponsiveContainer } from 'recharts'

import { cn } from '@/lib/utils'

/**
 * ChartContainer — themed wrapper around Recharts ResponsiveContainer.
 *
 * Centralizes the chrome that every chart in the app shares:
 *   - Card-like border + radius
 *   - Configurable height (default 240px)
 *   - data-testid for QA hooks
 *
 * Consumes <LineChartCard> / <BarChartCard> / etc. via the `children`
 * prop — children must be a single Recharts root (LineChart, BarChart,
 * AreaChart, PieChart).
 */
export interface ChartContainerProps {
  height?: number
  className?: string
  children: React.ReactElement
}

export function ChartContainer({
  height = 240,
  className,
  children,
}: ChartContainerProps) {
  return (
    <div
      data-testid="chart-container"
      className={cn('w-full', className)}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}