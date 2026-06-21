'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

import { openForgeWebSocket, type ForgeWebSocketHandle } from '@/lib/websocket';
import { FORGE_TERMINAL_WS_URL } from '@/lib/forge-api';

/**
 * Manages the xterm.js lifecycle for a single TerminalPane:
 *   - mounts Terminal into the ref'd container
 *   - attaches FitAddon + WebLinksAddon
 *   - opens a WebSocket to the supplied WS path and pipes bytes both ways
 *   - resizes on ResizeObserver / window resize
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
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<ForgeWebSocketHandle | null>(null);
  const [connected, setConnected] = useState<boolean>(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: {
        // Refreshed (Phase B) — match the forge-950 background and the
        // new indigo accent palette.
        background: '#070b16',
        foreground: '#e6ebf5',
        cursor: '#6366f1',
        cursorAccent: '#0b1020',
        selectionBackground: '#4338ca',
        black: '#0b1020',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#6366f1',
        magenta: '#8b5cf6',
        cyan: '#0ea5e9',
        white: '#e2e8f0',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

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
    socketRef.current = openForgeWebSocket(url, {
      onOpen: () => {
        setConnected(true);
        term.writeln('\x1b[1;32m✓ connected\x1b[0m');
      },
      onClose: () => {
        setConnected(false);
        term.writeln('\x1b[1;33m⚠ disconnected\x1b[0m — start the sidecar with `pnpm dev:terminal`');
      },
      onError: () => {
        setConnected(false);
        term.writeln('\x1b[1;31m✗ sidecar unreachable\x1b[0m — run `pnpm dev:terminal` then retry');
      },
      onMessage: (event) => {
        term.write(typeof event.data === 'string' ? event.data : '');
      },
    });

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

    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
      socketRef.current?.close();
      socketRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setConnected(false);
    };
    // opts.wsPath intentionally triggers reconnect.
  }, [opts.wsPath, opts.welcome]);

  return {
    containerRef,
    connected,
    write: (data: string): void => termRef.current?.write(data),
    writeln: (line: string): void => termRef.current?.writeln(line),
    fit: (): void => {
      try {
        fitRef.current?.fit();
      } catch {
        /* noop */
      }
    },
  };
}
