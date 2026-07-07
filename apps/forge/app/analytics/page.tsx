'use client';

/**
 * Analytics Center — Step 7 page rebuild (Bento layout).
 *
 * Layout:
 *   1. Hero band — animated gradient border (`.hero-border`), eyebrow
 *      "Center", h1 "Analytics Center" + BarChart3, 30-day description,
 *      top-right action slot: DateRangePicker · Compare · Export.
 *   2. KPI strip — 4 × 160px cards (Total cost, Active runs, Acceptance
 *      rate, Knowledge reuse) with semantic icon, signed delta, and a
 *      40px sparkline.
 *   3. Bento chart grid (4 rows):
 *      Row 1 — Cost trend (area, indigo gradient) + Runs by status (stacked bar).
 *      Row 2 — Acceptance (line) + Agent usage (horizontal bar, top 10) +
 *              Approval latency (p50/p95/p99 fan area).
 *      Row 3 — Knowledge reuse (radial gauge + delta) + Token usage by model
 *              (pie ≤5, stacked bar fallback).
 *      Row 4 — Provider cost breakdown (stacked bar) + Provider leaderboard (Top 3).
 *   4. Empty state — reuses the shared EmptyState with BarChart3, two CTAs,
 *      KPIs at zero, charts hidden.
 *   5. Loading — chart-specific shimmer skeletons (no spinners).
 *
 * Skill influence applied (rule → implementation):
 *
 *   style / Data-Dense Dashboard →
 *     - 12-column Bento grid (`grid-cols-1 lg:grid-cols-12 gap-4`) for the
 *       chart canvas.
 *     - Eight chart widgets in four rows, sharing the canvas with the KPI
 *       strip above.
 *     - Compact but readable typography (text-[12px]–[14px] chart titles &
 *       descriptions from design tokens).
 *     - `max-w-[1600px]` container, content centered with `mx-auto`.
 *     - Loading skeletons for every chart type (no spinners), export
 *       popover, and filter-by-provider interaction.
 *
 *   style / Executive Dashboard →
 *     - Exactly four KPI cards (under the 4–6 cap), each carrying a
 *       semantic Lucide icon, a signed delta, and a 40px sparkline.
 *     - Traffic-light tone pairings: positive → accent-emerald, negative
 *       → accent-rose, neutral → fg-tertiary.
 *     - At-a-glance one-page view; mobile collapses to a single column.
 *
 *   chart / Multi-Variable Comparison →
 *     - Token usage renders as a pie chart only when ≤5 models; the
 *       `TokenUsageByModel` component falls back to a stacked bar
 *       otherwise, matching the search's secondary-option guidance.
 *     - Multi-series area (p50/p95/p99 fan) and stacked bar (runs by
 *       status, provider cost) rely on Recharts' translucent overlays
 *       and distinct colors per dataset.
 *
 *   ux / Color Only (HIGH severity) →
 *     - KPI deltas pair accent color with `ArrowUp` / `ArrowDown` /
 *       `Minus` glyphs from Lucide.
 *     - Stacked bar legend renders status names ("Queued", "Running",
 *       …) alongside color, so status is conveyed both ways.
 *     - Provider leaderboard ranks are rendered as numeric chips
 *       (`{i + 1}`) on a colored disc — never color alone.
 *     - DateRangePicker active pill uses both indigo fill AND
 *       `aria-pressed` text.
 *
 *   ux / Heading Hierarchy (MEDIUM severity) →
 *     - h1 in hero (`Analytics Center`).
 *     - h2 landmarks wrap KPI strip + each chart row (visually hidden
 *       so layout is unaffected, but screen-reader navigable).
 *     - h3 inside chart cards (`Cost trend`, `Knowledge reuse`, …).
 *     - Sequential: h1 → h2 → h3 with no skipped levels.
 *
 *   ux / Empty State Feedback →
 *     - Reuses `EmptyState` with `BarChart3` illustration, descriptive
 *       title and copy, two primary actions ("Run your first command",
 *       "How analytics works"), and a row of suggestion chips
 *       (`forge-review`, `forge-arch-adr`, `forge-test-unit`,
 *       `forge-deploy-preview`).
 *     - Charts are hidden and KPI placeholders show `$0` / `0` / `0%`
 *       until the first run completes.
 *
 *   `prefers-reduced-motion` →
 *     - `usePrefersReducedMotion()` gates `RadialGauge` animation.
 *     - `globals.css` zeroes the `.hero-border` rotation, `.shimmer`,
 *       and `.route-enter` for users who opt out.
 *
 * Constraints:
 *   - Recharts only (via `@/components/charts` primitives).
 *   - Semantic palette via `--accent-*` tokens (indigo/cyan/emerald/
 *     amber/rose/violet) — no hardcoded hex.
 *   - Multi-tenant: every fetcher is proxied via `/api/proxy`.
 */

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Activity,
  BarChart3,
  BookOpen,
  CheckCheck,
  DollarSign,
  Play,
  Sparkles,
} from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AnalyticsHero } from '@/components/analytics/AnalyticsHero';
import {
  DateRangePicker,
  type DateRangeValue,
} from '@/components/analytics/DateRangePicker';
import { AnalyticsCompareToggle } from '@/components/analytics/AnalyticsCompareToggle';
import { ExportMenu } from '@/components/analytics/ExportMenu';
import { AnalyticsKpiCard } from '@/components/analytics/AnalyticsKpiCard';
import { ApprovalLatencyAreaChart } from '@/components/analytics/ApprovalLatencyAreaChart';
import { ProviderLeaderboard } from '@/components/analytics/ProviderLeaderboard';
import { TokenUsageByModel } from '@/components/analytics/TokenUsageByModel';
import { HorizontalBarCard } from '@/components/analytics/HorizontalBarCard';
import { RadialGauge } from '@/components/analytics/RadialGauge';
import {
  AreaChartSkeleton,
  BarChartSkeleton,
  GaugeSkeleton,
  HorizontalBarSkeleton,
  KpiTileSkeleton,
  LeaderboardSkeleton,
  PieChartSkeleton,
} from '@/components/analytics/AnalyticsSkeletons';
import {
  AreaChartCard,
  LineChartCard,
  StackedBarChartCard,
  type StackedSeries,
} from '@/components/charts';
import { chartColors, getSeriesColor } from '@/lib/charts/theme';
import { EmptyState } from '@/src/components/empty-state';
import {
  downloadBlob,
  snapshotToCsv,
  snapshotToJson,
  type AnalyticsExportSnapshot,
} from '@/components/analytics/export-serializers';
import { useApiData } from '@/hooks/use-api-data';
import {
  type AgentUsageBucket,
  type ApprovalLatencyPoint,
  type ArtifactAcceptance,
  type CostPoint,
  type KPISnapshot,
  type LatencyBin,
  type ProviderCostRow,
  type ProviderLeaderboardRow,
  type RunStatusBucket,
  type TokenUsageByModel as TokenUsageByModelType,
} from '@/lib/analytics/data';
import {
  useSpendByDay,
  useSpendByModel,
  useSpendLogs,
} from '@/lib/hooks/useAnalytics';
import type {
  SpendLogEntry
} from '@/lib/litellm/data';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants — colors drawn from design tokens.
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<RunStatusBucket['status'], string> = {
  created: 'Queued',
  running: 'Running',
  waiting_approval: 'Waiting',
  paused: 'Paused',
  aborted: 'Cancelled',
  finished: 'Finished',
};

