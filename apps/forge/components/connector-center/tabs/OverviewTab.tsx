'use client';

/**
 * OverviewTab — Zone 3 in the Step 31 spec.
 *
 * Layout:
 *   - KPI strip (5 tiles)
 *   - Row 1: Recent sync activity (flex-2) · Top connectors (flex-1) · Health donut (flex-1)
 *   - Row 2: Used in workflows (flex-1) · Credentials health (flex-1)
 *   - Row 3: Recommended connectors (full)
 *   - Row 4: Connection graph preview (full)
 */

import * as React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  DollarSign,
  Pause,
  PauseCircle,
  Plug,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Zap,
  XCircle,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import { ConnectorHealthIndicator } from '@/components/connectors/ConnectorHealthIndicator';
import { ConnectorHealthRing } from '../ConnectorHealthRing';
import { ConnectionGraph } from '../ConnectionGraph';
import { KpiTile } from '../KpiTile';
import { CREDENTIAL_TYPE_LABEL, RECOMMENDED, STATUS_LABEL, listConnected, listCredentials, resolveIcon, sparklineFor, SYNC_HISTORY_24H, topByUsage, useConnectors, type ConnectorHealthStatus } from '@/lib/connectors';
import { fmtCompact, fmtTimeAgo, maskSecret } from '../constants';
import { cn } from '@/lib/utils';

const HEALTH_COLORS: Record<string, string> = {
  healthy: 'var(--accent-emerald)',
  syncing: 'var(--accent-cyan)',
  stale: 'var(--accent-amber)',
  failed: 'var(--accent-rose)',
  quarantined: 'var(--accent-rose)',
  paused: 'var(--fg-tertiary)',
};

