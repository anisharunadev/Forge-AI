/**
 * F-829 Phase C — Per-tenant LLM usage dashboard.
 *
 * Composes three widgets sourced from the typed SDK in
 * `lib/litellm/data.ts` via the TanStack Query hooks in
 * `lib/hooks/useAnalytics.ts`:
 *   - `UsageChart`            cost timeline (derived from spend logs)
 *   - `ModelUsageBreakdown`   pie by model (`useSpendByModel`)
 *   - `UserUsageTable`        top spenders (derived from spend logs)
 *
 * The hooks refresh on a 30–60s cadence; the chart re-fetches on the
 * same cadence via the underlying query refetch interval.
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
import {
  useSpendByDay,
  useSpendByModel,
  useSpendLogs,
} from '@/lib/hooks/useAnalytics';
import type { SpendLogEntry, SpendModelRow } from '@/lib/litellm/data';

export const dynamic = 'force-dynamic';

export default function UsageDashboardPage() {
  // 30-day window — matches the parent Analytics Center defaults and
  // matches what the upstream `/admin/llm-gateway/spend/*` endpoints
  // are tuned to return. Increase here if you want longer windows.
  const spendByDayRes = useSpendByDay(30);
  const spendByModelRes = useSpendByModel(30);
  const spendLogsRes = useSpendLogs(30, 500);

  const spendTeams = spendByDayRes.data ?? [];
  const spendModels: ReadonlyArray<SpendModelRow> = spendByModelRes.data ?? [];
  const spendLogs: ReadonlyArray<SpendLogEntry> = spendLogsRes.data ?? [];

  // ---- Aggregate totals from raw spend logs (single source of truth) ----
  const totals = React.useMemo(() => {
    let cost = 0;
    let calls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    for (const log of spendLogs) {
      cost += log.spend ?? 0;
      calls += 1;
      promptTokens += log.prompt_tokens ?? 0;
      completionTokens += log.completion_tokens ?? 0;
    }
    return {
      cost,
      calls,
      promptTokens,
      completionTokens,
    };
  }, [spendLogs]);

  // ---- Cost timeline: derive a per-day series from spend logs ----
  // The typed SDK exposes `useSpendByDay` returning per-team rows;
  // group spend logs by ISO date for the chart so the curve shows
  // actual daily granularity (same derivation the parent Analytics
  // Center uses).
  const points = React.useMemo(() => {
    if (spendLogs.length === 0) {
      return [] as { ts: string; costUsd: number; calls: number }[];
    }
    const byDay = new Map<string, { cost: number; calls: number }>();
    for (const log of spendLogs) {
      const ts = log.startTime;
      if (!ts) continue;
      const day = String(ts).slice(0, 10);
      const bucket = byDay.get(day) ?? { cost: 0, calls: 0 };
      bucket.cost += log.spend ?? 0;
      bucket.calls += 1;
      byDay.set(day, bucket);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({
        ts: day,
        costUsd: v.cost,
        calls: v.calls,
      }));
  }, [spendLogs]);

  // ---- Model breakdown: shape into the pie chart's contract ----
  const modelBreakdown = React.useMemo(
    () =>
      spendModels.map((m) => ({
        model: m.model ?? m.model_name ?? m.model_group ?? 'unknown',
        cost_usd: m.spend ?? 0,
        calls: m.requests ?? m.invocations ?? 0,
      })),
    [spendModels],
  );

  // ---- Top spenders: group spend logs by `user` (or `key_alias`) ----
  const topSpenders = React.useMemo(() => {
    const byUser = new Map<string, { cost: number; calls: number }>();
    for (const log of spendLogs) {
      const actor = log.user ?? log.key_alias ?? 'unknown';
      const bucket = byUser.get(actor) ?? { cost: 0, calls: 0 };
      bucket.cost += log.spend ?? 0;
      bucket.calls += 1;
      byUser.set(actor, bucket);
    }
    return Array.from(byUser.entries())
      .map(([actor_id, v]) => ({
        actor_id,
        cost_usd: v.cost,
        calls: v.calls,
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd);
  }, [spendLogs]);

  const loading = spendByDayRes.isLoading || spendByModelRes.isLoading || spendLogsRes.isLoading;
  const hasData = spendLogs.length > 0 || spendModels.length > 0 || spendTeams.length > 0;

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="usage-dashboard">
        <PageHeader
          eyebrow="Analytics"
          title="LLM Usage"
          icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          description="Per-tenant spend on LiteLLM-routed calls. Refreshes every 30–60s."
        />

        <section
          aria-label="KPI cards"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <KPICard
            label="Cost (window)"
            value={`$${totals.cost.toFixed(2)}`}
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          />
          <KPICard
            label="Calls"
            value={String(totals.calls)}
          />
          <KPICard
            label="Prompt tokens"
            value={String(totals.promptTokens)}
          />
          <KPICard
            label="Completion tokens"
            value={String(totals.completionTokens)}
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
                {points.length} day{points.length === 1 ? '' : 's'}
              </span>
            </header>
            <UsageChart data={points} />
          </div>
          <div className="card flex flex-col gap-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">By model</h3>
            </header>
            <ModelUsageBreakdown data={modelBreakdown} />
          </div>
        </section>

        <section aria-label="Top spenders" className="card flex flex-col gap-2">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Top spenders</h3>
            <span className="font-mono text-[10px] text-forge-300">
              {topSpenders.length} actors
            </span>
          </header>
          <UserUsageTable rows={topSpenders} />
        </section>

        {loading && !hasData && (
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