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
import type { AgentUsageBucket } from '@/lib/analytics/data';

export interface AgentUsageChartProps {
  data: ReadonlyArray<AgentUsageBucket>;
  height?: number;
}

export function AgentUsageChart({ data, height = 240 }: AgentUsageChartProps) {
  return (
    <div
      data-testid="agent-usage-chart"
      data-points={data.length}
      style={{ height }}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data.slice()}
          layout="vertical"
          margin={{ top: 8, right: 12, bottom: 4, left: 12 }}
        >
          <CartesianGrid stroke="#243152" strokeDasharray="3 3" />
          <XAxis type="number" tick={{ fill: '#94a6cd', fontSize: 10 }} />
          <YAxis
            type="category"
            dataKey="agent"
            tick={{ fill: '#94a6cd', fontSize: 10 }}
            width={110}
          />
          <Tooltip
            contentStyle={{
              background: '#11172a',
              border: '1px solid #243152',
              fontSize: 12,
            }}
            labelStyle={{ color: '#c4cfe5' }}
            formatter={(v: any, key: any) =>
              key === 'invocations' ? [v, 'Invocations'] : [`$${v.toFixed(2)}`, 'Cost']
            }
          />
          <Bar dataKey="invocations" fill="#60a5fa" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
