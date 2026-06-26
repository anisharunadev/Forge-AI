'use client';

/**
 * KpiTileRow — 4-tile KPI strip for the Governance Center hero
 * (Phase 0.5-08 redesign).
 *
 * Each tile: number · label · 40px Recharts sparkline · delta
 * (semantic color). Per the style rule "Color Only", every status is
 * also a textual label, never just a colored dot.
 *
 * Sparkline implementation: Recharts AreaChart wrapped in
 * <ChartContainer height={40}> so the data, axis, and tooltip are
 * themed via the design-system wrapper.
 */

import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

import { cn } from '@/lib/utils';
import type { ApprovalRequest, Policy, RbacRole, BoardConfirmation } from '@/lib/governance/data';

export interface KpiTile {
  key: string;
  label: string;
  value: string | number;
  /** Positive = up, negative = down, neutral = flat. */
  delta: string;
  trend: 'up' | 'down' | 'flat';
  /** Sparkline series (last N data points). */
  spark: ReadonlyArray<number>;
  /** Accent channel for the sparkline / dot. */
  accentVar: string;
}

export interface KpiTileRowProps {
  pendingApprovals: ReadonlyArray<ApprovalRequest>;
  boardConfirmations: ReadonlyArray<BoardConfirmation>;
  policies: ReadonlyArray<Policy>;
  rbacRoles: ReadonlyArray<RbacRole>;
}

function buildSpark(seed: number, count = 12): ReadonlyArray<number> {
  // Deterministic pseudo-random series so SSR matches CSR — same
  // approach as AgentCenterBento's ActivityHeatmap.
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(((seed * 7 + i * 13 + (seed % 5)) % 11) + 4);
  }
  return out;
}

function buildTiles(props: KpiTileRowProps): ReadonlyArray<KpiTile> {
  const { pendingApprovals, boardConfirmations, policies, rbacRoles } = props;
  return [
    {
      key: 'pending-approvals',
      label: 'Pending Approvals',
      value: pendingApprovals.length,
      delta: pendingApprovals.length > 0 ? `+${pendingApprovals.length} today` : 'Caught up',
      trend: pendingApprovals.length > 0 ? 'up' : 'flat',
      spark: buildSpark(3),
      accentVar: 'var(--accent-amber)',
    },
    {
      key: 'board-confirmations',
      label: 'Board Confirmations · 7d',
      value: boardConfirmations.length,
      delta: boardConfirmations.length > 0 ? `+${boardConfirmations.length} this week` : '—',
      trend: boardConfirmations.length > 0 ? 'up' : 'flat',
      spark: buildSpark(5),
      accentVar: 'var(--accent-cyan)',
    },
    {
      key: 'active-policies',
      label: 'Active Policies',
      value: policies.filter((p) => p.status === 'active').length,
      delta: '±0 this week',
      trend: 'flat',
      spark: buildSpark(7),
      accentVar: 'var(--accent-violet)',
    },
    {
      key: 'rbac-roles',
      label: 'RBAC Roles',
      value: rbacRoles.length,
      delta: 'Owner · Admin · Editor · Viewer',
      trend: 'flat',
      spark: buildSpark(11),
      accentVar: 'var(--accent-primary)',
    },
  ];
}

function trendClasses(trend: KpiTile['trend']): string {
  switch (trend) {
    case 'up':
      return 'text-[var(--accent-emerald)]';
    case 'down':
      return 'text-[var(--accent-rose)]';
    case 'flat':
    default:
      return 'text-[var(--fg-tertiary)]';
  }
}

function Sparkline({ data, accentVar }: { data: ReadonlyArray<number>; accentVar: string }) {
  if (data.length === 0) return null;
  const gradId = React.useId();
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full" data-testid="kpi-sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...chartData]} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accentVar} stopOpacity={0.4} />
              <stop offset="100%" stopColor={accentVar} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={accentVar}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function KpiTileRow(props: KpiTileRowProps) {
  const tiles = React.useMemo(() => buildTiles(props), [props]);

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      role="list"
      aria-label="Governance KPIs"
      data-testid="kpi-tile-row"
    >
      {tiles.map((t) => (
        <article
          key={t.key}
          role="listitem"
          className={cn(
            'flex h-[140px] flex-col justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4',
          )}
          data-testid={`kpi-tile-${t.key}`}
        >
          <div className="flex items-center justify-between">
            <p className="text-[var(--text-sm)] text-[var(--fg-tertiary)]">
              {t.label}
            </p>
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: t.accentVar }}
            />
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col">
              <p
                className="text-[var(--text-3xl)] font-bold leading-none text-[var(--fg-primary)]"
                style={{ fontWeight: 'var(--font-weight-bold)' }}
              >
                {t.value}
              </p>
              <p
                className={cn('mt-1 text-[var(--text-xs)]', trendClasses(t.trend))}
              >
                {t.delta}
              </p>
            </div>
            <div className="w-24">
              <Sparkline data={t.spark} accentVar={t.accentVar} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}