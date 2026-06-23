'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toneClasses, runStateTone, type StatusTone } from '@/lib/design-system/status';
import type { RunState } from '@/lib/design-system/forge-color-tokens';

/**
 * Approval Timeline (Phase 0.5-06).
 *
 * Surfaces pending approval decisions in newest-first order with
 * one-click Approve / Reject buttons. Tone derives from the
 * underlying `runStateTone` so a rejected item is unambiguously
 * distinguishable from a pending one.
 *
 * Distinct from `components/ideation/ApprovalQueuePanel.tsx` (which
 * is sidebar-sized and shows only the first 3 recent). This component
 * is the full page-section timeline.
 */
export type ApprovalDecision = 'approve' | 'reject';

export interface ApprovalTimelineItem {
  readonly id: string;
  readonly title: string;
  readonly phase: string;
  readonly runState: RunState;
  readonly requestedBy: string;
  readonly requestedAt: string;
}

export interface ApprovalTimelineProps {
  readonly approvals: ReadonlyArray<ApprovalTimelineItem>;
  readonly onDecide?: (item: ApprovalTimelineItem, decision: ApprovalDecision) => void;
  readonly emptyMessage?: string;
}

const STATE_GLYPH: Record<RunState, string> = {
  created: '○',
  running: '●',
  waiting_approval: '◑',
  paused: '●',
  approved: '✓',
  rejected: '✕',
  aborted: '✕',
  finished: '✓',
  done: '✓',
};

function phaseToneForPhase(phase: string): StatusTone {
  if (phase === 'Architecture') return 'info';
  if (phase === 'Security') return 'review';
  if (phase === 'Deployment') return 'execution';
  return 'idle';
}

export function ApprovalTimeline({
  approvals,
  onDecide,
  emptyMessage,
}: ApprovalTimelineProps) {
  const pending = approvals.filter((a) => a.runState === 'waiting_approval');
  const recent = approvals.filter((a) => a.runState !== 'waiting_approval');

  if (approvals.length === 0) {
    return (
      <div
        data-testid="approval-timeline-empty"
        className="rounded-md border bg-card p-4 text-13 text-muted-foreground"
      >
        {emptyMessage ?? 'No pending approvals.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="approval-timeline">
      <section aria-label="Pending decisions">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pending ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="text-13 text-muted-foreground">
            Nothing waiting on you.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="approval-timeline-pending">
            {pending.map((a) => {
              const phaseTone = toneClasses[phaseToneForPhase(a.phase)];
              const runTone = toneClasses[runStateTone[a.runState] ?? 'idle'];
              return (
                <li
                  key={a.id}
                  data-testid="approval-timeline-item"
                  data-approval-id={a.id}
                  data-phase={a.phase}
                  className={cn(
                    'flex flex-col gap-2 rounded-md border bg-card p-3',
                    'ring-1',
                    phaseTone.ring,
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-2xs uppercase tracking-wider text-muted-foreground">
                        {a.phase}
                      </p>
                      <p className="font-semibold text-foreground">{a.title}</p>
                      <p className="font-mono text-2xs text-muted-foreground">
                        by {a.requestedBy} ·{' '}
                        {new Date(a.requestedAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider',
                        runTone.bg,
                        runTone.fg,
                      )}
                    >
                      <span aria-hidden="true">{STATE_GLYPH[a.runState]}</span>
                      {a.runState.replace('_', ' ')}
                    </span>
                  </div>
                  {onDecide ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => onDecide(a, 'approve')}
                        data-testid="approval-timeline-approve"
                        data-approval-id={a.id}
                      >
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onDecide(a, 'reject')}
                        data-testid="approval-timeline-reject"
                        data-approval-id={a.id}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {recent.length > 0 ? (
        <section aria-label="Recent decisions">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent ({recent.length})
          </h3>
          <ul
            className="flex flex-col gap-2"
            data-testid="approval-timeline-recent"
          >
            {recent.map((a) => {
              const runTone = toneClasses[runStateTone[a.runState] ?? 'idle'];
              return (
                <li
                  key={a.id}
                  data-approval-id={a.id}
                  data-run-state={a.runState}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-md border bg-card p-2 text-13',
                    'ring-1',
                    runTone.ring,
                  )}
                >
                  <span className="truncate">{a.title}</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wider',
                      runTone.bg,
                      runTone.fg,
                    )}
                  >
                    <span aria-hidden="true">{STATE_GLYPH[a.runState]}</span>
                    {a.runState.replace('_', ' ')}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
