'use client';

/**
 * ApprovalLatencyArea — area chart of approval latency over time.
 *
 * Renders p50, p95, p99 series when present (percentile lines);
 * falls back to a single "avg" line when only an aggregate is
 * available from the API. Uses the shared AreaChartCard primitive
 * from `@/components/charts`, so tooltip, crosshair, clickable
 * legend, and reduced-motion behavior come for free.
 *
 * Skill influence:
 *   - `chart` (Multi-Variable Comparison) — multiple series on a
 *     shared x-axis work well as overlapping translucent areas.
 *   - `style` (Executive Dashboard) — the percentile p99 line is
 *     highlighted as the "worst-case" indicator.
 */

import * as React from 'react';

import { AreaChartCard } from '@/components/charts';
import { chartColors, getSeriesColor } from '@/lib/charts/theme';
import type { Series } from '@/lib/charts/types';
import type { ApprovalLatencyPoint } from '@/lib/analytics/data';

export interface ApprovalLatencyAreaProps {
  data: ReadonlyArray<ApprovalLatencyPoint>;
  height?: number;
  className?: string;
}

const PERCENTILE_COLORS: Record<'p50' | 'p95' | 'p99', string> = {
  p50: chartColors.primary,
  p95: chartColors.agent,
  p99: chartColors.destructive,
};

export function ApprovalLatencyArea({
  data,
  height = 220,
  className,
}: ApprovalLatencyAreaProps) {
  const series: ReadonlyArray<Series> = React.useMemo(() => {
    if (data.length === 0) return [];
    const first = data[0]!;
    const keys: Array<'p50' | 'p95' | 'p99' | 'avg'> = [];
    if (typeof first.p50 === 'number') keys.push('p50');
    if (typeof first.p95 === 'number') keys.push('p95');
    if (typeof first.p99 === 'number') keys.push('p99');
    if (typeof first.avg === 'number') keys.push('avg');

    return keys.map((k) => ({
      name: k.toUpperCase(),
      color: k === 'avg' ? getSeriesColor(1) : PERCENTILE_COLORS[k as 'p50' | 'p95' | 'p99'],
      data: data.map((p) => ({ x: p.date, y: (p as unknown as Record<string, unknown>)[k] as number })),
    }));
  }, [data]);

  if (data.length === 0 || series.length === 0) {
    return (
      <div
        data-testid="approval-latency-area"
        data-points={data.length}
        style={{ height }}
        className={className ?? 'flex w-full items-center justify-center'}
      >
        <span className="text-xs text-[var(--fg-tertiary)]">No latency data</span>
      </div>
    );
  }

  return (
    <AreaChartCard
      title="Approval latency"
      description="Time to approve across percentiles"
      series={series}
      xLabel="day"
      yLabel="ms"
      height={height}
      className={className}
    />
  );
}