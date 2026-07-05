'use client';

/**
 * StaleApprovalBadge — M6-G5 stale-approval pill.
 *
 * Renders when the scheduler's `approval_timeout_scan` job has marked
 * this run's approval as stale and the SSE stream has surfaced the
 * `approval.stale` event (the page chrome passes the flag down).
 *
 * Visual contract:
 *   - Pill in the rose tone (matches the warning convention used by
 *     the RunStatusBadge danger variants).
 *   - Lucide `Clock` icon so it reads as a time-based warning at a
 *     glance.
 *   - Microcopy follows the "Approval expired Xh ago" template
 *     surfaced in the M6 spec §4 AC-5.
 *   - Renders nothing when `staleApproval` is null/empty (the parent
 *     doesn't pass the prop or the event has been cleared).
 *
 * Test seam: `data-testid="stale-approval-badge"` plus
 * `data-expired-hours` so the playwright/e2e assertion in
 * `tests/runs/stale-approval.test.tsx` can read the structured value.
 */

import * as React from 'react';
import { Clock } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface StaleApprovalBadgeProps {
  /**
   * The flag the page sets from the SSE `approval.stale` envelope.
   * `null` / `undefined` / empty string → renders nothing.
   * String value → renders the badge with the timestamp shown.
   */
  staleApproval: string | null | undefined;
  /** Optional className passthrough. */
  className?: string;
}

/**
 * Render the elapsed-since window in hours. The badge contract is
 * "Approval expired Xh ago" — we coerce any ISO date to a positive
 * hour count. Anything invalid clamps to "just now" so the badge
 * still renders (callers shouldn't be passing garbage but we don't
 * want a runtime error to crash the drawer).
 */
function hoursSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  const diff = Date.now() - t;
  if (diff <= 0) return 0;
  return Math.max(0, Math.floor(diff / 3_600_000));
}

function formatExpiredHours(hours: number): string {
  if (hours <= 0) return 'just now';
  if (hours === 1) return '1h ago';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1d ago' : `${days}d ago`;
}

export function StaleApprovalBadge({ staleApproval, className }: StaleApprovalBadgeProps) {
  if (!staleApproval) return null;
  const hours = hoursSince(staleApproval);
  const label = formatExpiredHours(hours);
  return (
    <span
      role="status"
      data-testid="stale-approval-badge"
      data-expired-hours={hours}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-rose)]/30 bg-[var(--accent-rose)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent-rose)]',
        className,
      )}
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      <span data-testid="stale-approval-microcopy">
        Approval expired {label}
      </span>
    </span>
  );
}

export default StaleApprovalBadge;