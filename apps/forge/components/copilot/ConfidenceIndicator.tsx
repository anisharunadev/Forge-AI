'use client';

/**
 * F-800 — Confidence indicator.
 *
 * Three-tier badge (high / medium / low) shown next to assistant
 * messages so the user can quickly see when Co-pilot is unsure.
 * Tone follows the same convention as `CommandHistoryDrawer`'s
 * status tones.
 */

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CopilotConfidence } from '@/lib/api/copilot';

const TONE: Record<CopilotConfidence, string> = {
  high: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  low: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const LABEL: Record<CopilotConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export interface ConfidenceIndicatorProps {
  confidence: CopilotConfidence;
  className?: string;
}

/**
 * Small badge reflecting Co-pilot's reported confidence. Renders
 * `null` if the confidence value is missing (e.g. tool messages).
 */
export function ConfidenceIndicator({
  confidence,
  className,
}: ConfidenceIndicatorProps) {
  return (
    <Badge
      variant="outline"
      data-testid="copilot-confidence"
      data-confidence={confidence}
      className={cn(
        'px-1.5 py-0 text-[10px] uppercase tracking-wide',
        TONE[confidence],
        className,
      )}
    >
      {LABEL[confidence]}
    </Badge>
  );
}