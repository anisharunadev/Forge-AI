'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ScoreBadgeProps {
  score: number;
  className?: string;
}

function scoreTone(score: number): string {
  if (score >= 8) {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  }
  if (score >= 6) {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  }
  return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
}

export function ScoreBadge({ score, className }: ScoreBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold',
        scoreTone(score),
        className,
      )}
      data-testid="score-badge"
      data-score={score}
      aria-label={`Score ${score.toFixed(1)}`}
    >
      {score.toFixed(1)}
    </span>
  );
}
