'use client';

/**
 * Stories Center — KPI Strip (Step 21).
 *
 * Five tiles, 120px tall, gap-4, mb-8. Each tile pulls from the same
 * Story pool so the numbers stay consistent across views.
 *
 * Tile accent channels:
 *   * Total in sprint — indigo (--accent-primary)
 *   * Backlog — muted (--fg-muted)
 *   * In progress — cyan (--accent-cyan)
 *   * In review — amber (--accent-amber)
 *   * Done this sprint — emerald (--accent-emerald) + velocity bar
 *
 * Skill influence:
 *   - Charts: small SVG sparklines, no chart library bloat
 *   - Accessibility: descriptive aria-labels for screen readers
 */

import * as React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

import type { Story } from '@/lib/stories/types';
import { cn } from '@/lib/utils';

export interface KPIStripProps {
  readonly stories: ReadonlyArray<Story>;
}

export function KPIStrip({ stories }: KPIStripProps) {
  const inSprint = stories.filter((s) => s.sprintId === 'sp-25-13');
  const backlog = stories.filter((s) => s.status === 'backlog');
  const inProgress = stories.filter((s) => s.status === 'in_progress');
  const inReview = stories.filter((s) => s.status === 'in_review');
  const done = inSprint.filter((s) => s.status === 'done');

  // Sprint goal: 18 story points (rough heuristic — sum of done points * 8)
  const pointsDone = done.reduce(
    (acc, s) => acc + ({ XS: 1, S: 2, M: 3, L: 5, XL: 8 }[s.estimate] ?? 0),
    0,
  );
  const goalPoints = 18;
  const velocityPct = Math.min(100, Math.round((pointsDone / goalPoints) * 100));

  // Synthetic sparkline (5 data points) for "Total in sprint" — would
  // be server-driven in production; here we derive a stable series.
  const sparkSeries = [3, 5, 6, 8, 11];

  return (
    <section
      aria-label="Stories key metrics"
      data-testid="stories-kpis"
      className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5"
    >
      <Tile
        tone="indigo"
        label="Total in sprint"
        value={inSprint.length}
        delta={{ kind: 'up', text: '+3 this week' }}
        spark={sparkSeries}
      />
      <Tile
        tone="muted"
        label="Backlog"
        value={backlog.length}
        subline={`across ${backlog.length === 0 ? 0 : 1} project${backlog.length === 1 ? '' : 's'}`}
      />
      <Tile
        tone="cyan"
        label="In progress"
        value={inProgress.length}
        delta={{ kind: 'up', text: '+1 today' }}
      />
      <Tile
        tone="amber"
        label="In review / QA"
        value={inReview.length}
        delta={{ kind: 'down', text: '-1 since yesterday' }}
      />
      <Tile
        tone="emerald"
        label="Done this sprint"
        value={done.length}
        delta={{ kind: 'up', text: `${pointsDone} pts · ${velocityPct}% of goal` }}
        velocity={velocityPct}
      />
    </section>
  );
}

interface TileProps {
  tone: 'indigo' | 'muted' | 'cyan' | 'amber' | 'emerald';
  label: string;
  value: number;
  delta?: { kind: 'up' | 'down'; text: string };
  subline?: string;
  spark?: ReadonlyArray<number>;
  velocity?: number;
}

function Tile({ tone, label, value, delta, subline, spark, velocity }: TileProps) {
  const accent = TONE_VAR[tone];

  return (
    <article
      data-testid={`kpi-${tone}`}
      className={cn(
        'relative flex h-[120px] flex-col justify-between overflow-hidden rounded-[var(--radius-lg)]',
        'border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4',
      )}
    >
      {/* Accent corner bar — depth cue, not a status pill */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 h-1 w-12 rounded-br-[var(--radius-md)]"
        style={{ backgroundColor: accent }}
      />

      <header className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
          {label}
        </p>
        {delta ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-medium',
              delta.kind === 'up'
                ? 'text-[var(--accent-emerald)]'
                : 'text-[var(--accent-rose)]',
            )}
          >
            {delta.kind === 'up' ? (
              <TrendingUp size={10} aria-hidden="true" />
            ) : (
              <TrendingDown size={10} aria-hidden="true" />
            )}
            <span>{delta.text}</span>
          </span>
        ) : null}
      </header>

      <div className="flex items-end justify-between gap-2">
        <p
          className="text-3xl font-bold leading-none text-[var(--fg-primary)]"
          aria-label={`${value} ${label.toLowerCase()}`}
        >
          {value}
        </p>
        {subline ? (
          <p className="text-[10px] text-[var(--fg-tertiary)]">{subline}</p>
        ) : null}
        {spark ? <Sparkline series={spark} stroke={accent} /> : null}
      </div>

      {typeof velocity === 'number' ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={velocity}
          aria-label={`Velocity ${velocity}%`}
          className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]"
        >
          <span
            aria-hidden="true"
            className="block h-full rounded-full transition-[width] duration-slow ease-out-soft"
            style={{ width: `${velocity}%`, backgroundColor: accent }}
          />
        </div>
      ) : null}
    </article>
  );
}

function Sparkline({
  series,
  stroke,
}: {
  series: ReadonlyArray<number>;
  stroke: string;
}) {
  const w = 64;
  const h = 22;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = Math.max(1, max - min);
  const step = w / Math.max(1, series.length - 1);
  const points = series
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="trend"
      className="shrink-0"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

const TONE_VAR: Record<TileProps['tone'], string> = {
  indigo: 'var(--accent-primary)',
  muted: 'var(--fg-muted)',
  cyan: 'var(--accent-cyan)',
  amber: 'var(--accent-amber)',
  emerald: 'var(--accent-emerald)',
};