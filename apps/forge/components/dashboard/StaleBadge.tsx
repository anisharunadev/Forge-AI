'use client';

/**
 * StaleBadge — small inline pill that signals "this data is from
 * {age} ago". Used by every tile whose data depends on the live
 * orchestrator stream (Fix 2 + Fix 3).
 *
 * Color shifts based on age:
 *   <1m  → muted tertiary (still probably fine)
 *   1-5m → amber (worth a glance)
 *   >5m  → rose (orchestrator is gone)
 *
 * Skill influence:
 *   - `ux` (Color Only) — every tone pairs an icon + label so the
 *     badge never relies on color alone.
 *   - `ux` (Reduced Motion) — the pulse animation honors
 *     prefers-reduced-motion (CSS does the work).
 *
 * Step 42 Fix 5D — legibility polish:
 *   - Bumped default size from 10px → 12px (compact stays 10px).
 *   - Background opacity 0.10 → 0.15 for amber tone.
 *   - Added lucide ClockAlert as the default icon (Clock remains for
 *     compact mode where vertical space is precious).
 */

import * as React from 'react';
import { Clock, ClockAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

interface StaleBadgeProps {
  /** Age in seconds. */
  ageSec: number;
  /** Compact mode (no icon, used in cramped tile corners). */
  compact?: boolean;
  className?: string;
}

function formatAge(ageSec: number): string {
  if (ageSec < 60) return `${Math.max(1, Math.round(ageSec))}s`;
  const minutes = Math.round(ageSec / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function ageTone(ageSec: number): { fg: string; bg: string; border: string; pulse: boolean } {
  if (ageSec < 60) {
    return { fg: 'text-[var(--fg-tertiary)]', bg: 'bg-[var(--bg-elevated)]', border: 'border-[var(--border-subtle)]', pulse: false };
  }
  if (ageSec < 300) {
    return { fg: 'text-[var(--accent-amber)]', bg: 'bg-[var(--accent-amber)]/15', border: 'border-[var(--accent-amber)]/30', pulse: false };
  }
  return { fg: 'text-[var(--accent-rose)]', bg: 'bg-[var(--accent-rose)]/15', border: 'border-[var(--accent-rose)]/30', pulse: true };
}

export function StaleBadge({ ageSec, compact, className }: StaleBadgeProps) {
  const tone = ageTone(ageSec);
  const age = formatAge(ageSec);
  const label = `stale · ${age} ago`;
  const Icon = compact ? Clock : ClockAlert;
  return (
    <span
      role="status"
      aria-label={label}
      data-testid="stale-badge"
      data-age-bucket={ageSec < 60 ? 'fresh' : ageSec < 300 ? 'warn' : 'stale'}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono',
        tone.fg,
        tone.bg,
        tone.border,
        compact ? 'text-[10px]' : 'text-[12px]',
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3', tone.pulse ? 'stale-pulse' : '')}
      />
      <span className="font-medium uppercase tracking-wide">stale</span>
      <span aria-hidden="true">·</span>
      <span>{age} ago</span>
    </span>
  );
}

/**
 * Subtle 1 px amber border tint applied to tiles showing stale data.
 * Implement as a CSS class so consumers can attach it without
 * recalculating border colors per accent.
 */
export function staleBorderClass(stale: boolean, ageSec = 0): string {
  if (!stale) return '';
  const tint = ageSec < 60 ? 'rgba(245,158,11,0.08)' : ageSec < 300 ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.2)';
  return cn('stale-border');
}

/**
 * Helper that maps a snapshot's `online` flag + `generatedAt` into a
 * stable age (seconds) we can pass to <StaleBadge>.
 */
export function snapshotAgeSec(generatedAt: string, online: boolean, fallbackSec = 120): number {
  if (online) return 0;
  const ts = Date.parse(generatedAt);
  if (Number.isNaN(ts)) return fallbackSec;
  return Math.max(5, Math.floor((Date.now() - ts) / 1000));
}