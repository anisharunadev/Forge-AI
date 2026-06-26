'use client';

import { Check, Clock, Inbox } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/src/components/empty-state';
import type { Approval } from '@/lib/ideation/data';

export interface ApprovalQueuePanelProps {
  approvals: ReadonlyArray<Approval>;
  onDecide?: (approval: Approval, decision: 'approve' | 'reject') => void;
}

export function ApprovalQueuePanel({
  approvals,
  onDecide,
}: ApprovalQueuePanelProps) {
  const pending = approvals.filter((a) => a.status === 'pending');
  const recent = approvals.filter((a) => a.status !== 'pending').slice(0, 3);

  if (pending.length === 0 && recent.length === 0) {
    return (
      <div data-testid="approval-queue-panel">
        <EmptyState
          illustration={<Inbox size={40} strokeWidth={1.5} />}
          title="Inbox zero"
          description="You're all caught up. New approvals will appear here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="approval-queue-panel">
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-200">
          Pending ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="text-sm text-forge-400">Nothing waiting on you.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((a) => (
              <li
                key={a.id}
                data-testid="approval-item"
                data-approval-id={a.id}
                className="flex flex-col gap-2 rounded-md border border-forge-700/40 bg-forge-900/40 p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{a.title}</p>
                    <p className="font-mono text-[10px] text-forge-300">
                      {a.kind} · {a.refId} · by {a.requestedBy}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    pending
                  </span>
                </div>
                <p className="text-[11px] text-forge-300">
                  requested {new Date(a.requestedAt).toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => onDecide?.(a, 'approve')}
                    data-testid="approval-approve"
                  >
                    <Check className="h-3 w-3" aria-hidden="true" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDecide?.(a, 'reject')}
                    data-testid="approval-reject"
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-200">
            Recent decisions
          </h3>
          <ul className="flex flex-col gap-2">
            {recent.map((a) => (
              <li
                key={a.id}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border p-2 text-xs',
                  a.status === 'approved'
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-rose-500/40 bg-rose-500/10',
                )}
              >
                <span>{a.title}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide">
                  {a.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
