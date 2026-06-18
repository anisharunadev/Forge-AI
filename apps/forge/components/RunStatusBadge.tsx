import type { RunStatus } from '@/lib/types';

const RUN_BADGE: Record<RunStatus, string> = {
  created: 'bg-run-created/20 text-run-created',
  running: 'bg-run-running/20 text-run-running',
  waiting_approval: 'bg-run-waiting_approval/20 text-run-waiting_approval',
  paused: 'bg-run-paused/20 text-run-paused',
  aborted: 'bg-run-aborted/20 text-run-aborted',
  finished: 'bg-run-finished/20 text-run-finished',
  done: 'bg-run-done/20 text-run-done',
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={`badge ${RUN_BADGE[status] ?? 'bg-run-created/20 text-run-created'}`}
      data-testid="run-status-badge"
      data-status={status}
    >
      {status.replace('_', ' ')}
    </span>
  );
}