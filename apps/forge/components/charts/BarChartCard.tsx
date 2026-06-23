'use client'

import * as React from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ChartContainer } from './ChartContainer'
import { ChartTooltip } from './ChartTooltip'
import { ChartLegend } from './ChartLegend'
import { chartColors, getSeriesColor } from '@/lib/charts/theme'
import type { BarDatum } from '@/lib/charts/types'

export interface BarChartCardProps {
  title: string
  description?: string
  data: ReadonlyArray<BarDatum>
  xLabel?: string
  yLabel?: string
  height?: number
  stacked?: boolean
  className?: string
}

/**
 * BarChartCard — themed bar chart.
 *
 * Single-color mode: the first datum with an explicit `color` wins,
 * otherwise we fall back to `chartColorList[0]` (primary indigo).
 * Multi-color mode (one bar per distinct color) is supported by
 * passing each datum its own `color` and we apply a per-cell
 * mapping via Recharts `<Cell>`.
 */
export function BarChartCard({
  title,
  description,
  data,
  xLabel,
  yLabel,
  height,
  stacked = false,
  className,
}: BarChartCardProps) {
  const hasMultipleColors = data.some((d) => d.color)
  const singleColor = React.useMemo(() => {
    const firstWithColor = data.find((d) => d.color)
    return firstWithColor?.color ?? getSeriesColor(0)
  }, [data])

  return (
    <Card data-testid="bar-chart-card" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-14 font-semibold">{title}</CardTitle>
        {description && (
          <CardDescription className="text-12">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ChartContainer height={height}>
          <BarChart
            data={data as unknown as Array<{ label: string; value: number; color?: string }>}
            margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
          >
            <CartesianGrid stroke={chartColors.muted} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              stroke={chartColors.muted}
              fontSize={11}
              tickLine={false}
              label={
                xLabel
                  ? { value: xLabel, position: 'insideBottom', offset: -2, fill: chartColors.muted, fontSize: 11 }
                  : undefined
              }
            />
            <YAxis
              stroke={chartColors.muted}
              fontSize={11}
              tickLine={false}
              width={48}
              label={
                yLabel
                  ? { value: yLabel, angle: -90, position: 'insideLeft', fill: chartColors.muted, fontSize: 11 }
                  : undefined
              }
            />
            <ChartTooltip />
            <ChartLegend />
            <Bar
              dataKey="value"
              fill={singleColor}
              stackId={stacked ? 'a' : undefined}
              radius={[4, 4, 0, 0]}
            >
              {hasMultipleColors &&
                data.map((d, i) => (
                  <Cell key={d.label} fill={d.color ?? getSeriesColor(i)} />
                ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}