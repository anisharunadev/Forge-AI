'use client';

/**
 * /admin/cost — Phase 6 SC-6.6 real-time cost dashboard.
 *
 * Per-tenant card: today's spend, budget remaining, last-minute
 * rate, top 3 models, last-hour sparkline. Auto-refresh every 5 s
 * via TanStack Query.
 *
 * Empty state (R15) — no spend yet, action chips open /copilot.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '@/lib/api/client';

const POLL_MS = 5_000;

type Bucket = { bucket_ts: string; cost_usd: number };
type CostRealtime = {
  tenant_id: string;
  today_usd: number;
  last_minute_usd: number;
  budget_remaining_usd: number;
  top_models: Array<{ model: string; cost_usd: number }>;
  last_hour_sparkline: Bucket[];
  has_activity: boolean;
};

function useTenantIdFromQuery(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('tenant_id');
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="bg-white/5 border border-white/10 rounded-lg p-4"
    >
      <p className="text-xs uppercase tracking-wide text-white/60">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  );
}

function TenantPicker(): React.ReactElement {
  return (
    <div className="p-6 text-white/70">
      Pick a tenant from the org switcher to view its cost dashboard.
    </div>
  );
}

function EmptyState({ tenantId }: { tenantId: string }): React.ReactElement {
  return (
    <div className="p-12 text-center space-y-4">
      <div className="text-5xl">💸</div>
      <h2 className="text-xl font-semibold">No spend yet for {tenantId}</h2>
      <p className="text-white/70 max-w-md mx-auto">
        Run your first chat completion to see real-time cost meter data here.
        Spend updates every {POLL_MS / 1000} seconds.
      </p>
      <div className="flex justify-center gap-3">
        <a className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded" href="/copilot">
          Open Co-pilot
        </a>
        <a className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded" href="/admin/cost">
          Refresh
        </a>
      </div>
    </div>
  );
}

export default function CostDashboardPage(): React.ReactElement {
  const tenantId = useTenantIdFromQuery();
  const query = useQuery<CostRealtime>({
    queryKey: ['cost', 'realtime', tenantId],
    enabled: Boolean(tenantId),
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const url = `/api/v1/forge/observability/cost/realtime?tenant_id=${encodeURIComponent(
        tenantId as string,
      )}`;
      return api.get<CostRealtime>(url);
    },
  });

  if (!tenantId) return <TenantPicker />;
  if (query.isError) {
    return (
      <div className="p-6">
        <div className="bg-red-900/30 border border-red-500/40 rounded-lg p-4">
          <p className="font-semibold">Cost dashboard error</p>
          <p className="text-sm text-red-200 mt-1">
            {(query.error as Error)?.message ?? 'unknown'}
          </p>
        </div>
      </div>
    );
  }
  if (!query.data) {
    return <p className="p-6 text-white/60">Loading cost snapshot…</p>;
  }
  const data = query.data;
  if (!data.has_activity) return <EmptyState tenantId={tenantId} />;

  return (
    <main className="p-6 space-y-6" data-testid="cost-dashboard">
      <header>
        <h1 className="text-2xl font-semibold">Cost · {data.tenant_id}</h1>
        <p className="text-sm text-white/60">
          Refreshes every {POLL_MS / 1000}s
        </p>
      </header>
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat
          label="Today"
          value={`$${data.today_usd.toFixed(2)}`}
          testId="stat-today"
        />
        <Stat
          label="Last minute"
          value={`$${data.last_minute_usd.toFixed(4)}`}
          testId="stat-last-minute"
        />
        <Stat
          label="Budget remaining"
          value={`$${data.budget_remaining_usd.toFixed(2)}`}
          testId="stat-budget-remaining"
        />
      </section>
      <section className="bg-white/5 border border-white/10 rounded-lg p-4">
        <h2 className="text-sm uppercase tracking-wide text-white/60 mb-3">
          Last hour
        </h2>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data.last_hour_sparkline.slice()}>
            <CartesianGrid stroke="#243152" strokeDasharray="3 3" />
            <XAxis
              dataKey="bucket_ts"
              tick={{ fill: '#94a6cd', fontSize: 10 }}
              tickFormatter={(v: string) => v.slice(11, 16)}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fill: '#94a6cd', fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                background: '#11172a',
                border: '1px solid #243152',
                fontSize: 12,
              }}
              labelStyle={{ color: '#c4cfe5' }}
              formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost'] as [string, string]}
            />
            <Line
              type="monotone"
              dataKey="cost_usd"
              stroke="#60a5fa"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <section className="bg-white/5 border border-white/10 rounded-lg p-4">
        <h2 className="text-sm uppercase tracking-wide text-white/60 mb-3">
          Top 3 models today
        </h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.top_models.slice()}>
            <CartesianGrid stroke="#243152" strokeDasharray="3 3" />
            <XAxis dataKey="model" tick={{ fill: '#94a6cd', fontSize: 10 }} />
            <YAxis tick={{ fill: '#94a6cd', fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                background: '#11172a',
                border: '1px solid #243152',
                fontSize: 12,
              }}
              labelStyle={{ color: '#c4cfe5' }}
              formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost'] as [string, string]}
            />
            <Bar dataKey="cost_usd" fill="#60a5fa" />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </main>
  );
}
