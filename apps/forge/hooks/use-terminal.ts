'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

import { openForgeWebSocket, type ForgeWebSocketHandle } from '@/lib/websocket';
import { api, FORGE_TERMINAL_WS_URL } from '@/lib/api/client';
import {
  FORGE_DARK_THEME,
  FORGE_TERMINAL_FONT,
  FORGE_TERMINAL_FONT_SIZE,
} from '@/lib/terminal-theme';
import { useTerminalStore } from '@/lib/store';
import { useAuth } from '@/lib/api/auth';

/**
 * Exposes the high-level connection state so banners and status bars
 * can render the correct badge without subscribing to every WS event.
 */
export type TerminalConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * Manages the xterm.js lifecycle for a single TerminalPane:
 *   - mounts Terminal into the ref'd container
 *   - attaches FitAddon + WebLinksAddon
 *   - opens a WebSocket to the supplied WS path and pipes bytes both ways
 *   - resizes on ResizeObserver / window resize
 *   - reports connection state upward so banners / badges stay in sync
 *
 * WebLinksAddon is configured to open links in a new tab — important
 * for terminal workflows where clicking a URL shouldn't navigate the
 * user away from the session.
 */
export function useTerminal(opts: {
  /**
   * Override the default terminal WS path. The default
   * `FORGE_TERMINAL_WS_URL` is `ws://localhost:4001/ws/terminal`,
   * served by `bin/terminal-server.mjs`. Pass any absolute `ws://`
   * URL here to repoint the terminal (e.g. when the real
   * orchestrator exposes `/v1/terminal/sessions`).
   */
  wsPath?: string;
  welcome?: string;
  /** Optional session id — when set, the hook flips the session
   * status to 'active' / 'error' as the socket opens / fails. */
  sessionId?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ForgeWebSocketHandle | null>(null);
  const [connectionState, setConnectionState] =
    useState<TerminalConnectionState>('connecting');
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);
  const setSessionStatus = useTerminalStore((s) => s.setSessionStatus);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: FORGE_TERMINAL_FONT,
      fontSize: FORGE_TERMINAL_FONT_SIZE,
      theme: FORGE_DARK_THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // WebLinksAddon — open links in a new tab so users don't lose
    // their terminal session when a URL appears in the output.
    term.loadAddon(new WebLinksAddon((_e, uri) => {
      window.open(uri, '_blank', 'noopener,noreferrer');
    }));

    term.open(containerRef.current);
    try {
      fit.fit();
    } catch {
      /* container may be hidden initially */
    }

    term.writeln(
      '\x1b[1;35mForge Terminal\x1b[0m — connecting to PTY sidecar on ws://localhost:4001…',
    );
    if (opts.welcome) term.writeln(opts.welcome);

    term.onData((data) => {
      socketRef.current?.send(data);
    });

    termRef.current = term;
    fitRef.current = fit;

    // Always open a socket — the prior version gated on `wsPath`
    // being set, which meant terminals rendered no I/O by default.
    // The default URL is the local PTY sidecar; override via env or
    // pass `wsPath` to repoint.
    const url = opts.wsPath ?? FORGE_TERMINAL_WS_URL;
    let openedAt = 0;
    // Step-71: forward the JWT as `?token=...` so the FastAPI WS at
    // `/ws/terminal/{session_id}` can resolve the principal on the
    // browser-incompatible handshake. Browsers can't set custom
    // headers on WebSocket upgrades; query param is the only path.
    const token = useAuth.getState().token ?? undefined;
    socketRef.current = openForgeWebSocket(
      url,
      {
        onOpen: () => {
          openedAt = performance.now();
          setConnectionState('connected');
          setSessionStatus(opts.sessionId ?? '', 'active');
          term.writeln('\x1b[1;32m✓ connected\x1b[0m');
        },
        onClose: () => {
          setConnectionState('reconnecting');
          setSessionStatus(opts.sessionId ?? '', 'error');
          setLatencyMs(undefined);
          term.writeln(
            '\x1b[1;33m⚠ disconnected\x1b[0m — start the sidecar with `pnpm dev:terminal`',
          );
        },
        onError: () => {
          setConnectionState('reconnecting');
          setSessionStatus(opts.sessionId ?? '', 'error');
          term.writeln(
            '\x1b[1;31m✗ sidecar unreachable\x1b[0m — run `pnpm dev:terminal` then retry',
          );
        },
        onMessage: (event) => {
          if (openedAt > 0 && latencyMs === undefined) {
            // Heuristic: ping latency from open → first inbound byte.
            const ms = Math.round(performance.now() - openedAt);
            if (Number.isFinite(ms) && ms >= 0) setLatencyMs(ms);
          }
          term.write(typeof event.data === 'string' ? event.data : '');
        },
      },
      { token },
    );

    const handleResize = (): void => {
      try {
        fit.fit();
      } catch {
        /* noop */
      }
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(containerRef.current);
    window.addEventListener('resize', handleResize);

    // Listen for paste events filtered by this session's id — the
    // toolbar dispatches a generic 'paste' event with the text and we
    // forward it into the local PTY socket.
    const onWsSend = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string; text: string }>).detail;
      if (!detail?.text) return;
      if (detail.sessionId && detail.sessionId !== opts.sessionId) return;
      socketRef.current?.send(detail.text);
    };
    window.addEventListener('forge:terminal:ws-send', onWsSend);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('forge:terminal:ws-send', onWsSend);
      ro.disconnect();
      socketRef.current?.close();
      socketRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setLatencyMs(undefined);
      setConnectionState('connecting');
    };
    // opts.wsPath intentionally triggers reconnect.
  }, [opts.wsPath, opts.welcome, opts.sessionId, setSessionStatus]);

  return {
    containerRef,
    connectionState,
    latencyMs,
    write: (data: string): void => termRef.current?.write(data),
    writeln: (line: string): void => termRef.current?.writeln(line),
    fit: (): void => {
      try {
        fitRef.current?.fit();
      } catch {
        /* noop */
      }
    },
    focus: (): void => termRef.current?.focus(),
    clear: (): void => termRef.current?.clear(),
    /**
     * Native xterm search — scans the scrollback for the next case-
     * insensitive match of `query`. Highlights + selects the first match
     * found starting from `direction` ('next' | 'prev') of the cursor.
     * Returns the match info (or null if none) so the caller can drive
     * a "1/3" counter UI.
     *
     * Implemented locally because `@xterm/addon-search` isn't part of
     * the dependency set yet; this gets us the same UX without the
     * extra CSS + bundle weight.
     */
    search: (query: string, direction: 'next' | 'prev' = 'next') => {
      const term = termRef.current;
      if (!term || !query) return null;
      const buf = term.buffer.active;
      const totalRows = buf.length;
      const cursorRow = buf.cursorY + buf.viewportY;
      const rowsToScan = Array.from({ length: totalRows }, (_, i) => i);
      if (direction === 'prev') rowsToScan.reverse();
      const startAt = cursorRow;
      const ordered = [
        ...rowsToScan.filter((r) => (direction === 'next' ? r > startAt : r < startAt)),
        ...rowsToScan.filter((r) => (direction === 'next' ? r <= startAt : r >= startAt)),
      ];
      const needle = query.toLowerCase();
      for (const r of ordered) {
        const line = buf.getLine(r);
        if (!line) continue;
        const text = line.translateToString(true).toLowerCase();
        const col = text.indexOf(needle);
        if (col >= 0) {
          term.select(col, r, query.length);
          // Scroll the match into view (best-effort).
          try {
            (term as unknown as { scrollToLine?: (n: number) => void }).scrollToLine?.(r);
          } catch {
            /* noop */
          }
          return { row: r, col, length: query.length };
        }
      }
      // No match — clear selection so the user gets visual feedback.
      try { term.select(0, 0, 0); } catch { /* noop */ }
      return null;
    },
  };
}
