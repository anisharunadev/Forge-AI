/**
 * F-829 Phase C — Per-tenant LLM usage dashboard.
 *
 * Composes three widgets sourced from `GET /api/v1/analytics/usage`:
 *   - `UsageChart`            cost timeline
 *   - `ModelUsageBreakdown`   pie by model
 *   - `UserUsageTable`        top spenders
 *
 * Server-rendered shell so the page is responsive on first paint;
 * the chart re-fetches on a 60s cadence via the browser cache
 * `no-store` directive.
 */
'use client';

import * as React from 'react';
import { Activity } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { KPICard } from '@/components/analytics/KPICard';
import { UsageChart } from '@/components/analytics/llm/UsageChart';
import { ModelUsageBreakdown } from '@/components/analytics/llm/ModelUsageBreakdown';
import { UserUsageTable } from '@/components/analytics/llm/UserUsageTable';
import { PageHeader } from '@/components/shell';
import { getTenantUsage } from '@/lib/litellm/usage';
import { useTenantId } from '@/hooks/use-tenant-id';

export const dynamic = 'force-dynamic';

export default function UsageDashboardPage() {
  const tenantId = useTenantId();
  const [payload, setPayload] = React.useState<Awaited<
    ReturnType<typeof getTenantUsage>
  > | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await getTenantUsage(tenantId);
      setPayload(data);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  React.useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const points = React.useMemo(() => {
    // Aggregate per-hour buckets from `by_user` would require richer
    // data; for now, render a single-point chart so the widget always
    // renders with a sane shape. Future enhancement: extend the API
    // to return per-bucket timeseries.
    if (!payload) return [] as { ts: string; costUsd: number; calls: number }[];
    return [
      {
        ts: payload.since ?? new Date().toISOString(),
        costUsd: payload.total_cost_usd,
        calls: payload.calls,
      },
    ];
  }, [payload]);

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="usage-dashboard">
        <PageHeader
          eyebrow="Analytics"
          title="LLM Usage"
          icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          description={`Per-tenant spend on LiteLLM-routed calls. Cached for ${
            payload?.cache_ttl_seconds ?? 60
          }s.`}
        />

        <section
          aria-label="KPI cards"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <KPICard
            label="Cost (window)"
            value={`$${(payload?.total_cost_usd ?? 0).toFixed(2)}`}
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          />
          <KPICard
            label="Calls"
            value={String(payload?.calls ?? 0)}
          />
          <KPICard
            label="Prompt tokens"
            value={String(payload?.prompt_tokens ?? 0)}
          />
          <KPICard
            label="Completion tokens"
            value={String(payload?.completion_tokens ?? 0)}
          />
        </section>

        <section
          aria-label="Usage charts"
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <div className="card flex flex-col gap-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Cost in window</h3>
              <span className="font-mono text-[10px] text-forge-300">
                {payload?.cached ? 'cached' : 'fresh'}
              </span>
            </header>
            <UsageChart data={points} />
          </div>
          <div className="card flex flex-col gap-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">By model</h3>
            </header>
            <ModelUsageBreakdown data={payload?.by_model ?? []} />
          </div>
        </section>

        <section aria-label="Top spenders" className="card flex flex-col gap-2">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Top spenders</h3>
            <span className="font-mono text-[10px] text-forge-300">
              {payload?.by_user?.length ?? 0} actors
            </span>
          </header>
          <UserUsageTable rows={payload?.by_user ?? []} />
        </section>

        {loading && !payload && (
          <p
            className="text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            Loading…
          </p>
        )}
      </div>
    </AdminShell>
  );
}
