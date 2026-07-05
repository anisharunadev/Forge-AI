'use client';

/**
 * WebSocket subscriber for live Architecture Center updates (M5-G4).
 *
 * Connects to the backend WS endpoint at
 * `/ws/architecture/{project_id}` and invalidates the relevant
 * TanStack Query slices when the bus emits architecture-domain
 * events. Today this surfaces Security Report lifecycle events
 * (created / status changed / posture recomputed); future frames
 * may fan out to ADRs / contracts / risk registers.
 *
 * Frame contract (mirrors backend `app/api/ws/architecture.py`):
 *
 *   { type: 'architecture.security_report.created',   report_id, project_id }
 *   { type: 'architecture.security_report.updated',   report_id, project_id }
 *   { type: 'architecture.security_report.status',    report_id, status, project_id }
 *   { type: 'architecture.posture.recomputed',        project_id, score }
 *   { type: 'architecture.adr.created',               adr_id,    project_id }
 *   { type: 'architecture.contract.published',        contract_id, project_id }
 *
 * Each event triggers a debounced (2s) invalidation of the matching
 * query slice so the UI refetches once per quiet window even if the
 * backend emits a burst of frames during a backfill.
 *
 * Authentication is via `api.ws(path)` from `lib/api/client.ts` —
 * the JWT is appended as `?token=`; same contract the backend
 * accepts. SSR-safe via the `typeof window` guard.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { archQueryKeys } from '@/lib/hooks/useArchitecture';

// ---------------------------------------------------------------------------
// Hand-rolled debounce — same shape as `lib/ideation/use-pipeline-ws.ts`.
// Trailing-edge only; `flush()` runs pending callbacks on socket close /
// unmount so a final frame isn't lost.
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

// ---------------------------------------------------------------------------
// Message shape — the union we care about for invalidation. Unknown
// frame types are ignored.
// ---------------------------------------------------------------------------

export interface ArchitectureWSMessage {
  type: string;
  /** Artifact / report id, when applicable. */
  report_id?: string;
  adr_id?: string;
  contract_id?: string;
  /** Project scoping — every list hook filters by project_id. */
  project_id?: string;
  /** Lifecycle state. */
  status?: string;
  /** Posture recompute telemetry. */
  score?: number;
}

export interface ArchitecturePipelineWSOptions {
  onMessage?: (msg: ArchitectureWSMessage) => void;
  onError?: (event: Event) => void;
  onClose?: () => void;
}

/**
 * Connect to the Architecture WS feed for `projectId`. Returns void —
 * the side effect is fan-out invalidation of `archQueryKeys.security*`
 * (and friends) so any mounted query refetches within the 2s window.
 */
export function useArchitecturePipelineWS(
  projectId: string | null | undefined,
  options: ArchitecturePipelineWSOptions = {},
): void {
  const qc = useQueryClient();
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!projectId) return;
    if (typeof window === 'undefined') return;

    const securityFanOut = debounce(() => {
      // M5-G4 — invalidate the full security slice so the list,
      // posture KPI, and any detail drawers all refetch in one pass.
      void qc.invalidateQueries({ queryKey: archQueryKeys.security.all() });
    }, 2_000);

    const adrFanOut = debounce(() => {
      void qc.invalidateQueries({ queryKey: archQueryKeys.adrs.all() });
    }, 2_000);

    const ws = api.ws(`/ws/architecture/${encodeURIComponent(projectId)}`);

    ws.onmessage = (event) => {
      let parsed: ArchitectureWSMessage;
      try {
        parsed = JSON.parse(String(event.data)) as ArchitectureWSMessage;
      } catch {
        return;
      }

      optsRef.current.onMessage?.(parsed);

      // Security Report lifecycle events → refresh the security slice.
      // We intentionally keep the predicate tight so an unrelated
      // architecture.* event (e.g. a future `architecture.diagram.*`)
      // doesn't accidentally refresh the Security tab.
      switch (parsed.type) {
        case 'architecture.security_report.created':
        case 'architecture.security_report.updated':
        case 'architecture.security_report.status':
        case 'architecture.posture.recomputed':
          securityFanOut();
          break;
        case 'architecture.adr.created':
        case 'architecture.adr.superseded':
          adrFanOut();
          break;
        default:
          // Unknown / unhandled frame — ignore. We don't toast here
          // because some frames (pong / heartbeat) are pure keepalive.
          break;
      }
    };

    ws.onerror = (event) => {
      optsRef.current.onError?.(event);
    };

    ws.onclose = () => {
      securityFanOut.flush();
      adrFanOut.flush();
      optsRef.current.onClose?.();
    };

    return () => {
      securityFanOut.flush();
      adrFanOut.flush();
      ws.close();
    };
    // We intentionally key on projectId only; the option callbacks are
    // ref-stabilized so consumers can pass inline handlers without
    // tearing down the socket on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, qc]);
}