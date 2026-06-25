'use client';

/**
 * `<IngestIndicator>` — a small Badge near the Ideation page header
 * (Forge AI-440 / Pillar 1 Phase 3).
 *
 * The indicator surfaces the status of the most recent daily ideation
 * ingest run so operators can see at a glance whether the scheduler
 * is producing new ideas and how many.
 *
 * Copy:
 *   - `status === 'success'` →
 *       "Last daily ingest: {N} new ideas"
 *     where N is `ideas_created_today`.
 *   - `status === 'running'` →
 *       "Daily ingest: running…"
 *   - `status === 'failed'` →
 *       "Daily ingest: failed"
 *   - `status === 'partial'` →
 *       "Daily ingest: partial — {N} ideas (budget fallback)"
 *   - `status === 'never'` →
 *       "Daily ingest: never run"
 *
 * Color (Badge variant):
 *   - success / partial → `secondary` (the desired steady state).
 *   - running           → `secondary` with a subtle animate-pulse.
 *   - failed            → `destructive`.
 *   - never             → `outline` (neutral — not yet an error).
 */

import { Badge } from '@/components/ui/badge';
import type { IdeationIngestStatus } from '@/lib/persona/data';

export interface IngestIndicatorProps {
  readonly status: IdeationIngestStatus;
  readonly ideas_created_today?: number;
  readonly last_run_at?: string | null;
}

/**
 * Map a server status → Badge variant. Kept as a small pure helper
 * so a future "ping" indicator on the Dashboard can re-use it.
 */
function variantForStatus(
  status: IdeationIngestStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'success':
    case 'partial':
    case 'running':
      return 'secondary';
    case 'failed':
      return 'destructive';
    case 'never':
    default:
      return 'outline';
  }
}

/**
 * Map a server status + idea count → the human-readable label
 * surfaced on the badge.
 */
function labelForStatus(
  status: IdeationIngestStatus,
  ideasCreated: number,
): string {
  switch (status) {
    case 'success':
      return `Last daily ingest: ${ideasCreated} new ideas`;
    case 'partial':
      return `Daily ingest: partial — ${ideasCreated} ideas (budget fallback)`;
    case 'running':
      return 'Daily ingest: running…';
    case 'failed':
      return 'Daily ingest: failed';
    case 'never':
    default:
      return 'Daily ingest: never run';
  }
}

export function IngestIndicator({
  status,
  ideas_created_today = 0,
  last_run_at = null,
}: IngestIndicatorProps) {
  const variant = variantForStatus(status);
  const label = labelForStatus(status, ideas_created_today);

  return (
    <Badge
      variant={variant}
      data-testid="ideation-ingest-indicator"
      data-ingest-status={status}
      data-ideas-created-today={ideas_created_today}
      data-last-run-at={last_run_at ?? ''}
      title={
        last_run_at
          ? `Last run: ${new Date(last_run_at).toLocaleString()}`
          : 'No ingest runs recorded yet'
      }
    >
      {label}
    </Badge>
  );
}