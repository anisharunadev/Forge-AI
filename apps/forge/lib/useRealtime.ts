/**
 * FORA-514 — `useRealtime` hook for the Forge console.
 *
 * Opens a managed WebSocket to the orchestrator's `GET /v1/events`
 * endpoint, multiplexes topic subscriptions across the connection, and
 * falls back to a caller-supplied poll callback whenever the socket is
 * not `open`. Backoff schedule is exponential with jitter (1s, 2s, 4s,
 * 8s, capped at 30s) — see FORA-514 §2.
 *
 * The hook is intentionally side-effect-bounded: it never reaches out
 * to the orchestrator on its own, it only forwards events to handlers
 * the caller registered. Polled fallback is also caller-supplied so the
 * hook stays a transport concern; the dashboard layer picks the poll
 * function (e.g. `getRunsView()` for the eng-lead dashboard, or a
 * tenant-scoped fetcher for FORA-378).
 *
 * SSR safety: when `window` or `WebSocket` is not defined (server-side
 * render, jsdom test mode), the hook short-circuits to a no-op stub.
 * Callers that pass a `fallbackPoll` still get the polled cadence —
 * the WS itself is just inert. This is the contract AC#2 requires.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

/** The five WS topics the orchestrator exposes (FORA-514 §1). */
export const WS_TOPICS = [
  'run.created',
  'run.updated',
  'run.stage_changed',
  'issue.created',
  'issue.updated',
] as const;

export type WsTopic = (typeof WS_TOPICS)[number];

export type RealtimeStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

/** A single WS frame from the orchestrator. Mirrors `apps/orchestrator/src/ws.ts`. */
export interface WsFrame<T = unknown> {
  topic: WsTopic;
  envelope: T;
}

export type FrameHandler = (frame: WsFrame) => void;

export interface UseRealtimeOptions {
  /** Optional token to forward as `Authorization: Bearer` on the WS upgrade. */
  token?: string | null;
  /**
   * Fallback poll. Called by the hook when the WS is not `open` (initial
   * connecting, reconnecting after a drop, or in SSR/jsdom where WS is
   * a no-op). The cadence is the caller-supplied `pollIntervalMs`
   * (default 5_000 — matches the FORA-374 v1 polled cadence).
   */
  fallbackPoll?: () => void | Promise<void>;
  /** Polling interval when WS is not `open`. Default 5000. */
  pollIntervalMs?: number;
  /**
   * Override the WS base URL. Defaults to the same-origin orchestrator
   * resolved through `NEXT_PUBLIC_FORGE_API_URL` (or the server base).
   * Tests inject a `ws://127.0.0.1:<port>/v1/events` URL.
   */
  wsUrl?: string;
  /**
   * Test seam — return a `WebSocket` constructor. Defaults to the
   * global `WebSocket`. Tests inject a fake; production ignores it.
   */
  WebSocketImpl?: typeof WebSocket;
}

export interface UseRealtimeResult {
  status: RealtimeStatus;
  subscribe: (topic: WsTopic, handler: FrameHandler) => () => void;
  unsubscribe: (topic: WsTopic, handler: FrameHandler) => void;
}

/**
 * Backoff schedule for the WS reconnect (FORA-514 §2).
 * Sequence (ms): 1000, 2000, 4000, 8000, capped at 30_000.
 * Each attempt adds uniform jitter in `[0.75×, 1.0×)` so a fleet of
 * reconnecting clients doesn't lockstep. Exported for tests.
 */
export function backoffMsFor(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * Math.pow(2, Math.max(0, attempt)));
  // Pull jitter factor in [0.75, 1.0); never sleep shorter than 0.75× base.
  const jitter = 0.75 + 0.25 * random();
  return Math.max(750, Math.floor(base * jitter));
}

/** Detect whether the current environment supports a real WS connection. */
function hasWebSocket(): boolean {
  return typeof window !== 'undefined' && typeof WebSocket !== 'undefined';
}

/**
 * Resolve the orchestrator WS URL. Mirrors `lib/api.ts` resolution:
 * the `NEXT_PUBLIC_FORGE_API_URL` env wins, falling back to the dev
 * orchestrator at `localhost:4000`. When `wsUrl` is supplied, it wins
 * outright (test seam).
 */
function resolveWsUrl(override: string | undefined): string {
  if (override && override.length > 0) return override;
  const base =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_FORGE_API_URL) ||
    'http://localhost:4000';
  return base.replace(/^http/, 'ws') + '/v1/events';
}

/**
 * The hook. Mount-time effect opens the WS; cleanup tears down timers,
 * the socket, and any pending fallback poll. The returned `subscribe`
 * / `unsubscribe` pair is stable (a ref-backed Map) so callers can
 * register handlers inside `useEffect` without forcing re-renders.
 */
