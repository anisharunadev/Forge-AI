'use client';

/**
 * ConnectorHealthIndicator — tiny live status dot for cross-cutting use.
 *
 * Used in:
 *   - Run detail (next to "Called: GitHub.listIssues")
 *   - Idea cards (next to "Source: Zendesk")
 *   - Workflow node inspector
 *   - Anywhere a connector is referenced
 *
 * Design: dot + optional label, with a tooltip showing full status on
 * hover/focus. Animates emerald pulse when healthy, rose when failed,
 * static otherwise. All motion gated by `prefers-reduced-motion`.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { resolveIcon, STATUS_LABEL, type ConnectorHealthStatus } from '@/lib/connectors';

export interface ConnectorHealthIndicatorProps {
  readonly connectorId: string;
  readonly status: ConnectorHealthStatus;
  readonly displayName?: string;
  readonly showLabel?: boolean;
  readonly size?: 'xs' | 'sm' | 'md';
  readonly className?: string;
}

const DOT_CLASS: Record<ConnectorHealthStatus, string> = {
  healthy: 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]',
  syncing: 'bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)] animate-pulse',
  stale: 'bg-[var(--accent-amber)]',
  failed: 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)]',
  quarantined: 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)] animate-pulse',
  paused: 'bg-[var(--fg-tertiary)]',
};

const SIZE_DOT: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
};

const SIZE_TEXT: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'text-[10px]',
  sm: 'text-xs',
  md: 'text-sm',
};

export function ConnectorHealthIndicator({
  connectorId,
  status,
  displayName,
  showLabel = false,
  size = 'sm',
  className,
}: ConnectorHealthIndicatorProps) {
  const Icon = resolveIcon(connectorId);
  const label = STATUS_LABEL[status];
  const name = displayName ?? connectorId;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 align-middle',
        className,
      )}
      data-testid="connector-health-indicator"
      data-connector-id={connectorId}
      data-status={status}
      title={`${name} — ${label}`}
      aria-label={`${name} connector status: ${label}`}
    >
      <span
        className={cn('inline-block rounded-full', DOT_CLASS[status], SIZE_DOT[size])}
        aria-hidden="true"
      />
      {showLabel ? (
        <span className={cn('text-fg-secondary', SIZE_TEXT[size])}>{label}</span>
      ) : null}
      <Icon className={cn('text-fg-tertiary', size === 'xs' ? 'h-3 w-3' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} aria-hidden="true" />
    </span>
  );
}