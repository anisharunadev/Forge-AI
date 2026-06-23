'use client'

import * as React from 'react'
import { Cell, Pie, PieChart } from 'recharts'

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
import { getSeriesColor } from '@/lib/charts/theme'
import type { PieDatum } from '@/lib/charts/types'

export interface PieChartCardProps {
  title: string
  description?: string
  data: ReadonlyArray<PieDatum>
  height?: number
  className?: string
}

export function PieChartCard({
  title,
  description,
  data,
  height,
  className,
}: PieChartCardProps) {
  const rows = React.useMemo(
    () =>
      data.map((d, i) => ({
        name: d.name,
        value: d.value,
        _color: d.color ?? getSeriesColor(i),
      })),
    [data],
  )

  return (
    <Card data-testid="pie-chart-card" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-14 font-semibold">{title}</CardTitle>
        {description && (
          <CardDescription className="text-12">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ChartContainer height={height}>
          <PieChart>
            <ChartTooltip />
            <ChartLegend />
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              strokeWidth={0}
            >
              {rows.map((row, i) => (
                <Cell key={row.name} fill={row._color} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}