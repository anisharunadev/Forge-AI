'use client';

import * as React from 'react';
import { Check, Circle, Clock, AlertTriangle, Loader2, Pause } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { RefactorPhase, RefactorPhaseStatus } from '@/lib/api';
import { EffortEstimate } from './EffortEstimate';

const STATUS_ICON: Record<RefactorPhaseStatus, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  pending: Circle,
  analyzing: Loader2,
  awaiting_approval: Pause,
  in_progress: Clock,
  complete: Check,
  blocked: AlertTriangle,
};

const STATUS_LABEL: Record<RefactorPhaseStatus, string> = {
  pending: 'Pending',
  analyzing: 'Analyzing',
  awaiting_approval: 'Awaiting approval',
  in_progress: 'In progress',
  complete: 'Complete',
  blocked: 'Blocked',
};

const STATUS_TONE: Record<RefactorPhaseStatus, string> = {
  pending: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  analyzing: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
  awaiting_approval: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  in_progress: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  complete: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  blocked: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export interface PhaseTimelineProps {
  phases: ReadonlyArray<RefactorPhase>;
  className?: string;
}

/**
 * Vertical timeline of the migration plan's phases. Each row exposes
 * the status icon + label, an `EffortEstimate` badge, the phase
 * summary, and a compact list of task titles.
 */
export function PhaseTimeline({ phases, className }: PhaseTimelineProps) {
  if (phases.length === 0) {
    return (
      <div className="card text-sm text-forge-300" data-testid="phase-timeline-empty">
        No phases yet. Trigger a refactor analysis to generate one.
      </div>
    );
  }

  return (
    <ol
      aria-label="Migration phases"
      data-testid="phase-timeline"
      data-phase-count={phases.length}
      className={cn('relative ml-3 border-l border-forge-700/40', className)}
    >
      {phases.map((phase) => {
        const Icon = STATUS_ICON[phase.status];
        const isAnalyzing = phase.status === 'analyzing';
        return (
          <li
            key={phase.id}
            data-testid="phase-timeline-item"
            data-phase-id={phase.id}
            data-phase-status={phase.status}
            className="mb-6 ml-6"
          >
            <span
              className={cn(
                'absolute -left-2 flex h-5 w-5 items-center justify-center rounded-full border border-forge-700 bg-forge-800 text-forge-200',
                phase.status === 'complete' && 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300',
                phase.status === 'blocked' && 'border-rose-500/50 bg-rose-500/20 text-rose-300',
              )}
              aria-hidden="true"
            >
              <Icon className={cn('h-3 w-3', isAnalyzing && 'animate-spin')} />
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-forge-400">
                Phase {phase.index}
              </span>
              <h3 className="text-base font-semibold text-forge-50">{phase.title}</h3>
              <EffortEstimate effort={phase.effort} estimateHours={phase.estimateHours} />
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  STATUS_TONE[phase.status],
                )}
              >
                {STATUS_LABEL[phase.status]}
              </span>
            </div>

            <p className="mt-1 text-sm text-forge-200">{phase.summary}</p>

            {phase.tasks.length > 0 ? (
              <ul
                className="mt-2 list-inside list-disc text-xs text-forge-300"
                data-testid="phase-tasks"
                aria-label={`Tasks for phase ${phase.index}`}
              >
                {phase.tasks.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}