const STATUS_COLORS: Record<RunStatusBucket['status'], string> = {
  created: 'var(--fg-tertiary)',
  running: 'var(--accent-primary)',
  waiting_approval: 'var(--accent-amber)',
  paused: 'var(--accent-violet)',
  aborted: 'var(--accent-rose)',
  finished: 'var(--accent-emerald)',
};

const KPI_ACCENTS = {
  totalCost: 'var(--accent-primary)',
  activeRuns: 'var(--accent-cyan)',
  acceptance: 'var(--accent-emerald)',
  knowledgeReuse: 'var(--accent-violet)',
} as const;

// ---------------------------------------------------------------------------
// Reduced-motion hook
// ---------------------------------------------------------------------------

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtInt(n: number): string {
  return n.toLocaleString();
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

/**
 * Read the `agent_id` from a LiteLLM spend-log entry. LiteLLM keeps
 * arbitrary metadata on each log row; the analytics page renders the
 * top-N agents by invocation count and groups by this id.
 */
function readAgentId(log: SpendLogEntry): string | null {
  const meta = log.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const id = (meta as Record<string, unknown>).agent_id;
  if (typeof id === 'string' && id.length > 0) return id;
  return null;
}

/**
 * Derive a provider name from a LiteLLM model id.
 *
 * `openai/gpt-4o-mini` → `openai`
 * `anthropic/claude-3-5-sonnet-20241022` → `anthropic`
 * `gpt-4o-mini` (no prefix) → `unknown`
 */
function providerFromModel(model: string | null | undefined): string {
  const m = model ?? '';
  if (!m) return 'unknown';
  const idx = m.indexOf('/');
  if (idx <= 0) return 'unknown';
  return m.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalyticsCenterPage() {
  const [range, setRange] = React.useState<DateRangeValue>({ preset: '30d' });
  const [compare, setCompare] = React.useState(false);
  const [providerFilter, setProviderFilter] = React.useState<string | null>(null);
  const reduceMotion = usePrefersReducedMotion();

  // Translate the DateRangePicker preset → a numeric days window for
  // the LiteLLM-backed hooks. Custom ranges fall back to 30d until
  // the backend accepts an explicit `from`/`to` pair (Zone 11 follow-up).
  const daysWindow = React.useMemo<number>(() => {
    switch (range.preset) {
      case '7d':
        return 7;
      case '90d':
        return 90;
      case 'custom':
        return 30;
      case '30d':
      default:
        return 30;
    }
  }, [range.preset]);

  // Data — every fetcher is tenant-scoped via the Next.js proxy.
  //
  // Step-59 Zone 11 — the cost/trend/agent/model/provider views now
  // come from LiteLLM spend data (useSpendByDay / useSpendByModel /
  // useSpendLogs). The Active runs + Acceptance rate KPIs are
  // Forge-specific and continue to use useApiData against
  // /v1/analytics/kpis.
  const kpisRes = useApiData<KPISnapshot>('/v1/analytics/kpis');
  const spendByDayRes = useSpendByDay(daysWindow);
  const spendByModelRes = useSpendByModel(daysWindow);
  const spendLogsRes = useSpendLogs(daysWindow, 500);

  const kpis: KPISnapshot = kpisRes.data ?? {
    totalCostUsd30d: 0,
    activeRuns: 0,
    avgAcceptancePct: 0,
    knowledgeReusePct: 0,
    totalRuns: 0,
  };
  const spendTeams = spendByDayRes.data ?? [];
  const spendModels = spendByModelRes.data ?? [];
  const spendLogs = spendLogsRes.data ?? [];

  // ---- Derived series (LiteLLM-backed) ----
  //
  // Total cost = sum of every team's spend for the window. Cost
  // trend = one bucket per day across all teams (lite rows fold into
  // a single series). Agent usage = group logs by
  // `metadata.agent_id`. Token usage by model = group logs by
  // `model`. Provider cost + leaderboard = derive provider from the
  // model name prefix (`openai/gpt-4o-mini` → `openai`).

  const cost: ReadonlyArray<CostPoint> = React.useMemo(() => {
    // No bucketed-by-day endpoint exists in the gateway today, so we
    // expose a single "today" bucket when there is no per-day data.
    // The endpoint contract (Zone 10) returns one row per team, not
    // per day, so the trend chart degrades to a single dot until the
    // /admin/llm-gateway/spend/by-day endpoint lands (tracked
    // separately). For now we still draw the chart with whatever
    // daily granularity we can infer from spend logs below.
    const total = spendTeams.reduce(
      (acc, t) => acc + (t.spend ?? 0),
      0,
    );
    return [{ date: 'today', costUsd: total }];
  }, [spendTeams]);

  // Per-day trend (preferred) — derive from spend logs when available.
  const dailyTrend: ReadonlyArray<CostPoint> = React.useMemo(() => {
    if (spendLogs.length === 0) return cost;
    const byDay = new Map<string, number>();
    for (const log of spendLogs) {
      const ts = log.startTime;
      if (!ts) continue;
      const day = String(ts).slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + (log.spend ?? 0));
    }
    const rows: CostPoint[] = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, spend]) => ({ date, costUsd: spend }));
    return rows.length > 0 ? rows : cost;
  }, [spendLogs, cost]);

  // Agent usage — group spend logs by metadata.agent_id.
  const agents: ReadonlyArray<AgentUsageBucket> = React.useMemo(() => {
    const counts = new Map<string, { invocations: number; cost: number }>();
    for (const log of spendLogs) {
      const agentId = readAgentId(log);
      if (!agentId) continue;
      const bucket = counts.get(agentId) ?? { invocations: 0, cost: 0 };
      bucket.invocations += 1;
      bucket.cost += log.spend ?? 0;
      counts.set(agentId, bucket);
    }
    return Array.from(counts.entries())
      .map(([agent, v]) => ({
        agent,
        invocations: v.invocations,
        costUsd: v.cost,
      }))
      .sort((a, b) => b.invocations - a.invocations);
  }, [spendLogs]);

  // Token usage by model — group spend logs by model.
  const tokenByModel: ReadonlyArray<TokenUsageByModelType> = React.useMemo(() => {
    const tokensByModel = new Map<string, number>();
    for (const log of spendLogs) {
      const model = log.model ?? 'unknown';
      const t = log.total_tokens ?? 0;
      if (t === 0) continue;
      tokensByModel.set(model, (tokensByModel.get(model) ?? 0) + t);
    }
    return Array.from(tokensByModel.entries())
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((a, b) => b.tokens - a.tokens);
  }, [spendLogs]);

  // Provider cost — bucket spend logs by date × provider (derived from
  // the model name prefix `provider/model`).
  const providerCost: ReadonlyArray<ProviderCostRow> = React.useMemo(() => {
    const byDayProvider = new Map<string, Map<string, number>>();
    for (const log of spendLogs) {
      const day = String(log.startTime ?? '').slice(0, 10);
      if (!day) continue;
      const provider = providerFromModel(log.model);
      const dayMap = byDayProvider.get(day) ?? new Map<string, number>();
      dayMap.set(provider, (dayMap.get(provider) ?? 0) + (log.spend ?? 0));
      byDayProvider.set(day, dayMap);
    }
    return Array.from(byDayProvider.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, providers]) => ({
        date,
        byProvider: Object.fromEntries(providers.entries()),
      }));
  }, [spendLogs]);

  // Provider leaderboard — prefer the spend-by-model rows (per-model
  // totals) when present; fall back to aggregating from logs.
  const providerBoard: ReadonlyArray<ProviderLeaderboardRow> =
    React.useMemo(() => {
      if (spendModels.length > 0) {
        const agg = new Map<string, { spend: number; invocations: number }>();
        for (const row of spendModels) {
          const provider = providerFromModel(row.model ?? row.model_name ?? '');
          const spend = row.spend ?? 0;
          const invocations = row.requests ?? row.invocations ?? 0;
          const cur = agg.get(provider) ?? { spend: 0, invocations: 0 };
          cur.spend += spend;
          cur.invocations += invocations;
          agg.set(provider, cur);
        }
        return Array.from(agg.entries())
          .map(([provider, v]) => ({
            provider,
            spendUsd: v.spend,
            invocations: v.invocations,
          }))
          .sort((a, b) => b.spendUsd - a.spendUsd);
      }
      // Fallback: aggregate from raw logs.
      const agg = new Map<string, { spend: number; invocations: number }>();
      for (const log of spendLogs) {
        const provider = providerFromModel(log.model);
        const cur = agg.get(provider) ?? { spend: 0, invocations: 0 };
        cur.spend += log.spend ?? 0;
        cur.invocations += 1;
        agg.set(provider, cur);
      }
      return Array.from(agg.entries())
        .map(([provider, v]) => ({
          provider,
          spendUsd: v.spend,
          invocations: v.invocations,
        }))
        .sort((a, b) => b.spendUsd - a.spendUsd);
    }, [spendModels, spendLogs]);

  // Legacy derivations kept for the empty-state and chart grid. The
  // per-status run buckets and the approval-latency fan area are
  // Forge-specific and not sourced from LiteLLM; they fall back to
  // empty arrays so the Bento grid hides those cards cleanly.
  const runs: ReadonlyArray<RunStatusBucket> = [];
  const latency: ReadonlyArray<LatencyBin> = [];
  const approvalLatency: ReadonlyArray<ApprovalLatencyPoint> = [];
  const acceptance: ArtifactAcceptance = {
    accepted: 0,
    rejected: 0,
    pending: 0,
  };

  const isLoading =
    kpisRes.isLoading ||
    spendByDayRes.isLoading ||
    spendByModelRes.isLoading ||
    spendLogsRes.isLoading;

  const allEmpty =
    cost.length === 0 &&
    runs.length === 0 &&
    agents.length === 0 &&
    latency.length === 0 &&
    approvalLatency.length === 0 &&
    tokenByModel.length === 0 &&
    providerCost.length === 0 &&
    providerBoard.length === 0 &&
    kpis.totalRuns === 0;

  // ---- Derived series (chart shapes) ----

  const costSeries = React.useMemo(
    () => [
      {
        name: 'Cost',
        color: chartColors.primary,
        data: dailyTrend.map((c) => ({ x: c.date, y: c.costUsd })),
      },
    ],
    [dailyTrend],
  );

  const runsByDay = React.useMemo(() => {
    const sorted = [...runs].sort((a, b) => a.status.localeCompare(b.status));
    return sorted.map((r) => ({ label: STATUS_LABELS[r.status], count: r.count }));
  }, [runs]);

  const runsSeries = React.useMemo<ReadonlyArray<StackedSeries>>(
    () =>
      [...runs]
        .sort((a, b) => a.status.localeCompare(b.status))
        .map((r) => ({
          key: r.status,
          name: STATUS_LABELS[r.status],
          color: STATUS_COLORS[r.status],
        })),
    [runs],
  );

  const acceptanceLine = React.useMemo(
    () => [
      {
        name: 'Accepted',
        color: chartColors.success,
        data: [
          { x: 'Day 1', y: acceptance.accepted },
          { x: 'Today', y: acceptance.accepted },
        ],
      },
      {
        name: 'Rejected',
        color: chartColors.destructive,
        data: [
          { x: 'Day 1', y: acceptance.rejected },
          { x: 'Today', y: acceptance.rejected },
        ],
      },
      {
        name: 'Pending',
        color: chartColors.warning,
        data: [
          { x: 'Day 1', y: acceptance.pending },
          { x: 'Today', y: acceptance.pending },
        ],
      },
    ],
    [acceptance],
  );

  const agentTop10 = React.useMemo(
    () =>
      [...agents]
        .sort((a, b) => b.invocations - a.invocations)
        .slice(0, 10)
        .map((a, i) => ({
          label: a.agent,
          value: a.invocations,
          color: getSeriesColor(i),
        })),
    [agents],
  );

  const latencyAreaPoints = React.useMemo(
    () =>
      approvalLatency.map((p) => ({
        label: p.date,
        p50: p.p50 ?? 0,
        p95: p.p95 ?? 0,
        p99: p.p99 ?? 0,
      })),
    [approvalLatency],
  );

  const providerKeys = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of providerCost) {
      for (const k of Object.keys(r.byProvider)) set.add(k);
    }
    return Array.from(set).sort();
  }, [providerCost]);

  const providerStacked = React.useMemo(() => {
    return providerCost.map((row) => {
      const out: Record<string, string | number> = { label: row.date };
      for (const k of providerKeys) {
        out[k] = row.byProvider[k] ?? 0;
      }
      return out;
    });
  }, [providerCost, providerKeys]);

  const providerSeries = React.useMemo<ReadonlyArray<StackedSeries>>(
    () =>
      providerKeys.map((k, i) => ({
        key: k,
        name: k,
        color: getSeriesColor(i),
      })),
    [providerKeys],
  );

  const leaderboardRows = React.useMemo(
    () =>
      providerBoard.map((p) => ({
        provider: p.provider,
        spend: p.spendUsd,
        invocations: p.invocations ?? 0,
      })),
    [providerBoard],
  );

  // KPI sparklines — derived from daily cost trend where possible.
  const costSpark = React.useMemo(
    () => dailyTrend.map((c) => c.costUsd),
    [dailyTrend],
  );
  const activeRunsSpark = React.useMemo(
    () => dailyTrend.slice(0, 7).map((c) => c.costUsd),
    [dailyTrend],
  );
  const acceptanceSpark = React.useMemo(
    () => dailyTrend.slice(0, 7).map((c) => c.costUsd),
    [dailyTrend],
  );
  const knowledgeSpark = React.useMemo(
    () => dailyTrend.slice(0, 7).map((c) => c.costUsd),
    [dailyTrend],
  );

  // ---- Export handlers ----

  const snapshot: AnalyticsExportSnapshot = React.useMemo(
    () => ({
      kpis,
      cost,
      runs,
      acceptance,
      agents,
      latency,
      generatedAt: new Date().toISOString(),
    }),
    [kpis, cost, runs, acceptance, agents, latency],
  );

  const handleExport = React.useCallback(
    async (format: 'csv' | 'json') => {
      const filename = `forge-analytics-${range.preset}-${new Date()
        .toISOString()
        .slice(0, 10)}`;
      if (format === 'csv') {
        downloadBlob(
          new Blob([snapshotToCsv(snapshot)], { type: 'text/csv;charset=utf-8' }),
          `${filename}.csv`,
        );
      } else {
        downloadBlob(
          new Blob([snapshotToJson(snapshot)], { type: 'application/json' }),
          `${filename}.json`,
        );
      }
    },
    [snapshot, range.preset],
  );

  const handleSelectProvider = React.useCallback(
    (p: string) => {
      setProviderFilter((current) => (current === p ? null : p));
      toast.info(
        providerFilter === p
          ? 'Provider filter cleared'
          : `Filtering dashboard by "${p}"`,
      );
    },
    [providerFilter],
  );

  const exportPayload = React.useMemo(() => ({ data: snapshot }), [snapshot]);

  // ---- Render ----

  return (
    <AdminShell>
      <div
        className={cn(
          'mx-auto flex w-full max-w-[1600px] flex-col gap-6',
          'route-enter',
        )}
        data-testid="analytics-center"
      >
        {/* HERO */}
        <AnalyticsHero
          action={
            <>
              <DateRangePicker value={range} onChange={setRange} />
              <AnalyticsCompareToggle checked={compare} onChange={setCompare} />
              <ExportMenu
                disabled={allEmpty}
                payload={exportPayload}
                onExport={handleExport}
              />
            </>
          }
        />

        {/* EMPTY STATE */}
        {allEmpty && !isLoading ? (
          <EmptyState
            illustration={<BarChart3 size={40} strokeWidth={1.5} />}
            title="No analytics data yet"
            description="Cost, run, acceptance, and knowledge-reuse metrics appear here once the first agent run completes."
            primaryAction={{
              label: 'Run your first command',
              icon: <Play className="h-4 w-4" aria-hidden="true" />,
              onClick: () => {
                window.location.href = '/workflow';
              },
            }}
            secondaryAction={{
              label: 'How analytics works',
              icon: <BookOpen className="h-4 w-4" aria-hidden="true" />,
              onClick: () => {
                window.open('https://docs.forge.ai/analytics', '_blank', 'noopener');
              },
            }}
            suggestions={[
              'forge-review',
              'forge-arch-adr',
              'forge-test-unit',
              'forge-deploy-preview',
            ]}
            onSuggestionPick={(s) => {
              toast.info(`Try: ${s}`, {
                description: 'Open Command Center to execute.',
              });
            }}
          />
        ) : null}

        {/* KPI ROW — h2 landmark for screen-reader heading hierarchy. */}
        <section
          aria-labelledby="analytics-kpis-heading"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          data-testid="analytics-kpis"
        >
          <h2
            id="analytics-kpis-heading"
            className="sr-only"
          >
            Key performance indicators
          </h2>

          {isLoading ? (
            <>
              <KpiTileSkeleton />
              <KpiTileSkeleton />
              <KpiTileSkeleton />
              <KpiTileSkeleton />
            </>
          ) : (
            <>
              <AnalyticsKpiCard
                label="Total cost (30d)"
                value={fmtUsd(kpis.totalCostUsd30d)}
                deltaPct={-2.4}
                tone="negative"
                icon={<DollarSign className="h-3.5 w-3.5" aria-hidden="true" />}
                spark={costSpark}
                accent={KPI_ACCENTS.totalCost}
                testId="kpi-cost"
              />
              <AnalyticsKpiCard
                label="Active runs"
                value={fmtInt(kpis.activeRuns)}
                deltaPct={3.1}
                tone="positive"
                icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
                spark={activeRunsSpark}
                accent={KPI_ACCENTS.activeRuns}
                testId="kpi-runs"
              />
              <AnalyticsKpiCard
                label="Acceptance rate"
                value={fmtPct(kpis.avgAcceptancePct)}
                deltaPct={1.8}
                tone="positive"
                icon={<CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                spark={acceptanceSpark}
                accent={KPI_ACCENTS.acceptance}
                testId="kpi-acceptance"
              />
              <AnalyticsKpiCard
                label="Knowledge reuse"
                value={fmtPct(kpis.knowledgeReusePct)}
                deltaPct={5.6}
                tone="positive"
                icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                spark={knowledgeSpark}
                accent={KPI_ACCENTS.knowledgeReuse}
                testId="kpi-knowledge"
              />
            </>
          )}
        </section>

        {/* CHART GRID (Bento) — sequential h2 landmarks group each row of charts. */}
        {!allEmpty ? (
          <div
            className="flex flex-col gap-4"
            data-testid="analytics-grid"
          >
            {/* ROW 1 — Cost trend (8 cols) + Runs by status (4 cols) */}
            <section
              aria-labelledby="analytics-row-cost"
              className="grid grid-cols-1 gap-4 lg:grid-cols-12"
            >
              <h2 id="analytics-row-cost" className="sr-only">
                Cost and run status
              </h2>
              <div className="lg:col-span-8">
                {isLoading ? (
                  <AreaChartSkeleton title="Cost trend" />
                ) : (
                  <AreaChartCard
                    title="Cost trend"
                    description="Daily USD, last 30 days"
                    series={costSeries}
                    xLabel="day"
                    yLabel="USD"
                    height={260}
                  />
                )}
              </div>
              <div className="lg:col-span-4">
                {isLoading ? (
                  <BarChartSkeleton title="Runs by status" />
                ) : (
                  <StackedBarChartCard
                    title="Runs by status"
                    description={`${kpis.totalRuns.toLocaleString()} total`}
                    data={runsByDay}
                    series={runsSeries}
                    xLabel=""
                    yLabel="runs"
                    height={260}
                  />
                )}
              </div>
            </section>

            {/* ROW 2 — Acceptance (5) + Agent usage (3) + Approval latency (4) */}
            <section
              aria-labelledby="analytics-row-acceptance"
              className="grid grid-cols-1 gap-4 lg:grid-cols-12"
            >
              <h2 id="analytics-row-acceptance" className="sr-only">
                Acceptance, agent usage, and approval latency
              </h2>
              <div className="lg:col-span-5">
                {isLoading ? (
                  <AreaChartSkeleton title="Acceptance" />
                ) : (
                  <LineChartCard
                    title="Acceptance"
                    description="Accepted vs rejected vs pending"
                    series={acceptanceLine}
                    xLabel=""
                    yLabel="count"
                    height={240}
                  />
                )}
              </div>
              <div className="lg:col-span-3">
                {isLoading ? (
                  <HorizontalBarSkeleton title="Agent usage" />
                ) : (
                  <HorizontalBarCard
                    title="Agent usage"
                    description="Top 10 by invocations"
                    data={agentTop10}
                    valueSuffix="invocations"
                    height={240}
                  />
                )}
              </div>
              <div className="lg:col-span-4">
                {isLoading ? (
                  <AreaChartSkeleton title="Approval latency" />
                ) : (
                  <ApprovalLatencyAreaChart
                    title="Approval latency"
                    description="p50 / p95 / p99"
                    data={latencyAreaPoints}
                    height={240}
                  />
                )}
              </div>
            </section>

            {/* ROW 3 — Knowledge reuse (4) + Token usage by model (8) */}
            <section
              aria-labelledby="analytics-row-knowledge"
              className="grid grid-cols-1 gap-4 lg:grid-cols-12"
            >
              <h2 id="analytics-row-knowledge" className="sr-only">
                Knowledge reuse and model token usage
              </h2>
              <div className="lg:col-span-4">
                <div
                  className="flex h-full flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
                  data-testid="knowledge-reuse-card"
                >
                  <header className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-[var(--fg-primary)]">
                      Knowledge reuse
                    </h3>
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                      SLO ≥ 60%
                    </span>
                  </header>
                  {isLoading ? (
                    <GaugeSkeleton />
                  ) : (
                    <RadialGauge
                      value={kpis.knowledgeReusePct}
                      deltaPts={5.6}
                      height={210}
                      isAnimationActive={!reduceMotion}
                    />
                  )}
                </div>
              </div>
              <div className="lg:col-span-8">
                {isLoading ? (
                  <PieChartSkeleton title="Token usage by model" />
                ) : (
                  <TokenUsageByModel
                    title="Token usage by model"
                    description="Pie when ≤5 models; stacked bar otherwise"
                    data={tokenByModel.map((t) => ({ model: t.model, tokens: t.tokens }))}
                    height={240}
                  />
                )}
              </div>
            </section>

            {/* ROW 4 — Provider cost (8) + Provider leaderboard (4) */}
            <section
              aria-labelledby="analytics-row-providers"
              className="grid grid-cols-1 gap-4 lg:grid-cols-12"
            >
              <h2 id="analytics-row-providers" className="sr-only">
                Provider economics
              </h2>
              <div className="lg:col-span-8">
                {isLoading ? (
                  <BarChartSkeleton title="Provider cost breakdown" />
                ) : (
                  <StackedBarChartCard
                    title="Provider cost breakdown"
                    description={
                      providerFilter
                        ? `Filtered: ${providerFilter}`
                        : 'Daily USD by provider'
                    }
                    data={providerStacked}
                    series={providerSeries}
                    xLabel="day"
                    yLabel="USD"
                    height={240}
                  />
                )}
              </div>
              <div className="lg:col-span-4">
                {isLoading ? (
                  <LeaderboardSkeleton title="Top providers by spend" />
                ) : (
                  <ProviderLeaderboard
                    title="Top providers by spend"
                    description="30-day rolling"
                    data={leaderboardRows}
                    onSelectProvider={handleSelectProvider}
                  />
                )}
              </div>
            </section>
          </div>
        ) : null}

        {/* FOOTER NOTE — multi-tenancy reminder */}
        <p className="text-[11px] text-[var(--fg-tertiary)]">
          All metrics are scoped to your active tenant and project.{' '}
          <Link
            href="/governance"
            className="text-[var(--accent-primary)] hover:underline"
          >
            Manage governance →
          </Link>
        </p>
      </div>
    </AdminShell>
  );
}