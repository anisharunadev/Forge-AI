'use client';

/**
 * FORA-514 §3 — dashboard runs list that subscribes to the orchestrator
 * realtime WS. Hydrates the SSR-fetched `runs` prop, then:
 *
 *   - On `run.updated` / `run.stage_changed` WS frames: refresh the
 *     list (debounced 250 ms) so the dashboard never shows stale stage
 *     state.
 *   - On disconnect (`status !== 'open'`): the supplied `fetcher`
 *     ticks at 5 s and keeps the dashboard fresh while the socket is
 *     down. This preserves FORA-374 v1's "always within one poll of
 *     truth" guarantee.
 *
 * The component opens its OWN WS connection via `useRealtime`. The hook
 * memoizes `subscribe` so re-rendering the component does not rebuild
 * the handler set; the effect below only re-subscribes on mount/unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { RunStatusBadge } from './RunStatusBadge';
import { RunActions } from './RunActions';
import { seedAliasFor } from '@/lib/api';
import { useRealtime, type FrameHandler, type WsTopic } from '@/lib/useRealtime';
import type { RunRecord } from '@/lib/types';

export interface RealtimeRunsListProps {
  initialRuns: ReadonlyArray<RunRecord>;
  /** Fetches the latest run list — called on poll + on `run.*` WS frames. */
  fetcher: () => Promise<ReadonlyArray<RunRecord>>;
  /** Hide the operator action bar (PM and CTO personas). */
  hideActions?: boolean;
}

/**
 * Debounce window for re-renders triggered by WS frames. Frames arrive
 * individually; without debounce the dashboard would re-render on every
 * 30 ms event during a stage transition burst.
 */
const DEBOUNCE_MS = 250;

export function RealtimeRunsList({
  initialRuns,
  fetcher,
  hideActions,
}: RealtimeRunsListProps) {
  const [runs, setRuns] = useState<ReadonlyArray<RunRecord>>(initialRuns);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetcher()
        .then((next) => setRuns(next))
        .catch(() => {
          // Silent — the dashboard's empty/unreachable states cover
          // transport failures. Don't blow up the UI on a transient.
        });
    }, DEBOUNCE_MS);
  }, [fetcher]);

  // Single hook instance per component. Subscribe function is stable
  // (memoized inside the hook) so the effect below does not churn.
  const { status, subscribe } = useRealtime({
    fallbackPoll: scheduleRefresh,
    pollIntervalMs: 5_000,
  });

  useEffect(() => {
    const handler: FrameHandler = () => scheduleRefresh();
    const offs: Array<() => void> = [];
    offs.push(subscribe('run.updated' as WsTopic, handler));
    offs.push(subscribe('run.stage_changed' as WsTopic, handler));
    return () => {
      for (const off of offs) off();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [subscribe, scheduleRefresh]);

  return (
    <div data-testid="realtime-runs-list">
      <RealtimeBadge status={status} />
      {runs.length === 0 ? (
        <p className="mt-2 text-sm text-forge-200" data-testid="realtime-runs-empty">
          No runs visible. The orchestrator is reachable but returned an empty list —
          seed <code>demo-run-001</code> via <code>./scripts/dev-up.sh</code>.
        </p>
      ) : (
        <ul className="mt-4 space-y-3" data-testid="eng-runs-list">
          {runs.map((r) => {
            const alias = seedAliasFor(r.id);
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-forge-200/40 p-3"
                data-testid="eng-run-row"
              >
                <div className="space-y-1">
                  <p className="font-mono text-xs">
                    {r.id}
                    {alias ? (
                      <span className="ml-2 text-forge-300" data-testid="seed-alias">({alias})</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-forge-300">
                    goal <strong>{r.goal_id}</strong> · stage{' '}
                    <strong>{r.current_stage}</strong> · ceiling $
                    {r.cost_ceiling_usd}
                  </p>
                </div>
                <RunStatusBadge status={r.status} />
                <Link className="text-forge-300 underline" href={`/runs/${r.id}`}>
                  timeline
                </Link>
                {hideActions ? null : <RunActions runId={r.id} status={r.status} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Visual indicator of the realtime WS state — small, unobtrusive. */
function RealtimeBadge({
  status,
}: {
  status: 'connecting' | 'open' | 'reconnecting' | 'closed';
}) {
  const label =
    status === 'open'
      ? 'live'
      : status === 'reconnecting'
        ? 'reconnecting'
        : status === 'connecting'
          ? 'connecting'
          : 'polling';
  const tone =
    status === 'open'
      ? 'bg-emerald-500/20 text-emerald-300'
      : status === 'reconnecting'
        ? 'bg-amber-500/20 text-amber-300'
        : 'bg-forge-500/20 text-forge-300';
  return (
    <span
      data-testid="realtime-badge"
      data-status={status}
      className={`badge ${tone}`}
      title={
        status === 'open'
          ? 'Realtime updates active'
          : status === 'reconnecting'
            ? 'WS reconnecting — falling back to polling'
            : status === 'connecting'
              ? 'WS opening — falling back to polling until ready'
              : 'Polling fallback (no WS)'
      }
    >
      {label}
    </span>
  );
}
