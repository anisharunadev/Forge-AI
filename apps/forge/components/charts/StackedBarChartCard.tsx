'use client'

/**
 * StackedBarChartCard — themed multi-series stacked bar.
 *
 * Distinct from `BarChartCard`, which only supports a single series
 * of `BarDatum` rows. Here we accept a `keys` array (one column per
 * series) and emit one `<Bar>` per key, all sharing a `stackId` so
 * Recharts stacks them. Each key can carry its own color; otherwise
 * we cycle through the `chartColorList` palette.
 *
 * Skill influence:
 *   - `chart` (Multi-Variable Comparison) — use stacked bars when the
 *     sum of categories matters and individual series are also
 *     meaningful.
 *   - `ux` (Color Only) — legend is always rendered (no color-only
 *     decoding), and tooltips surface the series name alongside
 *     color swatches.
 */

import * as React from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

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

export interface StackedSeries {
  /** Series key — used as the column in each data row. */
  key: string
  /** Human label — shown in tooltip and legend. */
  name: string
  /** Override the auto-assigned color from `chartColorList`. */
  color?: string
}

export interface StackedBarChartCardProps {
  title: string
  description?: string
  /** One row per category. Each row has `{ label, [key]: value }`. */
  data: ReadonlyArray<Record<string, string | number>>
  /** Ordered series to stack. */
  series: ReadonlyArray<StackedSeries>
  xLabel?: string
  yLabel?: string
  height?: number
  className?: string
}

export function StackedBarChartCard({
  title,
  description,
  data,
  series,
  xLabel,
  yLabel,
  height,
  className,
}: StackedBarChartCardProps) {
  return (
    <Card data-testid="stacked-bar-chart-card" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-14 font-semibold">{title}</CardTitle>
        {description && (
          <CardDescription className="text-12">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ChartContainer height={height}>
          <BarChart
            data={data as unknown as Array<Record<string, string | number>>}
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
                  ? {
                      value: xLabel,
                      position: 'insideBottom',
                      offset: -2,
                      fill: chartColors.muted,
                      fontSize: 11,
                    }
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
                  ? {
                      value: yLabel,
                      angle: -90,
                      position: 'insideLeft',
                      fill: chartColors.muted,
                      fontSize: 11,
                    }
                  : undefined
              }
            />
            <ChartTooltip />
            <ChartLegend />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                fill={s.color ?? getSeriesColor(i)}
                stackId="a"
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
