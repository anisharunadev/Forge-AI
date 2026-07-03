'use client';

/**
 * WebSocket subscriber for live pipeline updates.
 *
 * Connects to the backend WS endpoint at
 * `/ws/ideation/{session_id}` (verified at
 * `backend/app/api/ws/ideation/workflow.py`). The backend pushes
 * frames of the shape:
 *
 *   { type: 'ready', session_id }
 *   { type: 'state', session_id, status }
 *   { type: 'step_started', session_id, step_id }
 *   { type: 'step_completed', session_id, step_id, artifact? }
 *   { type: 'step_failed', session_id, step_id, error }
 *   { type: 'session_completed', session_id }
 *   { type: 'session_terminated', session_id, reason }
 *   { type: 'pong' }
 *
 * On `step_*` and `session_completed` frames we invalidate the
 * relevant TanStack queries so the UI refetches. `intervene` frames
 * (the reverse direction) are out of scope for this hook.
 *
 * Authentication: sourced via `api.ws(path)` from `lib/api/client.ts`,
 * which appends `?token=<jwt>` from the auth accessor — same contract
 * the backend expects, no first-frame dance.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/ideation';

export interface PipelineWSMessage {
  type: string;
  session_id?: string;
  step_id?: string;
  status?: string;
  artifact?: unknown;
  error?: string;
  reason?: string;
}

interface PipelineWSOptions {
  /** Called for every parsed frame. Useful for tail/debug overlays. */
  onMessage?: (msg: PipelineWSMessage) => void;
  /** Called when the socket errors. */
  onError?: (event: Event) => void;
  /** Called when the socket closes (cleanly or not). */
  onClose?: () => void;
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
    };

    ws.onerror = (event) => {
      optsRef.current.onError?.(event);
    };

    ws.onclose = () => {
      optsRef.current.onClose?.();
    };

    return () => {
      ws.close();
    };
    // We intentionally key on sessionId only; option callbacks are
    // ref-stabilized so consumers can pass inline handlers without
    // tearing down the socket on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, qc]);
}