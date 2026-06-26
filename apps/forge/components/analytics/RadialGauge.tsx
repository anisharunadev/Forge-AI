'use client';

/**
 * RadialGauge — 270° gauge for "Knowledge reuse" / SLO percentages.
 *
 * Skill influence:
 *   - `chart` (Multi-Variable Comparison) — single-value gauges are
 *     intentionally avoided for primary metrics; we use the gauge
 *     for a derived SLO score where the visual difference between
 *     30%, 60%, 90% matters at a glance.
 *   - `ux` (Color Only) — three thresholds (low/improving/healthy)
 *     carry both a color AND a textual pill so the tone is conveyed
 *     even without color perception.
 *   - `prefers-reduced-motion` — animation is opt-in via
 *     `isAnimationActive` (default false).
 */

import * as React from 'react';
import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from 'recharts';

import { cn } from '@/lib/utils';

export type GaugeTone = 'healthy' | 'improving' | 'low';

const TONE_TEXT: Record<GaugeTone, string> = {
  healthy: 'text-[var(--accent-emerald)]',
  improving: 'text-[var(--accent-amber)]',
  low: 'text-[var(--accent-rose)]',
};

const TONE_BG: Record<GaugeTone, string> = {
  healthy: 'border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/10',
  improving: 'border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/10',
  low: 'border-[var(--accent-rose)]/30 bg-[var(--accent-rose)]/10',
};

const TONE_LABEL: Record<GaugeTone, string> = {
  healthy: 'Healthy',
  improving: 'Improving',
  low: 'Low',
};

const TONE_RING: Record<GaugeTone, string> = {
  healthy: 'var(--accent-emerald)',
  improving: 'var(--accent-amber)',
  low: 'var(--accent-rose)',
};

function classify(value: number): GaugeTone {
  if (value >= 60) return 'healthy';
  if (value >= 30) return 'improving';
  return 'low';
}

export interface RadialGaugeProps {
  /** 0–100 */
  value: number;
  /** Label rendered below the value. */
  label?: string;
  /** Optional delta in percentage points (vs prior period). */
  deltaPts?: number;
  /** Sub-text under the gauge (e.g. "Reuse rate" / "vs last 30d"). */
  subtitle?: string;
  height?: number;
  isAnimationActive?: boolean;
  className?: string;
}

export function RadialGauge({
  value,
  label = 'Knowledge reuse',
  deltaPts,
  subtitle = 'vs prior period',
  height = 200,
  isAnimationActive = false,
  className,
}: RadialGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const tone = classify(clamped);
  const data = React.useMemo(
    () => [{ name: label, value: clamped, fill: TONE_RING[tone] }],
    [clamped, tone, label],
  );

  return (
    <div
      data-testid="radial-gauge"
      data-value={clamped}
      data-tone={tone}
      className={cn('flex flex-col items-center gap-3', className)}
      role="img"
      aria-label={`${label}: ${clamped}%`}
    >
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={data}
            startAngle={225}
            endAngle={-45}
            innerRadius="68%"
            outerRadius="100%"
            barSize={14}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              background={{ fill: 'var(--bg-inset)' }}
              dataKey="value"
              cornerRadius={10}
              isAnimationActive={isAnimationActive}
            />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>

      <div className="-mt-10 flex flex-col items-center gap-0.5">
        <span
          className={cn(
            'text-[28px] font-bold leading-none tabular-nums',
            TONE_TEXT[tone],
          )}
        >
          {clamped}%
        </span>
        <span className="text-[11px] font-medium text-[var(--fg-secondary)]">{label}</span>
        {typeof deltaPts === 'number' ? (
          <span
            className={cn(
              'mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
              deltaPts > 0
                ? 'border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]'
                : deltaPts < 0
                  ? 'border-[var(--accent-rose)]/30 bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
            )}
          >
            {deltaPts > 0 ? '▲' : deltaPts < 0 ? '▼' : '–'} {Math.abs(deltaPts).toFixed(1)} pts · {subtitle}
          </span>
        ) : null}
      </div>

      <span
        className={cn(
          'mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
          TONE_BG[tone],
          TONE_TEXT[tone],
        )}
      >
        {TONE_LABEL[tone]}
      </span>
    </div>
  );
}