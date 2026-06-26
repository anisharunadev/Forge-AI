'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { WorkflowKPI } from '@/lib/workflow/types';

const ACCENT_BG: Record<WorkflowKPI['accent'], string> = {
  indigo: 'bg-[rgba(99,102,241,0.10)] text-[var(--accent-primary)]',
  cyan: 'bg-[rgba(6,182,212,0.10)] text-[var(--accent-cyan)]',
  amber: 'bg-[rgba(245,158,11,0.10)] text-[var(--accent-amber)]',
  emerald: 'bg-[rgba(16,185,129,0.10)] text-[var(--accent-emerald)]',
};

const ACCENT_LINE: Record<WorkflowKPI['accent'], string> = {
  indigo: 'stroke-[var(--accent-primary)]',
  cyan: 'stroke-[var(--accent-cyan)]',
  amber: 'stroke-[var(--accent-amber)]',
  emerald: 'stroke-[var(--accent-emerald)]',
};

function MiniSparkline({ values, accent }: { values: ReadonlyArray<number>; accent: WorkflowKPI['accent'] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 64;
  const h = 22;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ACCENT_LINE[accent]}
      />
    </svg>
  );
}

function TrendIcon({ trend }: { trend: NonNullable<WorkflowKPI['trend']> }) {
  if (trend === 'up') return <ArrowUp className="h-3 w-3" aria-hidden="true" />;
  if (trend === 'down') return <ArrowDown className="h-3 w-3" aria-hidden="true" />;
  return <Minus className="h-3 w-3" aria-hidden="true" />;
}

/**
 * KPIStrip — 4 KPI tiles, 120px tall, indigo/cyan/amber/emerald accents.
 */
export interface KPIStripProps {
  readonly kpis: ReadonlyArray<WorkflowKPI>;
}

export function KPIStrip({ kpis }: KPIStripProps) {
  return (
    <div
      data-testid="workflow-kpi-strip"
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
    >
      {kpis.map((k) => (
        <div
          key={k.id}
          data-testid={`workflow-kpi-${k.id}`}
          className={cn(
            'flex h-[120px] flex-col justify-between rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4',
            'transition-colors duration-200 ease-out-soft hover:border-[var(--border-default)]',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
              {k.label}
            </span>
            <span
              aria-hidden="true"
              className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full', ACCENT_BG[k.accent])}
            >
              <TrendIcon trend={k.trend ?? 'flat'} />
            </span>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="space-y-0.5">
              <p className="font-mono text-2xl font-semibold text-[var(--fg-primary)]">{k.value}</p>
              {k.delta ? (
                <p className="text-[11px] text-[var(--fg-tertiary)]">{k.delta}</p>
              ) : null}
            </div>
            {k.sparkline ? <MiniSparkline values={k.sparkline} accent={k.accent} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}