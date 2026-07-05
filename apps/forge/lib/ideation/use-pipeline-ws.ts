'use client';

/**
 * WebSocket subscriber for live ideation pipeline updates.
 *
 * Connects to the backend WS endpoint at
 * `/ws/ideation/{session_id}` (verified at
 * `backend/app/api/ws/ideation/workflow.py`). The backend pushes
 * frames of the shape:
 *
 *   ── Pipeline / orchestrator frames ─────────────────────────────
 *   { type: 'ready',                 session_id }
 *   { type: 'state',                 session_id, status }
 *   { type: 'step_started',          session_id, step_id }
 *   { type: 'step_completed',        session_id, step_id, artifact? }
 *   { type: 'step_failed',           session_id, step_id, error }
 *   { type: 'session_completed',     session_id }
 *   { type: 'session_terminated',    session_id, reason }
 *   { type: 'pong' }
 *
 *   ── M4 source / signal frames (M4-G10, M4-G21) ────────────────────
 *   { type: 'source.sync.started',   source_id, project_id? }
 *   { type: 'source.sync.completed', source_id, pulled,
 *     duration_ms, project_id? }
 *   { type: 'source.sync.failed',    source_id, error, project_id? }
 *   { type: 'market_signal.synthesized', signal_id, kind }
 *
 * On `step_*` and `session_completed` frames we invalidate the
 * relevant TanStack queries so the UI refetches. On
 * `source.sync.completed` we invalidate the **sources** + **market
 * signals** query slices so the Sources / MarketSignals tabs pick
 * up the new rows within 2s of the pull finishing — without
 * flooding React Query with re-renders.
 *
 * The invalidation funnel is debounced (2s window, hand-rolled — no
 * new deps added) so a burst of completed frames collapses to a
 * single refetch pass. `intervene` frames (the reverse direction)
 * are out of scope for this hook.
 *
 * Authentication: sourced via `api.ws(path)` from `lib/api/client.ts`,
 * which appends `?token=<jwt>` from the auth accessor — same contract
 * the backend expects, no first-frame dance.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/ideation';
import { ideationQueryKeys } from '@/lib/hooks/useIdeation';

// ---------------------------------------------------------------------------
// Hand-rolled debounce — keeps deps stable (no lodash.add) and is
// trivial to inline. The trailing-edge variant only fires the inner
// function once per quiet window, which is what we want for invalidation.
// ---------------------------------------------------------------------------

function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): ((...args: A) => void) & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const debounced = (...args: A) => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = lastArgs;
      lastArgs = null;
      if (a) fn(...a);
    }, waitMs);
  };

  return Object.assign(debounced, {
    flush: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        const a = lastArgs;
        lastArgs = null;
        if (a) fn(...a);
      }
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      lastArgs = null;
    },
  });
}

export interface PipelineWSMessage {
  type: string;
  session_id?: string;
  step_id?: string;
  status?: string;
  artifact?: unknown;
  error?: string;
  reason?: string;
  /** M4 source-sync / synthesis fields. */
  source_id?: string;
  pulled?: number;
  duration_ms?: number;
  signal_id?: string;
  kind?: string;
  project_id?: string;
}

interface PipelineWSOptions {
  /** Called for every parsed frame. Useful for tail/debug overlays. */
  onMessage?: (msg: PipelineWSMessage) => void;
  /** Called when the socket errors. */
  onError?: (event: Event) => void;
  /** Called when the socket closes (cleanly or not). */
  onClose?: () => void;
}

/**
 * Coalesced query invalidator used by the WS hook. The
 * `pullerFanOut` debouncer issues a *single* refetch pass per 2 s
 * quiet window even when the backend emits 10+ `source.sync.*` frames
 * during a multi-source kickoff.
 */
function createSourceSyncFanOut(qc: ReturnType<typeof useQueryClient>) {
  return debounce(() => {
    // M4-G21 — on `source.sync.completed`, refresh both the Sources
    // tab row AND the MarketSignals feed (the synthesizer appends
    // new market_signals rows after a successful Confluence / RSS /
    // TechCrunch pull).
    void qc.invalidateQueries({ queryKey: ideationQueryKeys.sources.all });
    void qc.invalidateQueries({ queryKey: ideationQueryKeys.marketSignals.all });
  }, 2_000);
}

export function usePipelineWS(
  sessionId: string | null | undefined,
  options: PipelineWSOptions = {},
): void {
  const qc = useQueryClient();
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!sessionId) return;
    if (typeof window === 'undefined') return;

    // Coalesced invalidation channel for source-sync events.
    // Hoisted to the effect scope so it's torn down with the socket.
    const sourceSyncFanOut = createSourceSyncFanOut(qc);

    // ponytail: api.ws injects host + ?token=<jwt>; same contract the
    // backend accepts (workflow.py:50). SSR-safe via the typeof guard.
    const ws = api.ws(`/ws/ideation/${encodeURIComponent(sessionId)}`);

    ws.onmessage = (event) => {
      let parsed: PipelineWSMessage;
      try {
        parsed = JSON.parse(String(event.data)) as PipelineWSMessage;
      } catch {
        return;
      }

      optsRef.current.onMessage?.(parsed);

      // ── Pipeline / orchestrator events ────────────────────────────
      //
      // Any step transition or session completion should refetch the
      // session state. `session_completed` also kicks the ideas list
      // so any artifact generated downstream is visible.
      if (
        parsed.type === 'step_started' ||
        parsed.type === 'step_completed' ||
        parsed.type === 'step_failed' ||
        parsed.type === 'state'
      ) {
        void qc.invalidateQueries({
          queryKey: queryKeys.ideation.pipelineStatus(sessionId),
        });
      }

      if (parsed.type === 'session_completed') {
        void qc.invalidateQueries({
          queryKey: queryKeys.ideation.pipelineStatus(sessionId),
        });
        void qc.invalidateQueries({ queryKey: queryKeys.ideation.ideas() });
      }

      // ── M4 source/synth frames (M4-G10, M4-G21) ──────────────────
      //
      // Three "ended" frames all warrant a fan-out:
      //   - source.sync.completed: puller returned, signals saved
      //   - source.sync.failed:    puller failed, surface to UI toast
      //                            AND refresh so the failed status is
      //                            visible (no stale "connected" pill)
      //   - market_signal.synthesized: a NEW market_signal was
      //                                inserted by the synthesizer
      //
      // The fan-out is debounced 2s so a burst of 10+ frames during
      // a multi-source backfill collapses to a single refetch pass.
      if (
        parsed.type === 'source.sync.completed' ||
        parsed.type === 'source.sync.failed' ||
        parsed.type === 'market_signal.synthesized'
      ) {
        sourceSyncFanOut();
      }
    };

    ws.onerror = (event) => {
      optsRef.current.onError?.(event);
    };

    ws.onclose = () => {
      // Flush any pending invalidation before we drop the connection
      // so a final `source.sync.completed` frame that arrives just
      // before close isn't lost in the debounce window.
      sourceSyncFanOut.flush();
      optsRef.current.onClose?.();
    };

    return () => {
      // Flush on unmount too — a refresh triggered after a fast
      // unmount/remount cycle still surfaces the latest rows.
      sourceSyncFanOut.flush();
      ws.close();
    };
    // We intentionally key on sessionId only; option callbacks are
    // ref-stabilized so consumers can pass inline handlers without
    // tearing down the socket on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, qc]);
}