'use client';

/**
 * Zone 2 — KPI Strip (Step 26 polish).
 *
 * Six tiles summarizing the day's operational health. When the
 * orchestrator is unreachable (Fix 3):
 *   - We render the LAST KNOWN value, not "—".
 *   - A "(stale · 2m ago)" subscript appears under the value.
 *   - The sparkline still renders but at opacity 0.5.
 *   - Hover tooltip explains when data was last refreshed.
 *
 * Skill influence:
 *   - `style` (Data-Dense Dashboard) — KPI strip is the canonical
 *     "row of cards" affordance.
 *   - `chart` (Compare Categories) — each tile pairs a number with a
 *     labeled secondary descriptor.
 *   - `ux` (Content Jumping) — fixed 140 px tile height reserves
 *     space during the initial load.
 */

import * as React from 'react';
import Link from 'next/link';
import { Bot, CheckCircle2, Clock, Coins, DollarSign, Play } from 'lucide-react';
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sparkline } from '@/components/charts/Sparkline';
import { cn } from '@/lib/utils';

import { ACCENT_VAR, formatDelta, formatKpi } from './GreetingBar';
import { StaleBadge, snapshotAgeSec } from './StaleBadge';
import { useRefreshGlow } from './RefreshButton';
import type { DashboardSnapshot } from './mock-data';
import type { KpiMetric } from './types';

interface KpiConfig {
  id: KpiMetric;
  label: string;
  href: string;
  Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** Optional prefix character on the metric value (e.g. "$"). */
  prefix?: string;
}

const KPI_TILES: ReadonlyArray<KpiConfig> = [
  { id: 'active-agents', label: 'Active Agents', href: '/agent-center', Icon: Bot },
  { id: 'runs-today', label: 'Runs Today', href: '/runs', Icon: Play },
  { id: 'success-rate', label: 'Success Rate', href: '/runs?status=success', Icon: CheckCircle2, prefix: '' },
  { id: 'avg-latency', label: 'Avg Latency', href: '/runs?sort=latency', Icon: Clock },
  { id: 'cost-today', label: 'Cost Today', href: '/analytics?tab=cost', Icon: DollarSign, prefix: '$' },
  { id: 'tokens-used', label: 'Tokens Used', href: '/analytics?tab=tokens', Icon: Coins },
];

export function KPIStrip({ snapshot, refreshKey = 0 }: { snapshot: DashboardSnapshot; refreshKey?: number }) {
  const online = snapshot.online;
  const ageSec = snapshotAgeSec(snapshot.generatedAt, online);
  void refreshKey;

  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      data-testid="dashboard-kpi-strip"
    >
      {KPI_TILES.map((tile) => (
        <KpiTile key={tile.id} tile={tile} snapshot={snapshot} ageSec={ageSec} />
      ))}
    </div>
  );
}

function KpiTile({
  tile,
  snapshot,
  ageSec,
}: {
  tile: KpiConfig;
  snapshot: DashboardSnapshot;
  ageSec: number;
}) {
  const online = snapshot.online;
  const m = snapshot.metrics[tile.id];
  const delta = formatDelta(m.delta);
  const color = ACCENT_VAR[m.accent];
  const glow = useRefreshGlow();
  // "Never had data" = trend is empty array (Fix 3 spec).
  const neverHadData = !online && (m.trend.length === 0 || m.trend.every((v) => v === 0));
  const value = neverHadData ? '—' : formatKpi(tile.id, m.value);

  const tooltipMessage = online
    ? 'Live data from orchestrator'
    : neverHadData
      ? 'No historical data yet. Will populate after the orchestrator responds.'
      : `Last updated ${Math.max(1, Math.round(ageSec / 60))}m ago when orchestrator was reachable. Will refresh automatically when connection is restored.`;

  return (
    <TooltipProvider delayDuration={300}>
      <ShadcnTooltip>
        <TooltipTrigger asChild>
          <Link
            href={tile.href}
            className={cn(
              'card-hover group relative flex h-[140px] flex-col justify-between overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]',
              !online ? 'stale-border' : '',
              glow ? 'refresh-glow' : '',
            )}
            data-testid={`kpi-tile-${tile.id}`}
            data-online={online ? 'true' : 'false'}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md"
                  style={{ background: `${color}1A`, color }}
                  aria-hidden="true"
                >
                  <tile.Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-[var(--text-xs)] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
                  {tile.label}
                </span>
              </div>
              <DeltaChip text={delta.text} positive={delta.positive} muted={neverHadData} online={online} ageSec={ageSec} />
            </div>

            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="flex items-baseline gap-1 font-mono text-[28px] font-bold leading-none tracking-tight text-[var(--fg-primary)]">
                  {neverHadData ? (
                    <>
                      <span aria-hidden="true">
                        <Clock className="inline h-3 w-3 text-[var(--fg-tertiary)]" />
                      </span>
                      <span>{value}</span>
                    </>
                  ) : (
                    <>
                      {!online ? (
                        <Clock
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 text-[var(--accent-amber)]"
                          data-testid={`kpi-stale-icon-${tile.id}`}
                        />
                      ) : null}
                      {tile.prefix && !neverHadData ? tile.prefix : ''}
                      <span className={cn(!online ? 'text-[var(--fg-secondary)]' : '')}>{value}</span>
                      <span className="ml-0.5 text-[var(--text-md)] font-medium text-[var(--fg-tertiary)]">
                        {m.unit && !neverHadData ? m.unit : ''}
                      </span>
                    </>
                  )}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--fg-tertiary)]">
                  <span>{m.label}</span>
                </p>
              </div>
            </div>

            <div className={cn('-mb-1', !online && !neverHadData ? 'opacity-50' : '')}>
              <Sparkline
                data={neverHadData ? [0, 0] : m.trend}
                color={color}
                height={32}
                ariaLabel={`${tile.label} trend`}
              />
            </div>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="max-w-[260px]">
          {tooltipMessage}
        </TooltipContent>
      </ShadcnTooltip>
    </TooltipProvider>
  );
}

function DeltaChip({ text, positive, muted, online, ageSec }: { text: string; positive: boolean; muted: boolean; online: boolean; ageSec: number }) {
  if (muted) {
    return (
      <span className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-tertiary)]">
        --
      </span>
    );
  }
  // When stale, render as a StaleBadge alongside the delta text.
  if (!online) {
    return <StaleBadge ageSec={ageSec} compact />;
  }
  const tone = positive
    ? 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
    : 'border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium',
        tone,
      )}
      aria-label={`Change ${text}`}
    >
      {text}
    </span>
  );
}