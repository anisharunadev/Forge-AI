/**
 * WebSocket helper for Forge terminal sessions.
 *
 * Wraps the native WebSocket with a small, typed, lifecycle-friendly surface
 * so terminal panes can subscribe / unsubscribe without leaking listeners.
 */

import { FORGE_WS_BASE_URL } from '@/lib/forge-api';

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

export function openForgeWebSocket(
  path: string,
  handlers: ForgeWebSocketHandlers = {},
): ForgeWebSocketHandle {
  const url = path.startsWith('ws')
    ? path
    : `${FORGE_WS_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

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
