'use client';

/**
 * HorizontalBarCard — top-N agent usage rendered as horizontal bars.
 *
 * Reuses the shared BarChartCard primitive via a `layout="vertical"`
 * Recharts BarChart. Each datum's `color` is honored so the top entry
 * gets the primary accent and subsequent entries fade to muted tones.
 *
 * Skill influence:
 *   - `chart` (Multi-Variable Comparison) — horizontal bars are the
 *     standard idiom for ranked categorical comparisons.
 *   - `ux` (Heading Hierarchy) — bars are sorted top-down so the eye
 *     lands on the highest-value entry first.
 */

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { chartColors, getSeriesColor } from '@/lib/charts/theme';
import { cn } from '@/lib/utils';

export interface HorizontalBarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface HorizontalBarCardProps {
  title: string;
  description?: string;
  data: ReadonlyArray<HorizontalBarDatum>;
  /** Tooltip value suffix (e.g. "invocations" or "$"). */
  valueSuffix?: string;
  /** When true, formats value with thousand separators + prefix. */
  formatValue?: (v: number) => string;
  height?: number;
  className?: string;
}

const DEFAULT_FORMAT = (v: number) => v.toLocaleString();

export function HorizontalBarCard({
  title,
  description,
  data,
  valueSuffix,
  formatValue = DEFAULT_FORMAT,
  height = 220,
  className,
}: HorizontalBarCardProps) {
  // Sort descending and cap at top 10.
  const sorted = React.useMemo(
    () => [...data].sort((a, b) => b.value - a.value).slice(0, 10),
    [data],
  );

  return (
    <Card data-testid="horizontal-bar-card" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-[14px] font-semibold">{title}</CardTitle>
        {description ? (
          <CardDescription className="text-[12px]">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <div style={{ height }} className="w-full">
          {sorted.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <span className="text-xs text-[var(--fg-tertiary)]">No data</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={sorted as unknown as Array<HorizontalBarDatum>}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
              >
                <CartesianGrid stroke={chartColors.muted} strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  stroke={chartColors.muted}
                  fontSize={11}
                  tickLine={false}
                  tickFormatter={(v: number) => formatValue(v)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  stroke={chartColors.muted}
                  fontSize={11}
                  tickLine={false}
                  width={92}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const v = payload[0]?.value as number;
                    return (
                      <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                        <div className="mb-1 font-medium text-foreground">{String(label ?? '')}</div>
                        <div className="text-muted-foreground">
                          {valueSuffix ? `${formatValue(v)} ${valueSuffix}` : formatValue(v)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {sorted.map((d, i) => (
                    <Cell key={d.label} fill={d.color ?? getSeriesColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}