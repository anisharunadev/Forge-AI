'use client';

import * as React from 'react';

import { StatusPill } from '@/components/shell';
import type { StateGlyph, StatusTone } from '@/lib/design-system/status';

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

const TONE: Record<FreshnessLevel, StatusTone> = {
  fresh: 'success',
  aging: 'warn',
  stale: 'danger',
};

const GLYPH: Record<FreshnessLevel, StateGlyph> = {
  fresh: '✓',
  aging: '◑',
  stale: '✕',
};

export function FreshnessBadge({ updatedAt, className }: FreshnessBadgeProps) {
  const lvl = level(updatedAt);
  const days = ageInDays(updatedAt);
  return (
    <StatusPill
      tone={TONE[lvl]}
      glyph={GLYPH[lvl]}
      label={`${lvl} · ${days}d`}
      size="sm"
      data-testid="freshness-badge"
      data-level={lvl}
      aria-label={`Updated ${days} days ago, ${lvl}`}
      className={`font-mono ${className ?? ''}`}
    />
  );
}
