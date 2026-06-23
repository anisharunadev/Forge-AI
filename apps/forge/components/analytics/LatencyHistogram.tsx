'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LatencyBin } from '@/lib/analytics/data';

export interface LatencyHistogramProps {
  data: ReadonlyArray<LatencyBin>;
  height?: number;
}

export function LatencyHistogram({ data, height = 240 }: LatencyHistogramProps) {
  return (
    <div
      data-testid="latency-histogram"
      data-points={data.length}
      style={{ height }}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.slice()} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#243152" strokeDasharray="3 3" />
          <XAxis
            dataKey="range"
            tick={{ fill: '#94a6cd', fontSize: 10 }}
            interval={0}
          />
          <YAxis tick={{ fill: '#94a6cd', fontSize: 10 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: '#11172a',
              border: '1px solid #243152',
              fontSize: 12,
            }}
            labelStyle={{ color: '#c4cfe5' }}
            formatter={(v: any) => [v, 'Approvals']}
          />
          <Bar dataKey="count" fill="#a78bfa" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