export function OverviewTab() {
  const { rollup, liveEvents } = useConnectors();
  const installed = listConnected();
  const top = topByUsage(6);
  const credentials = listCredentials();
  const expiringCount = credentials.filter(
    (c) => c.credential.status === 'expiring' || c.credential.status === 'expired',
  ).length;

  // Health donut data
  const healthSegments = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of installed) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    return Array.from(counts.entries()).map(([key, value]) => ({
      key,
      label: STATUS_LABEL[key as ConnectorHealthStatus],
      value,
      color: HEALTH_COLORS[key],
    }));
  }, [installed]);

  // "Used in workflows" stacked-bar data
  const usageRows = React.useMemo(() => {
    return top.slice(0, 5).map((c) => ({
      name: c.displayName,
      Workflow: c.usage.workflows,
      Ideation: c.usage.ideationSources,
      Destination: c.usage.destinations,
      Agent: c.usage.agentContexts,
    }));
  }, [top]);

  // "Streaming" simulation — append a fake event every 4s to give the
  // tile a live feel without hitting any backend.
  const [paused, setPaused] = React.useState(false);
  const [extra, setExtra] = React.useState<typeof liveEvents[number] | null>(null);
  React.useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      const c = installed[Math.floor(Math.random() * installed.length)];
      const verbs = ['pulled', 'pushed', 'synced', 'fetched'];
      const nouns = ['issues', 'PRs', 'metrics', 'tickets', 'docs', 'logs'];
      setExtra({
        connectorId: c.id,
        connectorName: c.displayName,
        at: new Date().toISOString(),
        label: `${verbs[Math.floor(Math.random() * verbs.length)]} ${Math.floor(Math.random() * 30 + 1)} ${nouns[Math.floor(Math.random() * nouns.length)]}`,
        status: Math.random() > 0.92 ? 'failed' : c.status,
      });
    }, 4200);
    return () => clearInterval(t);
  }, [paused, installed]);

  const streamRows = React.useMemo(() => {
    const out = extra ? [extra, ...liveEvents.slice(0, 19)] : liveEvents.slice(0, 20);
    return out;
  }, [extra, liveEvents]);

  const totalUsageCalls = installed.reduce((a, c) => a + c.usage.apiCallsToday, 0);

  return (
    <div className="flex flex-col gap-4" data-testid="connector-overview-tab">
      {/* Row 0 — KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile
          label="Connected"
          value={String(rollup.connected)}
          delta="+2 this week"
          trend="up"
          Icon={Plug}
          accent="cyan"
          sparkData={sparklineFor().map((v, i) => v + 8 + i)}
        />
        <KpiTile
          label="Synced today"
          value={fmtCompact(rollup.syncsToday)}
          delta="+14%"
          trend="up"
          Icon={RefreshCw}
          accent="emerald"
          sparkData={sparklineFor()}
        />
        <KpiTile
          label="Failing"
          value={String(rollup.failed + rollup.quarantined)}
          delta={rollup.failed > 0 ? '−1' : '0'}
          trend={rollup.failed > 0 ? 'down' : 'flat'}
          Icon={AlertTriangle}
          accent="rose"
          sparkData={sparklineFor(14).map((v) => v - 12)}
        />
        <KpiTile
          label="API calls"
          value={fmtCompact(totalUsageCalls)}
          delta={`${Math.round(rollup.rateLimitUsed * 100)}% of cap`}
          trend="flat"
          Icon={Zap}
          accent="indigo"
          sparkData={sparklineFor().map((v) => v + 14)}
        />
        <KpiTile
          label="Est. cost / mo"
          value={`$${fmtCompact(rollup.monthlyCostUsd)}`}
          delta="−$24"
          trend="down"
          Icon={DollarSign}
          accent="amber"
          sparkData={sparklineFor().map((v) => v - 4)}
        />
      </div>

      {/* Row 1 — Live stream + Top connectors + Health donut */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* Live stream */}
        <div
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 xl:col-span-1"
          data-testid="overview-recent-activity"
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-fg-primary">Recent sync activity</h3>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                  paused
                    ? 'text-fg-tertiary'
                    : 'border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)]',
                )}
                data-testid="live-stream-status"
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    paused
                      ? 'bg-fg-tertiary'
                      : 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)] animate-pulse',
                  )}
                  aria-hidden="true"
                />
                {paused ? 'Paused' : 'Streaming'}
              </span>
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] text-fg-secondary hover:bg-[var(--bg-surface)]"
                aria-label={paused ? 'Resume stream' : 'Pause stream'}
              >
                {paused ? <CircleDot className="h-3 w-3" aria-hidden="true" /> : <Pause className="h-3 w-3" aria-hidden="true" />}
                {paused ? 'Resume' : 'Pause'}
              </button>
              <a
                href="?tab=activity"
                className="inline-flex items-center gap-0.5 text-[11px] text-fg-tertiary hover:text-fg-secondary"
              >
                Activity →
              </a>
            </div>
          </header>
          <ul className="max-h-[260px] divide-y divide-[var(--border-subtle)] overflow-y-auto">
            {streamRows.map((row, i) => {
              const Icon = resolveIcon(row.connectorId);
              const isFresh = i === 0 && extra?.at === row.at;
              return (
                <li
                  key={`${row.connectorId}-${row.at}-${i}`}
                  className={cn(
                    'flex items-center gap-2 py-1.5 text-xs',
                    isFresh && 'animate-in slide-in-from-top-2 fade-in-0',
                  )}
                  data-testid="live-stream-row"
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      row.status === 'failed'
                        ? 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)]'
                        : 'bg-[var(--accent-emerald)]',
                    )}
                    aria-hidden="true"
                  />
                  <Icon className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-fg-primary">
                    <span className="font-medium">{row.connectorName}</span>
                    <span className="text-fg-tertiary"> · {row.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-fg-tertiary">
                    {fmtTimeAgo(row.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Top connectors by usage (BarChart) */}
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 xl:col-span-1">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-fg-primary">Most-used</h3>
            <a href="?tab=connected" className="text-[11px] text-fg-tertiary hover:text-fg-secondary">
              View all →
            </a>
          </header>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={top.map((c) => ({
                  name: c.displayName,
                  value: c.usage.workflows + c.usage.destinations + c.usage.ideationSources + c.usage.agentContexts,
                }))}
                layout="vertical"
                margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={90}
                  stroke="var(--fg-tertiary)"
                  fontSize={11}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--fg-primary)' }}
                  itemStyle={{ color: 'var(--accent-cyan)' }}
                />
                <Bar dataKey="value" fill="var(--accent-cyan)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Health donut */}
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 xl:col-span-1">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-fg-primary">Health</h3>
            <a href="?tab=health" className="text-[11px] text-fg-tertiary hover:text-fg-secondary">
              View health →
            </a>
          </header>
          <div className="flex h-[260px] items-center justify-center">
            <ConnectorHealthRing segments={healthSegments} centerLabel={String(rollup.connected)} />
          </div>
        </div>
      </div>

      {/* Row 2 — Used in workflows (stacked) + Credentials health */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-fg-primary">Connector usage across the app</h3>
            <a href="?tab=connected" className="text-[11px] text-fg-tertiary hover:text-fg-secondary">
              Details →
            </a>
          </header>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={usageRows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--fg-tertiary)" fontSize={10} tickLine={false} />
                <YAxis stroke="var(--fg-tertiary)" fontSize={10} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--fg-primary)' }}
                />
                <Bar dataKey="Workflow" stackId="u" fill="var(--accent-cyan)" />
                <Bar dataKey="Ideation" stackId="u" fill="var(--accent-amber)" />
                <Bar dataKey="Destination" stackId="u" fill="var(--accent-emerald)" />
                <Bar dataKey="Agent" stackId="u" fill="var(--accent-violet)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-fg-tertiary">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[var(--accent-cyan)]" /> Workflow</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[var(--accent-amber)]" /> Ideation source</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[var(--accent-emerald)]" /> Destination</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[var(--accent-violet)]" /> Agent context</span>
          </div>
        </div>

        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-fg-primary">Credentials</h3>
            <a href="?tab=credentials" className="text-[11px] text-fg-tertiary hover:text-fg-secondary">
              Manage →
            </a>
          </header>
          <ul className="space-y-2">
            {credentials.slice(0, 5).map((row) => {
              const Icon = resolveIcon(row.connector.id);
              const c = row.credential;
              const ageDays = Math.floor(
                (Date.now() - new Date(c.lastRotatedAt).getTime()) / 86_400_000,
              );
              const tone =
                c.status === 'expired'
                  ? 'rose'
                  : c.status === 'expiring' || ageDays > 90
                    ? 'amber'
                    : ageDays > 30
                      ? 'amber'
                      : 'emerald';
              const toneClass =
                tone === 'rose'
                  ? 'border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]'
                  : tone === 'amber'
                    ? 'border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]'
                    : 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]';
              return (
                <li
                  key={row.connector.id}
                  className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-fg-primary">
                        {row.connector.displayName}{' '}
                        <span className="font-mono text-[10px] text-fg-tertiary">
                          {maskSecret(c.lengthChars)}
                        </span>
                      </div>
                      <div className="text-[11px] text-fg-tertiary">
                        {CREDENTIAL_TYPE_LABEL[c.type]} · rotated {ageDays}d ago by{' '}
                        {c.rotatedBy || '—'}
                      </div>
                    </div>
                  </div>
                  <span
                    className={cn('rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider', toneClass)}
                  >
                    {c.status === 'active' && tone === 'emerald'
                      ? 'Healthy'
                      : c.status === 'active' && tone === 'amber'
                        ? `${ageDays}d old`
                        : c.status === 'expiring'
                          ? 'Expiring'
                          : 'Expired'}
                  </span>
                </li>
              );
            })}
          </ul>
          {expiringCount > 0 ? (
            <Button size="sm" className="mt-3 w-full" variant="outline">
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Rotate all expiring ({expiringCount})
            </Button>
          ) : (
            <p className="mt-3 text-center text-[11px] text-fg-tertiary">
              All credentials are within rotation window.
            </p>
          )}
        </div>
      </div>

      {/* Row 3 — Recommended */}
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-base font-semibold text-fg-primary">
            <Sparkles className="h-4 w-4 text-[var(--accent-violet)]" aria-hidden="true" />
            Recommended for you
          </h3>
          <span className="text-[11px] text-fg-tertiary">Based on your usage</span>
        </header>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {RECOMMENDED.map((r) => {
            const Icon = resolveIcon(r.id);
            return (
              <div
                key={r.id}
                className="flex flex-col rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
              >
                <div className="flex items-start gap-2">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] text-fg-secondary">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-medium text-fg-primary">{r.displayName}</h4>
                    <p className="text-[11px] text-fg-tertiary">{r.tagline}</p>
                  </div>
                </div>
                <p
                  className="mt-2 text-[11px] leading-relaxed text-fg-secondary"
                  title={r.reason}
                >
                  <span className="text-fg-tertiary">Why?</span> {r.reason.slice(0, 88)}…
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <a href="?tab=marketplace">Install</a>
                  </Button>
                  <button
                    type="button"
                    className="text-[10px] text-fg-tertiary hover:text-fg-secondary"
                    title={r.reason}
                  >
                    Why?
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Row 4 — Connection graph preview */}
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-fg-primary">Connection graph</h3>
          <a href="?tab=connections" className="text-[11px] text-fg-tertiary hover:text-fg-secondary">
            Open full view →
          </a>
        </header>
        <ConnectionGraph height={200} compact />
      </div>
    </div>
  );
}