'use client';

/**
 * Jira sync indicator (Step 44, Fix 2).
 *
 * Top-of-page badge: "✓ Synced · Last sync 2m ago" or
 * "⟳ Syncing 3 of 14 stories". Per-story sync status is rendered by
 * the parent (StoryCard adds a tiny Jira icon).
 *
 * Talks to lib/jira-sync/engine.ts — pure TS, no SDK imports.
 */

import * as React from 'react';
import { Check, RefreshCcw, AlertTriangle, X, Plug } from 'lucide-react';
import { toast } from 'sonner';

import { formatRelativeSync, type SyncStatus } from '@/lib/jira-sync/engine';
import { cn } from '@/lib/utils';

export interface SyncIndicatorProps {
  readonly lastSyncedAt?: string;
  readonly inflightCount: number;
  readonly failedCount: number;
  readonly onSyncAll?: () => void | Promise<void>;
}

export function SyncIndicator({
  lastSyncedAt,
  inflightCount,
  failedCount,
  onSyncAll,
}: SyncIndicatorProps) {
  const [syncing, setSyncing] = React.useState(false);
  const tone: SyncStatus =
    failedCount > 0 ? 'failed' : inflightCount > 0 ? 'syncing' : 'synced';

  const handleSync = async () => {
    if (!onSyncAll) return;
    setSyncing(true);
    try {
      await onSyncAll();
      toast.success('Stories synced', { description: 'Forge ↔ Jira reconciled.' });
    } finally {
      setSyncing(false);
    }
  };

  const Icon = tone === 'synced' ? Check : tone === 'syncing' ? RefreshCcw : tone === 'failed' ? AlertTriangle : X;

  return (
    <div
      data-testid="sync-indicator"
      className={cn(
        'inline-flex items-center gap-2 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px]',
        tone === 'synced' && 'border-[var(--accent-emerald)]/30 bg-[rgba(34,197,94,0.08)] text-[var(--accent-emerald)]',
        tone === 'syncing' && 'border-[var(--accent-primary)]/30 bg-[rgba(99,102,241,0.08)] text-[var(--accent-primary)]',
        tone === 'failed' && 'border-[var(--accent-rose)]/30 bg-[rgba(244,63,94,0.08)] text-[var(--accent-rose)]',
      )}
    >
      <Icon
        size={10}
        aria-hidden="true"
        className={tone === 'syncing' ? 'animate-spin' : undefined}
      />
      <span>
        {tone === 'synced' && `Synced · Last sync ${formatRelativeSync(lastSyncedAt)}`}
        {tone === 'syncing' && `Syncing ${inflightCount}…`}
        {tone === 'failed' && `${failedCount} sync failure${failedCount === 1 ? '' : 's'}`}
      </span>
      <span aria-hidden="true" className="text-[var(--fg-tertiary)]">·</span>
      <Plug size={10} aria-hidden="true" />
      <span>Jira</span>
      {onSyncAll ? (
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          data-testid="sync-all"
          className={cn(
            'ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
            'hover:bg-[rgba(255,255,255,0.06)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            syncing && 'cursor-not-allowed opacity-50',
          )}
        >
          Sync all
        </button>
      ) : null}
    </div>
  );
}

/** Per-story badge — tiny Jira icon + sync status. */
export function StorySyncBadge({
  status,
}: {
  readonly status: SyncStatus;
}) {
  if (status === 'idle') return null;
  const tone =
    status === 'synced'
      ? 'text-[var(--accent-emerald)]'
      : status === 'syncing'
        ? 'text-[var(--accent-primary)] animate-spin'
        : status === 'failed'
          ? 'text-[var(--accent-rose)]'
          : 'text-[var(--accent-amber)]';
  const Icon =
    status === 'synced'
      ? Check
      : status === 'syncing'
        ? RefreshCcw
        : status === 'failed'
          ? X
          : AlertTriangle;
  return (
    <span
      aria-label={`Jira sync: ${status}`}
      data-testid="story-sync-badge"
      data-sync-status={status}
      className={cn('inline-flex items-center', tone)}
    >
      <Icon size={9} aria-hidden="true" />
    </span>
  );
}
