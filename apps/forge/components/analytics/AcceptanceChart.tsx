'use client';

import * as React from 'react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { ArtifactAcceptance } from '@/lib/analytics/data';

const COLOR: Record<keyof ArtifactAcceptance, string> = {
  accepted: '#059669',
  rejected: '#dc2626',
  pending: '#d97706',
};

export interface AcceptanceChartProps {
  data: ArtifactAcceptance;
  height?: number;
}

export function AcceptanceChart({ data, height = 240 }: AcceptanceChartProps) {
  const rows = [
    { name: 'Accepted', key: 'accepted' as const, value: data.accepted },
    { name: 'Rejected', key: 'rejected' as const, value: data.rejected },
    { name: 'Pending', key: 'pending' as const, value: data.pending },
  ];
  return (
    <div
      data-testid="acceptance-chart"
      data-points={rows.length}
      style={{ height }}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
          >
            {rows.map((r) => (
              <Cell key={r.key} fill={COLOR[r.key]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: '#11172a',
              border: '1px solid #243152',
              fontSize: 12,
            }}
            labelStyle={{ color: '#c4cfe5' }}
            formatter={(v: number, name: string) => [v, name]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
