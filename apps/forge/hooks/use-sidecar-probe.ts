'use client';

/**
 * useSidecarProbe — a lightweight, non-data WebSocket probe to
 * `ws://localhost:4001`. We open a short-lived socket on a configurable
 * interval; if it opens, the sidecar is reachable.
 *
 * The probe intentionally does NOT consume bytes — it's purely a reachability
 * signal so the SidecarBanner can decide whether to render its warning, and
 * the page-level ConnectedBadge can show real latency.
 *
 * Skill influence:
 *   - ux-guideline (status indicator) — single source of truth for the
 *     "sidecar reachable" state across banner, badge, and status bar.
 *   - prefers-reduced-motion — no animations are introduced here; the
 *     global reduced-motion rule already suppresses pulsing dots.
 */

import * as React from 'react';

import { FORGE_TERMINAL_WS_URL } from '@/lib/forge-api';

export type SidecarState = 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface UseSidecarProbeOptions {
  /** Endpoint to probe. Defaults to the FORGE_TERMINAL_WS_URL. */
  endpoint?: string;
  /** Poll interval when disconnected (ms). */
  pollIntervalMs?: number;
  /**
   * Number of consecutive failures before flipping to `failed`. The
   * banner exposes a "View logs" link + "Try again" button instead of
   * auto-retrying beyond this point.
   */
  maxAttemptsBeforeFail?: number;
}

export interface UseSidecarProbeResult {
  state: SidecarState;
  latencyMs?: number;
  /** Number of consecutive failed attempts. Resets on success. */
  attempts: number;
  /** Force an immediate re-probe and reset the failure counter. */
  retry: () => void;
  /** Open the sidecar log tail in a new tab. */
  viewLogs: () => void;
}

export function useSidecarProbe(
  opts: UseSidecarProbeOptions = {},
): UseSidecarProbeResult {
  const endpoint = opts.endpoint ?? FORGE_TERMINAL_WS_URL;
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  const maxAttempts = opts.maxAttemptsBeforeFail ?? 5;

  const [state, setState] = React.useState<SidecarState>('connecting');
  const [latencyMs, setLatencyMs] = React.useState<number | undefined>(undefined);
  const [attempts, setAttempts] = React.useState(0);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    const startedAt = performance.now();

    const open = () => {
      try {
        socket = new WebSocket(endpoint);
      } catch {
        if (cancelled) return;
        setState((prev) => {
          const nextAttempts = attempts + 1;
          setAttempts(nextAttempts);
          if (nextAttempts >= maxAttempts) return 'failed';
          return prev === 'connected' ? prev : 'disconnected';
        });
        timer = window.setTimeout(open, pollIntervalMs);
        return;
      }
      socket.addEventListener('open', () => {
        if (cancelled) return;
        const ms = Math.round(performance.now() - startedAt);
        setLatencyMs(Number.isFinite(ms) ? ms : undefined);
        setState('connected');
        setAttempts(0);
        window.setTimeout(() => {
          try {
            socket?.close();
          } catch {
            /* noop */
          }
          if (!cancelled) {
            timer = window.setTimeout(open, pollIntervalMs);
          }
        }, 500);
      });
      socket.addEventListener('error', () => {
        if (cancelled) return;
        try {
          socket?.close();
        } catch {
          /* noop */
        }
        setState((prev) => {
          const nextAttempts = attempts + 1;
          setAttempts(nextAttempts);
          if (nextAttempts >= maxAttempts) return 'failed';
          return prev === 'connected' ? 'disconnected' : prev;
        });
        timer = window.setTimeout(open, pollIntervalMs);
      });
      socket.addEventListener('close', () => {
        if (cancelled) return;
        if (state === 'connecting') {
          // Initial open failed — count it.
          setState((prev) => {
            const nextAttempts = attempts + 1;
            setAttempts(nextAttempts);
            if (nextAttempts >= maxAttempts) return 'failed';
            return prev === 'connected' ? prev : 'disconnected';
          });
          timer = window.setTimeout(open, pollIntervalMs);
        }
      });
    };

    setState('connecting');
    open();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, pollIntervalMs, nonce]);

  const retry = React.useCallback(() => {
    setAttempts(0);
    setNonce((n) => n + 1);
  }, []);

  const viewLogs = React.useCallback(() => {
    // The PTY sidecar runs `bin/terminal-server.mjs` and writes to its
    // own stdout. Until we have a real log stream endpoint, deep-link
    // to the terminal server log file under the agent-runs directory.
    const url = `/forge-command-center?source=terminal-sidecar&ts=${Date.now()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  return { state, latencyMs, attempts, retry, viewLogs };
}
