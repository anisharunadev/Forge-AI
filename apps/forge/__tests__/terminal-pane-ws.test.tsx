// Step 71 — Terminal WS glue unit test.
//
// Verifies the contract that bridges the browser → `/ws/terminal/{id}`:
//   1. `openForgeWebSocket` builds a URL with `?token=...` when a JWT
//      is supplied (the only browser-safe way to forward auth on a
//      WebSocket upgrade).
//   2. The native `WebSocket` instance is created against the resolved
//      URL (base + path + token).
//   3. onOpen / onMessage / onClose handlers fire on the corresponding
//      synthetic events so the pane can flip its connection state.
//
// We deliberately test the glue layer (`lib/websocket.ts`) rather than
// mounting `TerminalPane`. The Pane pulls in xterm.js which needs
// canvas measurement APIs in jsdom; mocking that chain adds ~80 lines
// of brittle setup for what is, at the contract level, one helper.
// The end-to-end protocol is covered by `backend/tests/test_terminal_ws.py`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  openForgeWebSocket,
  type ForgeWebSocketHandle,
} from '@/lib/websocket';

type Listener = (event: Event | MessageEvent | CloseEvent) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: Listener | null = null;
  onmessage: Listener | null = null;
  onclose: Listener | null = null;
  onerror: Listener | null = null;
  sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data);
  }

  close(code = 1000, _reason = ''): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Test helpers — drive the socket into the state the real browser
  // would observe.
  fakeOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }
  fakeMessage(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
  fakeClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  // ponytail: cast to unknown — jsdom doesn't ship a real WS, and we
  // don't need one for a unit test of the wrapper.
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openForgeWebSocket — TerminalPane WS glue', () => {
  it('appends ?token=<jwt> when a token is supplied', () => {
    const handle: ForgeWebSocketHandle = openForgeWebSocket(
      '/ws/terminal/abc-123',
      { onOpen: () => undefined },
      { token: 'jwt.payload.sig' },
    );
    const sock = FakeWebSocket.instances[0];
    expect(sock).toBeDefined();
    expect(sock!.url).toBe('/ws/terminal/abc-123?token=jwt.payload.sig');
    handle.close();
  });

  it('omits the query string when no token is provided', () => {
    const handle = openForgeWebSocket('/ws/terminal/abc-123');
    const sock = FakeWebSocket.instances[0]!;
    expect(sock.url).toBe('/ws/terminal/abc-123');
    handle.close();
  });

  it('encodes special characters in the JWT', () => {
    const handle = openForgeWebSocket(
      '/ws/terminal/abc-123',
      {},
      { token: 'a/b+c d=' },
    );
    const sock = FakeWebSocket.instances[0]!;
    // RFC 6750 — Bearer tokens are URL-encoded so `+` and `/` don't
    // get reinterpreted by the WS server's query parser.
    expect(sock.url).toBe('/ws/terminal/abc-123?token=a%2Fb%2Bc%20d%3D');
    handle.close();
  });

  it('fires onOpen when the socket transitions to open', () => {
    const onOpen = vi.fn();
    const handle = openForgeWebSocket('/ws/terminal/x', { onOpen });
    FakeWebSocket.instances[0]!.fakeOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
    handle.close();
  });

  it('forwards message data verbatim to onMessage', () => {
    const onMessage = vi.fn();
    const handle = openForgeWebSocket('/ws/terminal/x', { onMessage });
    FakeWebSocket.instances[0]!.fakeOpen();
    // The backend wraps PTY bytes as `{type:"output", data:"<base64>"}`.
    // The glue must pass the raw frame through; decoding is the pane's job.
    const frame = JSON.stringify({ type: 'output', data: 'aGVsbG8=' });
    FakeWebSocket.instances[0]!.fakeMessage(frame);
    expect(onMessage).toHaveBeenCalledTimes(1);
    const event = onMessage.mock.calls[0]![0] as MessageEvent;
    expect(event.data).toBe(frame);
    handle.close();
  });

  it('fires onClose when the socket closes', () => {
    const onClose = vi.fn();
    const handle = openForgeWebSocket('/ws/terminal/x', { onClose });
    FakeWebSocket.instances[0]!.fakeClose();
    expect(onClose).toHaveBeenCalledTimes(1);
    handle.close();
  });

  it('drops sends when the socket is not yet open', () => {
    const handle = openForgeWebSocket('/ws/terminal/x');
    const sock = FakeWebSocket.instances[0]!;
    // CONNECTING — the send must be a no-op so the pane never crashes
    // trying to write before the handshake completes.
    handle.send('ls\n');
    expect(sock.sent).toHaveLength(0);
    sock.fakeOpen();
    handle.send('ls\n');
    expect(sock.sent).toEqual(['ls\n']);
    handle.close();
  });
});