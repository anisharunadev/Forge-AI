'use client'

/**
 * TokenUsageByModel — Pie when ≤5 slices, stacked bar otherwise.
 *
 * Renders tokens (or cost, or invocations) split by model. The
 * spec says "Pie ≤5 slices, stacked bar if larger" — we detect
 * slice count and pivot. This keeps small-model portfolios (the
 * common case) readable as a donut while still handling long-tail
 * model inventories via the stacked bar fallback.
 *
 * Skill influence:
 *   - `chart` (Multi-Variable Comparison) — pie is fine up to 5
 *     series; beyond that, a stacked bar preserves part-to-whole
 *     without forcing the user to read 12 thin slices.
 *   - `ux` (Color Only) — every slice has a textual label inside
 *     the legend; no slice is identified by color alone.
 */

import * as React from 'react'
import { Cell, Pie, PieChart } from 'recharts'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  StackedBarChartCard,
  type StackedSeries,
} from '@/components/charts'
import { getSeriesColor } from '@/lib/charts/theme'

export interface TokenSlice {
  model: string
  tokens: number
}

export interface TokenUsageByModelProps {
  title: string
  description?: string
  data: ReadonlyArray<TokenSlice>
  height?: number
  className?: string
}

const MAX_PIE_SLICES = 5

export function TokenUsageByModel({
  title,
  description,
  data,
  height,
  className,
}: TokenUsageByModelProps) {
  const sorted = React.useMemo(
    () => [...data].sort((a, b) => b.tokens - a.tokens),
    [data],
  )
  const isPie = sorted.length > 0 && sorted.length <= MAX_PIE_SLICES

  if (isPie) {
    const rows = sorted.map((d, i) => ({
      name: d.model,
      value: d.tokens,
      _color: getSeriesColor(i),
    }))
    return (
      <Card data-testid="token-usage-pie" className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-14 font-semibold">{title}</CardTitle>
          {description ? (
            <CardDescription className="text-12">{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <ChartContainer height={height}>
            <PieChart>
              <ChartTooltip />
              <Pie
                data={rows}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={90}
                paddingAngle={2}
                strokeWidth={0}
                label={({ name, percent }) =>
                  `${name} ${(((percent as number) ?? 0) * 100).toFixed(0)}%`
                }
                labelLine={false}
              >
                {rows.map((row) => (
                  <Cell key={row.name} fill={row._color} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>
    )
  }

  // Stacked-bar fallback for >5 models.
  const series: ReadonlyArray<StackedSeries> = sorted.map((d, i) => ({
    key: d.model,
    name: d.model,
    color: getSeriesColor(i),
  }))
  const rows = sorted.map((d) => ({ label: 'Tokens', [d.model]: d.tokens }))
  return (
    <StackedBarChartCard
      title={title}
      description={description}
      data={rows}
      series={series}
      height={height}
      className={className}
    />
  )
}
