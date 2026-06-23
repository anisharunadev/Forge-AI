'use client'

import * as React from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'

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
import type { Series } from '@/lib/charts/types'

export interface AreaChartCardProps {
  title: string
  description?: string
  series: ReadonlyArray<Series>
  xLabel?: string
  yLabel?: string
  height?: number
  stacked?: boolean
  className?: string
}

export function AreaChartCard({
  title,
  description,
  series,
  xLabel,
  yLabel,
  height,
  stacked = false,
  className,
}: AreaChartCardProps) {
  const { data, xKey } = React.useMemo(() => {
    const xs = new Set<string | number>()
    for (const s of series) {
      for (const p of s.data) {
        xs.add(p.x instanceof Date ? p.x.getTime() : p.x)
      }
    }
    const sortedXs = Array.from(xs).sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b
      return String(a).localeCompare(String(b))
    })
    const xKeyLocal = 'x'
    const rows = sortedXs.map((x) => {
      const row: Record<string, string | number> = { [xKeyLocal]: x }
      for (const s of series) {
        const match = s.data.find(
          (p) => (p.x instanceof Date ? p.x.getTime() : p.x) === x,
        )
        if (match) row[s.name] = match.y
      }
      return row
    })
    return { data: rows, xKey: xKeyLocal }
  }, [series])

  return (
    <Card data-testid="area-chart-card" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-14 font-semibold">{title}</CardTitle>
        {description && (
          <CardDescription className="text-12">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ChartContainer height={height}>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <defs>
              {series.map((s, i) => {
                const color = s.color ?? getSeriesColor(i)
                return (
                  <linearGradient
                    key={s.name}
                    id={`area-fill-${s.name}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                  </linearGradient>
                )
              })}
            </defs>
            <CartesianGrid stroke={chartColors.muted} strokeDasharray="3 3" />
            <XAxis
              dataKey={xKey}
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
            {series.map((s, i) => (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={s.color ?? getSeriesColor(i)}
                fill={`url(#area-fill-${s.name})`}
                strokeWidth={2}
                stackId={stacked ? 'a' : undefined}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}