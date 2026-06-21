'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import type { RefactorEffort } from '@/lib/api';

const EFFORT_TONE: Record<RefactorEffort, string> = {
  S: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  M: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  L: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  XL: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

const EFFORT_LABEL: Record<RefactorEffort, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra Large',
};

export interface EffortEstimateProps {
  effort: RefactorEffort;
  estimateHours?: number;
  className?: string;
}

/**
 * Visual badge for a phase's effort estimate. Drives the color tone
 * via the `RefactorEffort` bucket and renders the hours in a
 * monospace suffix so the row reads at a glance.
 */
export function EffortEstimate({ effort, estimateHours, className }: EffortEstimateProps) {
  return (
    <span
      data-testid="effort-estimate"
      data-effort={effort}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide',
        EFFORT_TONE[effort],
        className,
      )}
      aria-label={`Effort ${EFFORT_LABEL[effort]}${estimateHours ? `, ${estimateHours} hours` : ''}`}
    >
      <span>{effort}</span>
      {typeof estimateHours === 'number' ? (
        <span className="text-forge-200">· {estimateHours}h</span>
      ) : null}
    </span>
  );
}