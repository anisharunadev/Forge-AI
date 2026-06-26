'use client';

/**
 * HealthTab — Zone 6 in the Step 31 spec.
 *
 * KPI strip · filter chips · virtualized table · failure-rate line chart.
 */

import * as React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Search,
  Stethoscope,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  STATUS_LABEL,
  STATUS_ORDER,
  listConnected,
  resolveIcon,
  sparklineFor,
  type ConnectorHealthStatus,
} from '@/lib/connectors';
import { fmtTimeAgo } from '../constants';
import { ConnectorHealthIndicator } from '@/components/connectors/ConnectorHealthIndicator';
import { KpiTile } from '../KpiTile';
import { cn } from '@/lib/utils';

const FILTER_CHIPS: ReadonlyArray<ConnectorHealthStatus | 'all'> = [
  'all',
  'healthy',
  'syncing',
  'stale',
  'failed',
  'quarantined',
  'paused',
];

export function HealthTab() {
  const [filter, setFilter] = React.useState<string>('all');
  const [query, setQuery] = React.useState('');
  const [quarantined, setQuarantined] = React.useState<Set<string>>(new Set());

  const connectors = listConnected();
  const kpis = {
    healthy: connectors.filter((c) => c.status === 'healthy').length,
    syncing: connectors.filter((c) => c.status === 'syncing').length,
    stale: connectors.filter((c) => c.status === 'stale').length,
    failed: connectors.filter((c) => c.status === 'failed' || c.status === 'quarantined').length,
  };

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return connectors.filter((c) => {
      if (filter !== 'all' && c.status !== filter) return false;
      if (q && !c.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [connectors, filter, query]);

  const toggleQuarantine = (id: string) => {
    setQuarantined((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Failure-rate trend — 14 days of synthetic data, peaks align with the
  // current failed connectors so the chart tells a coherent story.
  const failureTrend = React.useMemo(() => {
    return sparklineFor(14).map((v, i) => ({
      day: `D${i + 1}`,
      errorRate: Math.max(0.1, 5.2 - v * 0.03 + (i === 9 ? 1.6 : 0) + (i === 12 ? 0.9 : 0)),
    }));
  }, []);

  return (
    <div className="flex flex-col gap-4" data-testid="connector-health-tab">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Healthy" value={String(kpis.healthy)} Icon={CheckCircle2} accent="emerald" sparkData={sparklineFor()} sub="across 14 categories" />
        <KpiTile label="Syncing" value={String(kpis.syncing)} Icon={RefreshCw} accent="cyan" sparkData={sparklineFor().map((v) => v - 6)} sub="real-time + scheduled" />
        <KpiTile label="Stale" value={String(kpis.stale)} Icon={AlertTriangle} accent="amber" sparkData={sparklineFor(14).map((v) => v - 14)} sub="no sync > 24h" />
        <KpiTile label="Failed" value={String(kpis.failed)} Icon={AlertOctagon} accent="rose" sparkData={sparklineFor(14).map((v) => v - 18)} sub="auto-quarantine at 5 fails" />
      </div>

      {/* Filter chips + re-run */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Stethoscope className="h-3.5 w-3.5 text-fg-tertiary" aria-hidden="true" />
          {FILTER_CHIPS.map((opt) => {
            const active = filter === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setFilter(opt)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-[10px] capitalize',
                  active
                    ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]'
                    : 'border-[var(--border-subtle)] text-fg-tertiary hover:text-fg-secondary',
                )}
                aria-pressed={active}
              >
                {opt === 'all' ? 'All' : STATUS_LABEL[opt]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="h-8 w-[180px] pl-7 text-xs"
            />
          </div>
          <Button size="sm" variant="outline">
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Re-run health check
          </Button>
          <span className="text-[10px] text-fg-tertiary">Last run: 2m ago</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        <table className="w-full text-xs">
          <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-left text-[10px] uppercase tracking-wider text-fg-tertiary">
            <tr>
              <th className="px-3 py-2">Connector</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last sync</th>
              <th className="px-3 py-2">Last success</th>
              <th className="px-3 py-2">Last failure</th>
              <th className="px-3 py-2">Error rate</th>
              <th className="px-3 py-2">p95</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {filtered.map((c) => {
              const Icon = resolveIcon(c.id);
              const isFailed = c.status === 'failed' || c.status === 'quarantined';
              const isQuarantined = quarantined.has(c.id) || c.status === 'quarantined';
              return (
                <tr
                  key={c.id}
                  className={cn(
                    'transition-colors hover:bg-[var(--bg-surface)]',
                    isFailed && !isQuarantined && 'bg-[var(--accent-rose)]/[0.04]',
                  )}
                  data-testid="health-row"
                  data-connector-id={c.id}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-fg-tertiary" aria-hidden="true" />
                      <span className="text-fg-primary">{c.displayName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <ConnectorHealthIndicator
                      connectorId={c.id}
                      status={isQuarantined ? 'quarantined' : c.status}
                      showLabel
                      size="xs"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-fg-secondary">{fmtTimeAgo(c.lastSyncAt)}</td>
                  <td className="px-3 py-2 font-mono text-fg-secondary">
                    {c.lastSuccessAt ? fmtTimeAgo(c.lastSuccessAt) : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-fg-secondary">
                    {c.lastFailureAt ? fmtTimeAgo(c.lastFailureAt) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-block h-1.5 rounded-full',
                          c.health.errorRate < 0.01
                            ? 'bg-[var(--accent-emerald)]'
                            : c.health.errorRate < 0.05
                              ? 'bg-[var(--accent-amber)]'
                              : 'bg-[var(--accent-rose)]',
                        )}
                        style={{ width: `${Math.min(80, c.health.errorRate * 800)}px` }}
                      />
                      <span className="font-mono text-fg-secondary">
                        {(c.health.errorRate * 100).toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-fg-secondary">{c.health.p95Ms}ms</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      {isFailed ? (
                        <>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]">
                            Retry
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] text-[var(--accent-rose)]"
                            onClick={() => toggleQuarantine(c.id)}
                            aria-pressed={isQuarantined}
                          >
                            {isQuarantined ? 'Unquarantine' : 'Quarantine'}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]">
                          Probe
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-xs text-fg-tertiary">
                  No connectors match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Failure trend */}
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-fg-primary">Failure rate — last 14 days</h3>
          <span className="text-[11px] text-fg-tertiary">Peaks annotated with incidents</span>
        </header>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={failureTrend} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="day" stroke="var(--fg-tertiary)" fontSize={10} tickLine={false} />
              <YAxis stroke="var(--fg-tertiary)" fontSize={10} tickLine={false} width={32} />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: 'var(--fg-primary)' }}
              />
              <Line
                type="monotone"
                dataKey="errorRate"
                stroke="var(--accent-rose)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}