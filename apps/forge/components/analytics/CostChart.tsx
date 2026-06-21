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
import type { CostPoint } from '@/lib/analytics/data';

export interface CostChartProps {
  data: ReadonlyArray<CostPoint>;
  height?: number;
}

export function CostChart({ data, height = 240 }: CostChartProps) {
  return (
    <div
      data-testid="cost-chart"
      data-points={data.length}
      style={{ height }}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.slice()} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#243152" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#94a6cd', fontSize: 10 }}
            tickFormatter={(v: string) => v.slice(5)}
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
            formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cost']}
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
