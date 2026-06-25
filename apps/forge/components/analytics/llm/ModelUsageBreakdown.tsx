/**
 * F-829 Phase C — Pie chart breakdown of LLM spend by model.
 *
 * Sourced from `GET /api/v1/analytics/usage` `by_model` array. The
 * palette mirrors `KPICard.tsx` so the dashboard has a consistent
 * visual identity across widgets.
 */
'use client';

import * as React from 'react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

export interface ModelUsageBucket {
  model: string;
  cost_usd: number;
  calls: number;
}

const PALETTE = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#22d3ee'];

export interface ModelUsageBreakdownProps {
  data: ReadonlyArray<ModelUsageBucket>;
  height?: number;
}

export function ModelUsageBreakdown({
  data,
  height = 240,
}: ModelUsageBreakdownProps) {
  const rows = React.useMemo(
    () =>
      data.map((d) => ({
        name: d.model,
        value: Number(d.cost_usd.toFixed(4)),
        calls: d.calls,
      })),
    [data],
  );

  if (rows.length === 0) {
    return (
      <div
        data-testid="model-usage-breakdown-empty"
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        No model usage in window.
      </div>
    );
  }

  return (
    <div
      data-testid="model-usage-breakdown"
      data-rows={rows.length}
      style={{ height }}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            innerRadius={45}
            outerRadius={80}
            paddingAngle={2}
          >
            {rows.map((_, idx) => (
              <Cell
                key={`cell-${idx}`}
                fill={PALETTE[idx % PALETTE.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: '#11172a',
              border: '1px solid #243152',
              fontSize: 12,
            }}
            labelStyle={{ color: '#c4cfe5' }}
            formatter={((v: number, _name: string, item: any) => [
              `$${v.toFixed(4)} (${item?.payload?.calls ?? 0} calls)`,
              item?.payload?.name ?? '',
            ]) as any}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ModelUsageBreakdown;
