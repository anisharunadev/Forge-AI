#!/usr/bin/env node
/**
 * Forge terminal PTY sidecar (Phase C).
 *
 * A minimal local WebSocket PTY server so the xterm.js terminal
 * pane in apps/forge actually has a live shell to render.
 *
 * Wire protocol: each WebSocket connection spawns one PTY running
 * the user's shell. Bytes typed into xterm go to the PTY stdin;
 * PTY stdout is written back to the WebSocket.
 *
 * Endpoints
 *   ws://localhost:4001/ws/terminal
 *
 * Why a sidecar and not part of the FastAPI orchestrator? Because
 * the real orchestrator (apps/orchestrator/) does not exist on
 * disk yet. When it lands, this sidecar is replaced by the
 * orchestrator's `/v1/terminal/sessions` route and the dev script
 * drops this entry.
 *
 * Dependencies (dev only): `ws`, `node-pty`.
 *
 * Start:    pnpm dev:terminal (or: node packages/forge-terminal-server/dist/server.mjs)
 * Default:  PORT=4001 SHELL=/bin/bash
 *
 * Implementation notes:
 *   - `node-pty` requires a native build step (header files for
 *     libuv). On macOS this works out of the box; on Linux you may
 *     need `apt-get install -y build-essential`.
 *   - The server intentionally has zero auth — it binds to
 *     127.0.0.1 by default and never to a public interface. Override
 *     HOST only on a trusted network.
 */
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { networkInterfaces } from 'os';

const PORT = Number.parseInt(process.env.PORT ?? '4001', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const SHELL = process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : 'bash');
const COLS = Number.parseInt(process.env.COLS ?? '120', 10);
const ROWS = Number.parseInt(process.env.ROWS ?? '30', 10);

function log(...args) {
  console.log(`[terminal-sidecar ${new Date().toISOString()}]`, ...args);
}

const wss = new WebSocketServer({ port: PORT, host: HOST });

wss.on('listening', () => {
  log(`listening on ws://${HOST}:${PORT} — shell=${SHELL}`);
});

wss.on('connection', (ws, req) => {
  const peer = req.socket.remoteAddress ?? '?';
  log(`client connected from ${peer}`);

  // Spawn a fresh PTY per WebSocket connection so each pane is isolated.
  const term = pty.spawn(SHELL, [], {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  let closed = false;
  const safeClose = (code = 1000, reason = 'normal') => {
    if (closed) return;
    closed = true;
    try { term.kill(); } catch { /* already dead */ }
    try { ws.close(code, reason); } catch { /* already closed */ }
  };

  // PTY → WebSocket
  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  term.onExit(({ exitCode, signal }) => {
    log(`pty exited code=${exitCode} signal=${signal ?? '-'}`);
    safeClose(1000, 'pty_exit');
  });

  // WebSocket → PTY (binary frames pass through unchanged)
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      term.write(Buffer.from(data).toString('utf8'));
    } else if (typeof data === 'string') {
      term.write(data);
    } else {
      term.write(Buffer.from(data).toString('utf8'));
    }
  });
  ws.on('close', () => {
    log(`client ${peer} disconnected`);
    safeClose(1000, 'client_close');
  });
  ws.on('error', (err) => {
    log(`socket error from ${peer}: ${err.message}`);
    safeClose(1011, 'socket_error');
  });

  // Initial banner so the user sees something even before they type.
  ws.send(
    `\x1b[1;35mForge Terminal Sidecar\x1b[0m — connected to ${SHELL} on pid ${term.pid}\r\n`,
  );
});

wss.on('error', (err) => {
  log(`server error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    log(`port ${PORT} already in use — is another sidecar running?`);
    process.exit(2);
  }
});

function shutdown(signal) {
  log(`received ${signal}, shutting down`);
  for (const ws of wss.clients) {
    try { ws.close(1001, 'server_shutdown'); } catch { /* ignore */ }
  }
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Touch networkInterfaces so the import is not dead-code-eliminated
// in some bundlers; also useful for the upcoming "show your IP" banner.
log(`host interfaces: ${Object.keys(networkInterfaces()).join(', ') || 'none'}`);
