'use client';

/**
 * ApprovalsInbox — inbox-style approval list (Step 5 My Approvals tab).
 *
 * Each row = idea title + submitter + submitted-at + Approve / Reject / Open.
 * Empty state from Step 3.
 */

import * as React from 'react';
import { Check, X, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/src/components/empty-state';
import { cn } from '@/lib/utils';
import { Inbox } from 'lucide-react';
import type { Approval } from '@/lib/ideation/data';

const STATUS_DOT: Record<Approval['status'], string> = {
  pending: 'bg-[var(--accent-amber)]',
  approved: 'bg-[var(--accent-emerald)]',
  rejected: 'bg-[var(--accent-rose)]',
};

export interface ApprovalsInboxProps {
  approvals: ReadonlyArray<Approval>;
  onDecide?: (a: Approval, decision: 'approve' | 'reject') => void;
  onOpen?: (a: Approval) => void;
}

export function ApprovalsInbox({ approvals, onDecide, onOpen }: ApprovalsInboxProps) {
  if (approvals.length === 0) {
    return (
      <div className="card" data-testid="approvals-empty">
        <EmptyState
          illustration={<Inbox size={40} strokeWidth={1.5} />}
          title="Inbox zero"
          description="No approvals waiting on you. We'll surface new requests here."
        />
      </div>
    );
  }

  return (
    <ul role="list" className="flex flex-col gap-2" data-testid="approvals-inbox">
      {approvals.map((a) => {
        const isPending = a.status === 'pending';
        return (
          <li
            key={a.id}
            data-testid={`approval-row-${a.id}`}
            data-approval-status={a.status}
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-colors duration-150 ease-out-soft hover:border-[var(--border-default)]"
          >
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[a.status])}
            />
            <span className="sr-only">{a.status}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--fg-primary)]">
                {a.title}
              </p>
              <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                {a.requestedBy} · {new Date(a.requestedAt).toLocaleString(undefined, {
                  month: 'short',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                <span className="ml-2 inline-block rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 uppercase tracking-wider text-[var(--fg-secondary)]">
                  {a.kind}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1">
              {isPending ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDecide?.(a, 'approve')}
                    data-testid={`approval-approve-${a.id}`}
                    className="border-[var(--accent-emerald)]/40 text-[var(--accent-emerald)] hover:bg-[rgba(16,185,129,0.08)]"
                  >
                    <Check className="mr-1 h-3 w-3" aria-hidden="true" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDecide?.(a, 'reject')}
                    data-testid={`approval-reject-${a.id}`}
                    className="border-[var(--accent-rose)]/40 text-[var(--accent-rose)] hover:bg-[rgba(244,63,94,0.08)]"
                  >
                    <X className="mr-1 h-3 w-3" aria-hidden="true" />
                    Reject
                  </Button>
                </>
              ) : (
                <span
                  className={cn(
                    'rounded-[var(--radius-sm)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider',
                    a.status === 'approved'
                      ? 'bg-[rgba(16,185,129,0.12)] text-[var(--accent-emerald)]'
                      : 'bg-[rgba(244,63,94,0.12)] text-[var(--accent-rose)]',
                  )}
                >
                  {a.status}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpen?.(a)}
                data-testid={`approval-open-${a.id}`}
                className="text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
                aria-label={`Open ${a.title}`}
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
