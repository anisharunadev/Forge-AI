'use client';

/**
 * KpiStrip — four KPI tiles (Step 20).
 *
 * Each tile: 140px tall, icon (color-coded), count, delta label, and a
 * Recharts-free inline sparkline (so this stays a server component when
 * the parent is server, and we avoid Recharts inside the strip itself).
 *
 * Sparkline = 60px tall SVG path, no axis, no tooltip — matches the
 * `SPARKLINE_HEIGHT` rule in `src/components/charts/index.tsx`.
 */

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type KpiKey = 'epics' | 'open-stories' | 'stories-in-dev' | 'velocity';

export interface KpiTile {
  key: KpiKey;
  label: string;
  value: string;
  /** "+3 this week" or "-2 vs last sprint". */
  delta?: string;
  /** "trending up" or "trending down" — drives Arrow icon. */
  trend?: 'up' | 'down' | 'flat';
  /** Trailing helper — "across 4 agents" / "last 6 sprints". */
  caption?: string;
  /** Sparkline series (numbers). */
  sparkline: ReadonlyArray<number>;
  /** Accent color channel. */
  accent: 'indigo' | 'cyan' | 'amber' | 'emerald';
  icon: React.ReactNode;
}

const ACCENT: Record<KpiTile['accent'], { text: string; bg: string; stroke: string }> = {
  indigo: {
    text: 'text-[var(--accent-primary)]',
    bg: 'bg-[var(--accent-primary)]/15',
    stroke: 'var(--accent-primary)',
  },
  cyan: {
    text: 'text-[var(--accent-cyan)]',
    bg: 'bg-[var(--accent-cyan)]/15',
    stroke: 'var(--accent-cyan)',
  },
  amber: {
    text: 'text-[var(--accent-amber)]',
    bg: 'bg-[var(--accent-amber)]/15',
    stroke: 'var(--accent-amber)',
  },
  emerald: {
    text: 'text-[var(--accent-emerald)]',
    bg: 'bg-[var(--accent-emerald)]/15',
    stroke: 'var(--accent-emerald)',
  },
};

export interface KpiStripProps {
  tiles: ReadonlyArray<KpiTile>;
}

export function KpiStrip({ tiles }: KpiStripProps) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="project-kpi-strip"
    >
      {tiles.map((t) => (
        <KpiCard key={t.key} tile={t} />
      ))}
    </div>
  );
}

function KpiCard({ tile }: { tile: KpiTile }) {
  const a = ACCENT[tile.accent];
  return (
    <div
      className={cn(
        'flex h-[140px] flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4',
        'transition-colors duration-200 hover:border-[var(--border-default)]',
      )}
      data-testid={`project-kpi-${tile.key}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-md',
              a.bg,
              a.text,
            )}
            aria-hidden="true"
          >
            {tile.icon}
          </span>
          <p className="text-[11px] font-medium text-[var(--fg-tertiary)]">
            {tile.label}
          </p>
        </div>
        {tile.delta ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
              tile.trend === 'down'
                ? 'text-[var(--accent-rose)]'
                : tile.trend === 'up'
                ? 'text-[var(--accent-emerald)]'
                : 'text-[var(--fg-tertiary)]',
            )}
            data-trend={tile.trend ?? 'flat'}
          >
            {tile.trend === 'down' ? (
              <ArrowDown className="h-3 w-3" aria-hidden="true" />
            ) : tile.trend === 'up' ? (
              <ArrowUp className="h-3 w-3" aria-hidden="true" />
            ) : null}
            {tile.delta}
          </span>
        ) : null}
      </div>
      <div className="flex items-end justify-between">
        <p className="font-mono text-[24px] font-semibold leading-none text-[var(--fg-primary)]">
          {tile.value}
        </p>
        {tile.caption ? (
          <p className="text-[10px] text-[var(--fg-tertiary)]">{tile.caption}</p>
        ) : null}
      </div>
      <Sparkline data={tile.sparkline} stroke={a.stroke} />
    </div>
  );
}

function Sparkline({
  data,
  stroke,
}: {
  data: ReadonlyArray<number>;
  stroke: string;
}) {
  if (data.length === 0) {
    return <div className="h-[36px]" aria-hidden="true" />;
  }
  const w = 100;
  const h = 36;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = w / Math.max(1, data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="mt-auto"
    >
      <defs>
        <linearGradient id={`spark-${stroke}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <polygon
        fill={`url(#spark-${stroke})`}
        points={`0,${h} ${points} ${w},${h}`}
      />
    </svg>
  );
}

/**
 * `defaultKpiTiles` and `DefaultKpiInput` are intentionally NOT
 * re-exported here. This file is `'use client'`; re-exporting
 * the server-safe helper from here would mark the function as
 * a client export, and any server component that called it would
 * throw "Attempted to call defaultKpiTiles() from the server".
 * Server callers should import directly from `./kpi-defaults`:
 *
 *   import { defaultKpiTiles } from '@/components/project-intelligence/kpi-defaults';
 */
