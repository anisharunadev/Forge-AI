/**
 * F-829 Phase C — Recharts wrapper for cost timeline.
 *
 * Mirrors `components/analytics/CostChart.tsx` shape so the dashboard
 * can swap between Orchestrator M2 cost points and LiteLLM per-call
 * data without changing the surrounding layout.
 */
'use client';

import * as React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface UsagePoint {
  /** ISO-8601 timestamp for the bucket. */
  ts: string;
  costUsd: number;
  calls: number;
}

export interface UsageChartProps {
  data: ReadonlyArray<UsagePoint>;
  height?: number;
}

export function UsageChart({ data, height = 240 }: UsageChartProps) {
  return (
    <div
      data-testid="usage-chart"
      data-points={data.length}
      style={{ height }}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data.slice()}
          margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
        >
          <CartesianGrid stroke="#243152" strokeDasharray="3 3" />
          <XAxis
            dataKey="ts"
            tick={{ fill: '#94a6cd', fontSize: 10 }}
            tickFormatter={(v: string) => v.slice(5, 16)}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#94a6cd', fontSize: 10 }}
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip
            contentStyle={{
              background: '#11172a',
              border: '1px solid #243152',
              fontSize: 12,
            }}
            labelStyle={{ color: '#c4cfe5' }}
            formatter={((v: number) => [`$${v.toFixed(4)}`, 'Cost']) as any}
          />
          <Line
            type="monotone"
            dataKey="costUsd"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default UsageChart;
