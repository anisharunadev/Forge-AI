'use client';

/**
 * ReplayButton — M6-G1 operator control.
 *
 * Wraps the `useReplayRun` mutation so a single click:
 *   1. POSTs `/api/v1/runs/{runId}/replay` (Track A endpoint).
 *   2. toasts.success + navigates to `/runs/{newRunId}` on success.
 *   3. toasts.error with the orchestrator message on failure.
 *
 * Disabled while the run is in a LIVE state (`running` / `pending`)
 * because replaying a live run would either race the in-flight
 * orchestrator or duplicate work. Use `Cancel` (RunActions) first if
 * the operator really wants to abandon the live run.
 *
 * The microcopy follows the convention used by the other action
 * buttons in `RunActions.tsx`: imperative verb + ellipsis to signal
 * an async action that opens a new context.
 */

import * as React from 'react';
import { RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useReplayRun } from '@/lib/hooks/useRuns';
import type { RunStatus } from '@/lib/types';

export interface ReplayButtonProps {
  /** Source run to replay. The mutation POSTs to `/runs/{runId}/replay`. */
  runId: string;
  /**
   * Current status of the source run. The button is disabled while the
   * run is `running` or `pending` (live) — replaying a live run would
   * race the orchestrator.
   */
  status: RunStatus;
  /** Optional label override for the resting state. */
  label?: string;
  /** Visual variant — defaults to `outline` to slot in alongside Cancel. */
  variant?: 'outline' | 'default' | 'secondary' | 'ghost' | 'destructive' | 'link';
  /** Optional extra Tailwind classes for layout (e.g. `ml-auto`). */
  className?: string;
}

const LIVE_STATUSES = new Set<RunStatus>(['running', 'pending']);

export function ReplayButton({
  runId,
  status,
  label = 'Replay',
  variant = 'outline',
  className,
}: ReplayButtonProps) {
  const replay = useReplayRun();
  const live = LIVE_STATUSES.has(status);
  const disabled = live || replay.isPending;

  const handleClick = React.useCallback(() => {
    if (disabled) return;
    replay.mutate(runId);
  }, [disabled, replay, runId]);

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-busy={replay.isPending ? 'true' : 'false'}
      data-testid="replay-run-button"
      data-live={live ? 'true' : 'false'}
      className={className}
    >
      <RotateCw
        className={replay.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
        aria-hidden="true"
      />
      {replay.isPending ? 'Replaying…' : label}
    </Button>
  );
}

export default ReplayButton;