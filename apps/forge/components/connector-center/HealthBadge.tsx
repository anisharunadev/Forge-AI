'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ConnectorHealthStatus } from '@/lib/connector-center/data';

const TONE: Record<ConnectorHealthStatus, string> = {
  healthy: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  syncing: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  stale: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  quarantined: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
};

const LABEL: Record<ConnectorHealthStatus, string> = {
  healthy: 'Healthy',
  syncing: 'Syncing',
  stale: 'Stale',
  failed: 'Failed',
  quarantined: 'Quarantined',
};

export interface HealthBadgeProps {
  status: ConnectorHealthStatus;
  className?: string;
}

export function HealthBadge({ status, className }: HealthBadgeProps) {
  return (
    <span
      data-testid="connector-health-badge"
      data-status={status}
      role="status"
      aria-label={`Health: ${LABEL[status]}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        TONE[status],
        className,
      )}
    >
      {LABEL[status]}
    </span>
  );
}