export function useRealtime(opts: UseRealtimeOptions = {}): UseRealtimeResult {
  // Initialize to `connecting` when the environment supports WS so the
  // first effect run matches the eventual state. Otherwise the initial
  // `closed` value would fire the polled fallback once, then re-fire when
  // the WS-mount effect flips status to `connecting` — the test suite
  // observes a double-poll that AC #2 does not actually require.
  const [status, setStatus] = useState<RealtimeStatus>(() =>
    hasWebSocket() ? 'connecting' : 'closed',
  );
  const handlersRef = useRef<Map<WsTopic, Set<FrameHandler>>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closedByCallerRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const wsUrl = useMemo(
    () => resolveWsUrl(opts.wsUrl),
    // opts.wsUrl is the only thing that should change the URL — token
    // and poll options are read off the ref inside callbacks.
    [opts.wsUrl],
  );

  // Stable subscribe / unsubscribe pair: the Set lives in a ref so
  // adding handlers does not cause a re-render. The returned functions
  // are the same identity across renders.
  const subscribe = useMemo(() => {
    return (topic: WsTopic, handler: FrameHandler) => {
      let set = handlersRef.current.get(topic);
      if (!set) {
        set = new Set();
        handlersRef.current.set(topic, set);
      }
      set.add(handler);
      return () => {
        const s = handlersRef.current.get(topic);
        if (s) s.delete(handler);
      };
    };
  }, []);

  const unsubscribe = useMemo(() => {
    return (topic: WsTopic, handler: FrameHandler) => {
      const s = handlersRef.current.get(topic);
      if (s) s.delete(handler);
    };
  }, []);

  // Drive the poll-fallback timer in lockstep with the WS status.
  // The hook only starts the timer when the WS is NOT `open` AND the
  // caller supplied a `fallbackPoll`. While `open`, the polled cadence
  // is suspended — WS frames drive the UI directly.
  useEffect(() => {
    const { fallbackPoll, pollIntervalMs = 5_000 } = optsRef.current;
    if (!fallbackPoll) return;
    if (status === 'open') {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    // Run the first poll immediately so SSR/initial-load shows fresh
    // data without waiting a full interval.
    void Promise.resolve(fallbackPoll()).catch(() => {});
    pollTimerRef.current = setInterval(() => {
      void Promise.resolve(fallbackPoll()).catch(() => {});
    }, pollIntervalMs);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [status]);

  // Open / reconnect the WS whenever the URL changes or the hook
  // mounts. Cleanup tears down everything: socket, timers, and any
  // future reconnect attempt scheduled by `scheduleReconnect`.
  useEffect(() => {
    if (!hasWebSocket()) {
      // SSR or jsdom — stay `closed`, fall back to the polled cadence.
      setStatus('closed');
      return;
    }
    closedByCallerRef.current = false;

    const WS = opts.WebSocketImpl ?? WebSocket;
    const topicsForUrl = Array.from(handlersRef.current.keys()).join(',');

    function open(): void {
      setStatus(attemptRef.current === 0 ? 'connecting' : 'reconnecting');
      let socket: WebSocket;
      try {
        const token = optsRef.current.token;
        const protocols =
          token && token.length > 0 ? [`bearer.${token}`] : undefined;
        // Add the topics query param BEFORE the WS connects so the
        // server-side handler can validate the whitelist immediately.
        const url = `${wsUrl}?topics=${encodeURIComponent(topicsForUrl || 'run.updated')}`;
        socket = new WS(url, ...(protocols ? [protocols] : []));
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        attemptRef.current = 0;
        setStatus('open');
      });
      socket.addEventListener('message', (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse((event as MessageEvent).data as string);
        } catch {
          return;
        }
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          typeof (parsed as { topic?: unknown }).topic !== 'string'
        ) {
          return;
        }
        const frame = parsed as WsFrame;
        const topic = frame.topic as WsTopic;
        const set = handlersRef.current.get(topic);
        if (!set) return;
        for (const h of set) {
          try {
            h(frame);
          } catch {
            // Handler errors must not break the WS loop. Real
            // dashboards log inside their own handler.
          }
        }
      });
      socket.addEventListener('close', () => {
        socketRef.current = null;
        if (closedByCallerRef.current) {
          setStatus('closed');
          return;
        }
        scheduleReconnect();
      });
      socket.addEventListener('error', () => {
        // `close` always follows `error` per the WS spec — let the
        // close handler drive the reconnect. We still clear the
        // socket ref defensively.
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      });
    }

    function scheduleReconnect(): void {
      if (closedByCallerRef.current) {
        setStatus('closed');
        return;
      }
      const delay = backoffMsFor(attemptRef.current);
      attemptRef.current += 1;
      setStatus('reconnecting');
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        open();
      }, delay);
    }

    open();

    return () => {
      closedByCallerRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      const sock = socketRef.current;
      socketRef.current = null;
      if (sock) {
        try {
          sock.close();
        } catch {
          /* ignore */
        }
      }
    };
    // wsUrl is the only dependency that should change the connection;
    // token is read off the ref to avoid re-opening on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  return { status, subscribe, unsubscribe };
}
