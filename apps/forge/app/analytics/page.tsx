'use client';

import * as React from 'react';
import { BarChart3, DollarSign, Activity, CheckCheck, BookOpen } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { KPICard } from '@/components/analytics/KPICard';
import { CostChart } from '@/components/analytics/CostChart';
import { RunsChart } from '@/components/analytics/RunsChart';
import { AcceptanceChart } from '@/components/analytics/AcceptanceChart';
import { AgentUsageChart } from '@/components/analytics/AgentUsageChart';
import { LatencyHistogram } from '@/components/analytics/LatencyHistogram';
import { KnowledgeReuseGauge } from '@/components/analytics/KnowledgeReuseGauge';
import { useApiData } from '@/hooks/use-api-data';
import {
  type AgentUsageBucket,
  type ArtifactAcceptance,
  type CostPoint,
  type KPISnapshot,
  type LatencyBin,
  type RunStatusBucket,
} from '@/lib/analytics/data';

export default function AnalyticsCenterPage() {
  const kpisRes = useApiData<KPISnapshot>('/v1/analytics/kpis');
  const costRes = useApiData<ReadonlyArray<CostPoint>>('/v1/analytics/cost-trend');
  const runsRes = useApiData<ReadonlyArray<RunStatusBucket>>('/v1/analytics/runs-by-status');
  const acceptRes = useApiData<ArtifactAcceptance>('/v1/analytics/artifact-acceptance');
  const agentsRes = useApiData<ReadonlyArray<AgentUsageBucket>>('/v1/analytics/agent-usage');
  const latencyRes = useApiData<ReadonlyArray<LatencyBin>>('/v1/analytics/latency-histogram');

  const kpis: KPISnapshot = kpisRes.data ?? {
    totalCostUsd30d: 0,
    activeRuns: 0,
    avgAcceptancePct: 0,
    knowledgeReusePct: 0,
    totalRuns: 0,
  };
  const cost: ReadonlyArray<CostPoint> = costRes.data ?? [];
  const runs: ReadonlyArray<RunStatusBucket> = runsRes.data ?? [];
  const acceptance: ArtifactAcceptance = acceptRes.data ?? { accepted: 0, rejected: 0, pending: 0 };
  const agents: ReadonlyArray<AgentUsageBucket> = agentsRes.data ?? [];
  const latency: ReadonlyArray<LatencyBin> = latencyRes.data ?? [];
  const reuse = kpis.knowledgeReusePct;

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="analytics-center">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Center
          </p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
            Analytics Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Platform-wide metrics for the last 30 days. Cost, throughput,
            acceptance, and knowledge reuse at a glance.
          </p>
        </header>

        <section
          aria-label="KPI cards"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <KPICard
            label="Total cost (30d)"
            value={`$${kpis.totalCostUsd30d.toFixed(2)}`}
            deltaPct={-2.4}
            icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
          />
          <KPICard
            label="Active runs"
            value={String(kpis.activeRuns)}
            deltaPct={1}
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          />
          <KPICard
            label="Acceptance rate"
            value={`${kpis.avgAcceptancePct}%`}
            deltaPct={3.1}
            icon={<CheckCheck className="h-4 w-4" aria-hidden="true" />}
          />
          <KPICard
            label="Knowledge reuse"
            value={`${kpis.knowledgeReusePct}%`}
            deltaPct={5.6}
            icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
          />
        </section>

        <section
          aria-label="Trends"
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <div className="card flex flex-col gap-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Cost trend (30d)</h3>
              <span className="font-mono text-[10px] text-forge-300">
                USD per day
              </span>
            </header>
            <CostChart data={cost} />
          </div>
          <div className="card flex flex-col gap-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Runs by status</h3>
              <span className="font-mono text-[10px] text-forge-300">
                {kpis.totalRuns} total
              </span>
            </header>
            <RunsChart data={runs} />
          </div>
        </section>

        <section
          aria-label="Distribution"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <div className="card flex flex-col gap-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Acceptance</h3>
            </header>
            <AcceptanceChart data={acceptance} />
          </div>
          <div className="card flex flex-col gap-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Agent usage</h3>
            </header>
            <AgentUsageChart data={agents} />
          </div>
          <div className="card flex flex-col gap-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Approval latency</h3>
            </header>
            <LatencyHistogram data={latency} />
          </div>
          <div className="card flex flex-col gap-2">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Knowledge reuse</h3>
            </header>
            <KnowledgeReuseGauge value={reuse} />
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
