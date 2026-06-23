'use client';

import * as React from 'react';
import { StatusPill } from '@/components/shell';
import type { StateGlyph, StatusTone } from '@/lib/design-system/status';

export interface ScoreBadgeProps {
  score: number;
  className?: string;
}

/**
 * ScoreBadge — colored chip for an ideation score (0..10).
 *
 * Mapping:
 *   - score >= 8 → success ✓
 *   - score >= 6 → review  ◑
 *   - score  < 6 → danger  ✕
 */
function scoreTone(score: number): { tone: StatusTone; glyph: StateGlyph } {
  if (score >= 8) return { tone: 'success', glyph: '✓' };
  if (score >= 6) return { tone: 'review',  glyph: '◑' };
  return { tone: 'danger', glyph: '✕' };
}

export function ScoreBadge({ score, className }: ScoreBadgeProps) {
  const { tone, glyph } = scoreTone(score);
  return (
    <StatusPill
      tone={tone}
      glyph={glyph}
      label={score.toFixed(1)}
      data-testid="score-badge"
      data-score={score}
      aria-label={`Score ${score.toFixed(1)}`}
      className={`font-mono ${className ?? ''}`}
    />
  );
}
