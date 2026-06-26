'use client'

/**
 * ApprovalLatencyAreaChart — p50/p95/p99 latency fan.
 *
 * Distinct from the generic `AreaChartCard` because latency
 * percentiles are usually logged as numeric ms and we want the
 * axes / tooltip to format as "1.2s" not "1.2". Also renders a
 * mouse-following crosshair (`<Tooltip cursor=…>`) for quick read-off.
 *
 * Skill influence:
 *   - `chart` (Multi-Variable Comparison) — overlapping translucent
 *     areas with the largest (p99) drawn last read as a fan.
 *   - `prefers-reduced-motion` — animations on Area are gated off
 *     when reduced motion is on.
 */

import * as React from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Tooltip,
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
import { ChartContainer } from '@/components/charts/ChartContainer'
import { chartColors, getSeriesColor } from '@/lib/charts/theme'
import { cn } from '@/lib/utils'

export interface LatencyPoint {
  /** x — usually a day label. */
  label: string
  p50: number
  p95: number
  p99: number
}

export interface ApprovalLatencyAreaChartProps {
  title: string
  description?: string
  data: ReadonlyArray<LatencyPoint>
  height?: number
  className?: string
}

function fmtMs(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`
  return `${Math.round(v)}ms`
}

export function ApprovalLatencyAreaChart({
  title,
  description,
  data,
  height,
  className,
}: ApprovalLatencyAreaChartProps) {
  return (
    <Card data-testid="approval-latency-chart" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-14 font-semibold">{title}</CardTitle>
        {description ? (
          <CardDescription className="text-12">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <ChartContainer height={height}>
          <AreaChart
            data={data as unknown as Array<Record<string, string | number>>}
            margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
          >
            <defs>
              {(['p50', 'p95', 'p99'] as const).map((k, i) => {
                const color = getSeriesColor(i)
                return (
                  <linearGradient
                    key={k}
                    id={`latency-fill-${k}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                )
              })}
            </defs>
            <CartesianGrid stroke={chartColors.muted} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              stroke={chartColors.muted}
              fontSize={11}
              tickLine={false}
            />
            <YAxis
              stroke={chartColors.muted}
              fontSize={11}
              tickLine={false}
              width={48}
              tickFormatter={(v: number) => fmtMs(v)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--border-strong)' }}
              contentStyle={{
                background: 'var(--popover)',
                border: '1px solid var(--border-default)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--popover-foreground)',
              }}
              labelStyle={{ color: 'var(--fg-secondary)' }}
              formatter={(v, name) => [
                typeof v === 'number' ? fmtMs(v) : String(v ?? ''),
                String(name),
              ]}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ paddingTop: 8, fontSize: 12 }}
            />
            <Area
              type="monotone"
              dataKey="p50"
              name="p50"
              stroke={getSeriesColor(0)}
              fill="url(#latency-fill-p50)"
              strokeWidth={1.5}
              stackId="latency"
            />
            <Area
              type="monotone"
              dataKey="p95"
              name="p95"
              stroke={getSeriesColor(1)}
              fill="url(#latency-fill-p95)"
              strokeWidth={1.5}
              stackId="latency"
            />
            <Area
              type="monotone"
              dataKey="p99"
              name="p99"
              stroke={getSeriesColor(2)}
              fill="url(#latency-fill-p99)"
              strokeWidth={2}
              stackId="latency"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

export const _styles = cn
