/**
 * WebSocket helper for Forge terminal sessions.
 *
 * Wraps the native WebSocket with a small, typed, lifecycle-friendly surface
 * so terminal panes can subscribe / unsubscribe without leaking listeners.
 */

import { FORGE_WS_BASE_URL } from '@/lib/api/client';
export type ForgeWebSocketState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'error';

export interface ForgeWebSocketHandlers {
  onOpen?: (event: Event) => void;
  onMessage?: (event: MessageEvent) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onStateChange?: (state: ForgeWebSocketState) => void;
}

export interface ForgeWebSocketHandle {
  socket: WebSocket;
  send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => void;
  close: (code?: number, reason?: string) => void;
}

export interface ForgeWebSocketOptions {
  /**
   * JWT to forward as `?token=...` query parameter (browsers cannot
   * set custom headers on WebSocket handshakes). The backend WS at
   * `/ws/terminal/{session_id}` resolves the principal from this param
   * when present, then enforces tenant + RBAC.
   */
  token?: string;
}

export function openForgeWebSocket(
  path: string,
  handlers: ForgeWebSocketHandlers = {},
  opts: ForgeWebSocketOptions = {},
): ForgeWebSocketHandle {
  const base = path.startsWith('ws')
    ? path
    : `${FORGE_WS_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const url = opts.token
    ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(opts.token)}`
    : base;

  const socket = new WebSocket(url);
  let state: ForgeWebSocketState = 'connecting';
  handlers.onStateChange?.(state);

  socket.addEventListener('open', (event) => {
    state = 'open';
    handlers.onStateChange?.(state);
    handlers.onOpen?.(event);
  });
  socket.addEventListener('message', (event) => {
    handlers.onMessage?.(event);
  });
  socket.addEventListener('close', (event) => {
    state = 'closed';
    handlers.onStateChange?.(state);
    handlers.onClose?.(event);
  });
  socket.addEventListener('error', (event) => {
    state = 'error';
    handlers.onStateChange?.(state);
    handlers.onError?.(event);
  });

  return {
    socket,
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    },
    close: (code = 1000, reason = 'client_close') => {
      state = 'closing';
      handlers.onStateChange?.(state);
      try {
        socket.close(code, reason);
      } catch {
        /* noop */
      }
    },
  };
}
