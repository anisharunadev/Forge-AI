/**
 * StageChip — the per-stage visual unit rendered inside the
 * `WorkflowProgressBar`.
 *
 * Three visual states:
 *   - `done`     — emerald checkmark, click navigates to the stage
 *   - `current`  — amber ring + filled dot, click navigates to the stage
 *   - `pending`  — muted dot, click navigates to the stage
 *   - `blocked`  — rose warning icon, click reveals blocked reason
 *
 * The chip is intentionally a pure server-friendly component: no
 * hooks, no context, so it can be rendered inside the static
 * progress bar on the home page and inside any future server
 * component without a client boundary.
 */

import * as React from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import { getStage } from '@/lib/workflow-shell/stages';
import type { StageStatus, WorkflowStageId } from '@/lib/workflow-shell/types';

export interface StageChipProps {
  readonly id: WorkflowStageId;
  readonly status: StageStatus;
  readonly blockedReason?: string;
  /** Optional override; defaults to the stage label. */
  readonly label?: string;
  readonly className?: string;
}

const STATUS_RING: Readonly<Record<StageStatus, string>> = {
  done: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  current: 'border-amber-400/60 bg-amber-400/10 text-amber-200 ring-2 ring-amber-400/30',
  pending: 'border-border bg-card/40 text-muted-foreground',
  blocked: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

const STATUS_DOT: Readonly<Record<StageStatus, string>> = {
  done: 'bg-emerald-400',
  current: 'bg-amber-400',
  pending: 'bg-muted-foreground/40',
  blocked: 'bg-rose-400',
};

function StatusGlyph({ status }: { status: StageStatus }) {
  if (status === 'done') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 8.5l3 3 7-7" />
      </svg>
    );
  }
  if (status === 'blocked') {
    return (
      <span aria-hidden="true" className="text-[10px] font-bold">
        !
      </span>
    );
  }
  return null;
}

export function StageChip({
  id,
  status,
  blockedReason,
  label,
  className,
}: StageChipProps) {
  const stage = getStage(id);
  const display = label ?? stage.shortLabel;
  const title = blockedReason ?? stage.description;

  return (
    <Link
      href={stage.centerPath}
      data-testid={`workflow-stage-chip-${id}`}
      data-stage-status={status}
      title={title}
      aria-label={`${stage.label} — ${status}`}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        'hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        STATUS_RING[status],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('inline-block h-2 w-2 rounded-full', STATUS_DOT[status])}
      />
      <StatusGlyph status={status} />
      <span>{display}</span>
    </Link>
  );
}