'use client';

/**
 * AuditIntegrityBanner — M7-G1 (Track B)
 *
 * Reads the live integrity probe via `useAuditIntegrity()` and renders
 * one of three states:
 *
 *   - **OK**       — emerald tone.  "Integrity OK (head {hash[:12]}…,
 *                    {length} events)". The shortened hash gives
 *                    operators a quick visual anchor without forcing
 *                    them to inspect the full 64-char digest.
 *   - **Broken**   — rose tone.     "⚠ Chain broken at event
 *                    {broken_at_event_id}". The id is the first
 *                    hash-chain row that failed verification, so the
 *                    operator knows exactly which row to investigate.
 *   - **Loading**  — skeleton spinner while the probe is in flight.
 *   - **Error**    — "Cannot verify integrity — endpoint unavailable"
 *                    (rose tone, with a retry affordance that calls
 *                    `refetch()` from TanStack).
 *
 * The banner carries `data-testid="audit-integrity-banner"` so the
 * existing audit page chrome (and the new test in
 * `apps/forge/tests/audit/AuditIntegrity.test.tsx`) can target it
 * without DOM-text coupling.
 */

import * as React from 'react';
import { AlertTriangle, Loader2, RotateCw, ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useAuditIntegrity, type AuditIntegrity } from '@/lib/hooks/useAudit';

export interface AuditIntegrityBannerProps {
  /**
   * Optional override of the rendered query. Used by the test suite
   * to inject fixture data without spinning up a real
   * QueryClientProvider — production callers should leave it
   * undefined so the banner wires itself.
   *
   * @internal — exposed for the test seam in
   * `apps/forge/tests/audit/AuditIntegrity.test.tsx`.
   */
  readonly queryOverride?: ReturnType<typeof useAuditIntegrity>;
}

/**
 * Resolve the query result, falling back to the real hook when no
 * test override is provided. Keeping this as a separate function
 * keeps the test mock simple (it can pass a vi.fn() that returns
 * `{ data, isLoading, isError, refetch }` directly).
 */
function useResolvedQuery(
  override: ReturnType<typeof useAuditIntegrity> | undefined,
): ReturnType<typeof useAuditIntegrity> {
  const live = useAuditIntegrity();
  return override ?? live;
}

/**
 * Format the head hash for the OK-state copy. Backend may return an
 * empty string when the tenant has no events yet; we render an
 * em-dash instead of an empty slice.
 */
function formatHead(headHash: string | undefined): string {
  if (!headHash) return '—';
  return `${headHash.slice(0, 12)}…`;
}

export function AuditIntegrityBanner({
  queryOverride,
}: AuditIntegrityBannerProps = {}) {
  const query = useResolvedQuery(queryOverride);
  const { data, isLoading, isError, error, refetch, isFetching } = query;

  // ── Loading ─────────────────────────────────────────────────────
  // The very first probe is in flight; show the skeleton spinner so
  // the operator doesn't see a flash of "broken" before the first
  // successful poll lands.
  if (isLoading && !data) {
    return (
      <section
        data-testid="audit-integrity-banner"
        data-state="loading"
        aria-busy="true"
        aria-label="Integrity banner"
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-lg)] border',
          'border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-4',
        )}
      >
        <Loader2
          className="h-4 w-4 animate-spin text-[var(--fg-tertiary)]"
          aria-hidden="true"
        />
        <Skeleton
          className="h-4 w-48"
          data-testid="audit-integrity-banner-skeleton"
        />
        <Skeleton className="h-4 w-24" />
        <span className="sr-only">Loading audit integrity status…</span>
      </section>
    );
  }

  // ── Error ───────────────────────────────────────────────────────
  // The endpoint is down (network error, 5xx, etc.). We surface a
  // rose-tinted banner with a Retry button so the operator isn't
  // stranded on a stale state.
  if (isError) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return (
      <section
        data-testid="audit-integrity-banner"
        data-state="error"
        role="alert"
        aria-label="Integrity banner"
        className={cn(
          'flex flex-col gap-3 rounded-[var(--radius-lg)] border',
          'border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/5 px-5 py-4',
          'md:flex-row md:items-center md:justify-between',
        )}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle
            className="h-4 w-4 text-[var(--accent-rose)]"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-[var(--fg-primary)]">
            Cannot verify integrity — endpoint unavailable
          </span>
          <span className="text-xs text-[var(--fg-tertiary)]">
            ({message})
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void refetch()}
          disabled={isFetching}
          data-testid="audit-integrity-banner-retry"
        >
          <RotateCw
            className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')}
            aria-hidden="true"
          />
          {isFetching ? 'Retrying…' : 'Retry'}
        </Button>
      </section>
    );
  }

  // ── Success ─────────────────────────────────────────────────────
  // The probe returned a payload — branch on `integrity_ok` to choose
  // the tone and the copy.
  const integrity = data as AuditIntegrity | undefined;
  if (!integrity) {
    // Shouldn't happen outside of an HMR race; render the loading
    // skeleton so we never flash a blank banner.
    return (
      <section
        data-testid="audit-integrity-banner"
        data-state="loading"
        aria-busy="true"
        aria-label="Integrity banner"
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-lg)] border',
          'border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-4',
        )}
      >
        <Loader2
          className="h-4 w-4 animate-spin text-[var(--fg-tertiary)]"
          aria-hidden="true"
        />
        <Skeleton className="h-4 w-48" />
      </section>
    );
  }

  if (integrity.integrity_ok) {
    return (
      <section
        data-testid="audit-integrity-banner"
        data-state="ok"
        aria-label="Integrity banner"
        className={cn(
          'flex flex-col gap-2 rounded-[var(--radius-lg)] border',
          'border-[var(--accent-emerald)]/30 bg-[var(--accent-emerald)]/5 px-5 py-3',
          'md:flex-row md:items-center md:justify-between',
        )}
      >
        <div className="flex items-center gap-3">
          <ShieldCheck
            className="h-4 w-4 text-[var(--accent-emerald)]"
            aria-hidden="true"
          />
          <span
            className="text-sm font-semibold text-[var(--fg-primary)]"
            data-testid="audit-integrity-banner-message"
          >
            Integrity OK (head {formatHead(integrity.head_hash)},{' '}
            {integrity.length.toLocaleString()} events)
          </span>
        </div>
        <span className="text-xs text-[var(--fg-tertiary)]">
          last anchored{' '}
          {integrity.last_event_at
            ? new Date(integrity.last_event_at).toLocaleString()
            : '—'}
        </span>
      </section>
    );
  }

  // integrity_ok === false
  return (
    <section
      data-testid="audit-integrity-banner"
      data-state="broken"
      role="alert"
      aria-label="Integrity banner"
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-lg)] border',
        'border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/5 px-5 py-3',
        'md:flex-row md:items-center md:justify-between',
      )}
    >
      <div className="flex items-center gap-3">
        <AlertTriangle
          className="h-4 w-4 text-[var(--accent-rose)]"
          aria-hidden="true"
        />
        <span
          className="text-sm font-semibold text-[var(--fg-primary)]"
          data-testid="audit-integrity-banner-message"
        >
          ⚠ Chain broken at event{' '}
          {integrity.broken_at_event_id ?? '(unknown)'}
        </span>
      </div>
      <span className="text-xs text-[var(--fg-tertiary)]">
        head recomputed {formatHead(integrity.head_hash)}
      </span>
    </section>
  );
}