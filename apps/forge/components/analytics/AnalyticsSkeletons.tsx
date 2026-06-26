'use client';

/**
 * AnalyticsSkeletons — chart-specific shimmer placeholders.
 *
 * Per the design system spec: "Chart-specific skeletons (lines,
 * bars, gauge) — shimmer placeholders, no spinners." Each
 * skeleton mimics the rough shape of its target chart so the
 * page doesn't reflow when data arrives.
 *
 * Skill influence:
 *   - `style` (Data-Dense Dashboard) — skeletons should mirror
 *     the layout they replace to prevent layout shift.
 *   - `prefers-reduced-motion` — the global reduced-motion
 *     media query in `globals.css` cancels `.shimmer` so these
 *     become inert grey blocks (no animation, no spinner).
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

function ChartCard({
  height = 240,
  title,
  className,
  children,
}: {
  height?: number;
  title?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4',
        className,
      )}
      data-testid="analytics-skeleton"
      role="status"
      aria-live="polite"
      aria-label={title ? `${title} loading` : 'Loading analytics'}
    >
      <div className="flex items-center justify-between">
        <span className="shimmer h-3 w-32" aria-hidden="true" />
        <span className="shimmer h-3 w-12" aria-hidden="true" />
      </div>
      <div style={{ height }} className="relative w-full">
        {children}
      </div>
    </div>
  );
}

/** Area / line chart skeleton — wavy baseline, rising hill. */
export function AreaChartSkeleton({ height, title, className }: { height?: number; title?: string; className?: string }) {
  return (
    <ChartCard height={height ?? 240} title={title} className={className}>
      <svg
        viewBox="0 0 400 200"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <path
          d="M0,160 C60,120 120,140 200,90 C280,40 320,80 400,60 L400,200 L0,200 Z"
          fill="rgba(99,102,241,0.10)"
        />
        <path
          d="M0,160 C60,120 120,140 200,90 C280,40 320,80 400,60"
          fill="none"
          stroke="rgba(99,102,241,0.30)"
          strokeWidth="1.5"
        />
      </svg>
      <div className="absolute inset-0 shimmer opacity-40" aria-hidden="true" />
    </ChartCard>
  );
}

/** Stacked / vertical bar skeleton — 6 bars rising across the canvas. */
export function BarChartSkeleton({ height, title, className }: { height?: number; title?: string; className?: string }) {
  return (
    <ChartCard height={height ?? 240} title={title} className={className}>
      <div className="flex h-full items-end justify-around gap-2 px-2">
        {[55, 70, 45, 80, 60, 90, 50, 75].map((h, i) => (
          <div
            key={i}
            className="shimmer w-full rounded-t-[var(--radius-sm)]"
            style={{ height: `${h}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
    </ChartCard>
  );
}

/** Radial gauge skeleton — half-ring placeholder with center pulse. */
export function GaugeSkeleton({ title, className }: { title?: string; className?: string }) {
  return (
    <ChartCard height={200} title={title} className={className}>
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div
          className="shimmer h-24 w-40 rounded-t-full"
          aria-hidden="true"
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        />
        <span className="shimmer h-3 w-24" aria-hidden="true" />
      </div>
    </ChartCard>
  );
}

/** Pie / donut skeleton. */
export function PieChartSkeleton({ height, title, className }: { height?: number; title?: string; className?: string }) {
  return (
    <ChartCard height={height ?? 220} title={title} className={className}>
      <div className="flex h-full items-center justify-center">
        <div className="shimmer h-32 w-32 rounded-full" aria-hidden="true" />
      </div>
    </ChartCard>
  );
}

/** Horizontal-bar skeleton. */
export function HorizontalBarSkeleton({ title, className }: { title?: string; className?: string }) {
  return (
    <ChartCard height={220} title={title} className={className}>
      <div className="flex h-full flex-col justify-around gap-2 px-1">
        {[95, 80, 65, 50, 35].map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="shimmer h-3 w-20 shrink-0" aria-hidden="true" />
            <span className="shimmer h-3 rounded" style={{ width: `${w}%` }} aria-hidden="true" />
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

/** Leaderboard rows skeleton. */
export function LeaderboardSkeleton({ title, className }: { title?: string; className?: string }) {
  return (
    <ChartCard height={200} title={title} className={className}>
      <div className="flex h-full flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="shimmer h-6 w-6 rounded-full" aria-hidden="true" />
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="shimmer h-3 w-1/3" aria-hidden="true" />
              <span className="shimmer h-1.5 w-full rounded-full" aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

/** KPI tile skeleton — 160px card matching AnalyticsKpiCard. */
export function KpiTileSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-testid="kpi-tile-skeleton"
      role="status"
      aria-label="Loading KPI"
      className={cn(
        'flex h-[160px] flex-col justify-between rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="shimmer h-3 w-20" aria-hidden="true" />
        <span className="shimmer h-6 w-6 rounded-[var(--radius-md)]" aria-hidden="true" />
      </div>
      <span className="shimmer h-7 w-24" aria-hidden="true" />
      <span className="shimmer h-10 w-full rounded-[var(--radius-md)]" aria-hidden="true" />
    </div>
  );
}