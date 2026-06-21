'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ADRStatus } from '@/lib/architecture/data';

const STATUS_TONE: Record<ADRStatus, string> = {
  proposed: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  draft: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  published: 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200',
  superseded: 'border-rose-500/40 bg-rose-500/10 text-rose-300 line-through',
};

export interface ApprovalStatusBadgeProps {
  status: ADRStatus;
  className?: string;
}

export function ApprovalStatusBadge({
  status,
  className,
}: ApprovalStatusBadgeProps) {
  return (
    <span
      data-testid="approval-status-badge"
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        STATUS_TONE[status],
        className,
      )}
    >
      {status}
    </span>
  );
}
