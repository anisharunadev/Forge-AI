'use client';

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
import type { RunStatusBucket } from '@/lib/analytics/data';

const STATUS_COLOR: Record<RunStatusBucket['status'], string> = {
  created: '#94a6cd',
  running: '#2563eb',
  waiting_approval: '#d97706',
  paused: '#6366f1',
  aborted: '#dc2626',
  finished: '#059669',
};

export interface RunsChartProps {
  data: ReadonlyArray<RunStatusBucket>;
  height?: number;
}

export function RunsChart({ data, height = 240 }: RunsChartProps) {
  return (
    <div
      data-testid="runs-chart"
      data-points={data.length}
      style={{ height }}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.slice()} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#243152" strokeDasharray="3 3" />
          <XAxis
            dataKey="status"
            tick={{ fill: '#94a6cd', fontSize: 10 }}
          />
          <YAxis tick={{ fill: '#94a6cd', fontSize: 10 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: '#11172a',
              border: '1px solid #243152',
              fontSize: 12,
            }}
            labelStyle={{ color: '#c4cfe5' }}
            formatter={(v: number) => [v, 'Runs']}
          />
          <Bar dataKey="count">
            {data.map((entry) => (
              <Cell key={entry.status} fill={STATUS_COLOR[entry.status]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
