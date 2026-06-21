'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export type FreshnessLevel = 'fresh' | 'aging' | 'stale';

export interface FreshnessBadgeProps {
  updatedAt: string;
  className?: string;
}

function ageInDays(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

function level(iso: string): FreshnessLevel {
  const d = ageInDays(iso);
  if (d <= 14) return 'fresh';
  if (d <= 45) return 'aging';
  return 'stale';
}

const TONE: Record<FreshnessLevel, string> = {
  fresh: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  aging: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  stale: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export function FreshnessBadge({ updatedAt, className }: FreshnessBadgeProps) {
  const lvl = level(updatedAt);
  const days = ageInDays(updatedAt);
  return (
    <span
      data-testid="freshness-badge"
      data-level={lvl}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-medium',
        TONE[lvl],
        className,
      )}
      aria-label={`Updated ${days} days ago, ${lvl}`}
    >
      {lvl} · {days}d
    </span>
  );
}
