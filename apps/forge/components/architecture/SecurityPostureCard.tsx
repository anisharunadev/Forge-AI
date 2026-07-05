'use client';

/**
 * SecurityPostureCard — KPI strip for the Security Report tab (M5-G4).
 *
 * Renders the deployment posture aggregate returned by
 * `GET /architecture/security-reports/posture`:
 *
 *   - Total open findings (the headline number).
 *   - Critical open (rose) and High open (amber) breakdown.
 *   - Risk-weighted score (0–100; higher = healthier) with a small
 *     arc gauge that uses the design-system tokens.
 *   - Trend delta (current score vs previous period).
 *
 * Skill influence:
 *   - `chart` — color encoding paired with numeric badge so color is
 *     not the only signal.
 *   - `style` (Data-Dense Dashboard) — minimal padding, label +
 *     value + secondary metric.
 *   - `08-empty-ux.md` — if posture is null we render an explanatory
 *     "Awaiting scan" placeholder instead of a zeroed KPI (Rule 15).
 */

import * as React from 'react';
import { ShieldAlert, ShieldCheck, AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { SecurityPosture } from '@/lib/architecture/types';

export interface SecurityPostureCardProps {
  posture: SecurityPosture | null;
  loading?: boolean;
  className?: string;
}

const SEVERITY_TONE = {
  critical: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  high: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  medium: 'text-yellow-200 border-yellow-500/40 bg-yellow-500/10',
  low: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
} as const;

function scoreTone(score: number): { ring: string; fill: string; label: string } {
  if (score >= 80) {
    return {
      ring: 'stroke-emerald-400',
      fill: 'fill-emerald-400',
      label: 'Healthy',
    };
  }
  if (score >= 60) {
    return { ring: 'stroke-amber-400', fill: 'fill-amber-400', label: 'Watch' };
  }
  if (score >= 40) {
    return {
      ring: 'stroke-orange-400',
      fill: 'fill-orange-400',
      label: 'Degraded',
    };
  }
  return { ring: 'stroke-rose-400', fill: 'fill-rose-400', label: 'Critical' };
}

function ScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const tone = scoreTone(clamped);
  // Half-circle gauge: 180° arc, radius 36.
  // Start at (-r, 0), end at (+r, 0); arc length encodes score.
  const arcLen = Math.PI * 36; // half circumference
  const filled = (clamped / 100) * arcLen;

  return (
    <div
      className="flex flex-col items-center gap-1"
      data-testid="security-posture-score"
      data-score={clamped}
      data-tone={tone.label.toLowerCase()}
    >
      <svg viewBox="-50 -42 100 50" width={120} height={60} aria-label={`Posture score ${clamped}`}>
        <path
          d="M -36 0 A 36 36 0 0 1 36 0"
          fill="none"
          className="stroke-[var(--border-subtle)]"
          strokeWidth={6}
          strokeLinecap="round"
        />
        <path
          d="M -36 0 A 36 36 0 0 1 36 0"
          fill="none"
          className={tone.ring}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${arcLen}`}
        />
        <text
          x={0}
          y={-4}
          textAnchor="middle"
          className={cn('fill-[var(--fg-primary)]', 'font-semibold')}
          fontSize={16}
        >
          {clamped}
        </text>
        <text x={0} y={10} textAnchor="middle" className="fill-[var(--fg-tertiary)]" fontSize={8}>
          {tone.label}
        </text>
      </svg>
    </div>
  );
}

export function SecurityPostureCard({
  posture,
  loading = false,
  className,
}: SecurityPostureCardProps) {
  if (loading) {
    return (
      <div
        className={cn(
          'rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4',
          className,
        )}
        data-testid="security-posture-card"
        data-state="loading"
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-inset)]"
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!posture) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-center',
          className,
        )}
        data-testid="security-posture-card"
        data-state="empty"
      >
        <ShieldCheck className="h-8 w-8 text-[var(--fg-tertiary)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Awaiting scan</h3>
        <p className="max-w-md text-xs text-[var(--fg-tertiary)]">
          No deployment posture has been computed yet. Once a scan completes, the total open,
          critical/high open counts and the score gauge will populate here.
        </p>
      </div>
    );
  }

  const trendDelta =
    posture.trend.length >= 2
      ? posture.trend[posture.trend.length - 1]!.score -
        posture.trend[posture.trend.length - 2]!.score
      : 0;

  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4',
        className,
      )}
      data-testid="security-posture-card"
      data-state="ready"
      data-total-open={posture.total_open}
      data-critical-open={posture.critical_open}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Total open */}
        <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
            Open findings
          </span>
          <span
            className="text-2xl font-semibold text-[var(--fg-primary)]"
            data-testid="security-posture-total-open"
          >
            {posture.total_open}
          </span>
          <span className="text-[10px] text-[var(--fg-tertiary)]">
            across {posture.top_affected_services.length} services
          </span>
        </div>

        {/* Critical open */}
        <div
          className={cn(
            'flex flex-col gap-1 rounded-[var(--radius-md)] border p-3',
            SEVERITY_TONE.critical,
          )}
          data-testid="security-posture-critical-card"
        >
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide">
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            Critical open
          </span>
          <span
            className="text-2xl font-semibold"
            data-testid="security-posture-critical-open"
          >
            {posture.critical_open}
          </span>
          <span className="text-[10px] opacity-80">requires immediate triage</span>
        </div>

        {/* High open */}
        <div
          className={cn(
            'flex flex-col gap-1 rounded-[var(--radius-md)] border p-3',
            SEVERITY_TONE.high,
          )}
          data-testid="security-posture-high-card"
        >
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            High open
          </span>
          <span
            className="text-2xl font-semibold"
            data-testid="security-posture-high-open"
          >
            {posture.high_open}
          </span>
          <span className="text-[10px] opacity-80">plan within 7 days</span>
        </div>

        {/* Score gauge */}
        <div className="flex flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
            Posture score
          </span>
          <ScoreGauge score={posture.score} />
          <span
            className={cn(
              'font-mono text-[10px]',
              trendDelta >= 0 ? 'text-emerald-300' : 'text-rose-300',
            )}
            data-testid="security-posture-trend-delta"
          >
            {trendDelta >= 0 ? '▲' : '▼'} {Math.abs(trendDelta)} vs last scan
          </span>
        </div>
      </div>
    </div>
  );
}