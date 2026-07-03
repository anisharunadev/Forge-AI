/**
 * Step-71 — `useTerminal` JWT wiring test.
 *
 * Asserts that:
 *   1. The hook opens a WebSocket whose URL includes the JWT from the
 *      auth store, forwarded as `?token=<jwt>` (browser WebSocket
 *      handshake can't set custom headers — the backend `/ws/terminal/{id}`
 *      handler validates the principal from this param).
 *   2. The path passed via `wsPath` is the one we constructed at the
 *      call site (e.g. `${wsBase}/ws/terminal/${sessionId}`).
 *
 * Test seam: `globalThis.WebSocket` is stubbed with the same
 * `FakeWebSocket` shape used by `useRealtime.test.ts`. The hook itself
 * constructs the WebSocket via `openForgeWebSocket` which calls
 * `new WebSocket(url)` — replacing the global is enough.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock the auth store BEFORE importing the hook so the module captures
// our stubbed `useAuth.getState()`. We point at a real JWT to make the
// query-param assertion deterministic.
vi.mock('@/lib/api/auth', () => ({
  useAuth: {
    getState: () => ({ token: 'test-jwt-abc123' }),
    subscribe: () => () => {},
  },
}));

// `xterm` and friends pull in canvas APIs that jsdom doesn't ship.
// Stub them so the hook mounts without crashing the test runner.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    writeln() {}
    write() {}
    onData() {}
    select() {}
    dispose() {}
    get buffer() {
      return {
        active: {
          length: 0,
          cursorY: 0,
          viewportY: 0,
          getLine: () => null,
        },
      };
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances.length = 0;
  }
  url: string;
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  closed = false;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(name: string, handler: (event: unknown) => void): void {
    if (!this.listeners[name]) this.listeners[name] = [];
    this.listeners[name]!.push(handler);
  }
  removeEventListener(): void {
    /* noop */
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.listeners['close']?.forEach((h) => h({ code: 1006, reason: '' }));
  }
}

beforeEach(() => {
  FakeWebSocket.reset();
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  Reflect.deleteProperty(globalThis as { WebSocket?: unknown }, 'WebSocket');
  vi.clearAllMocks();
});

describe('useTerminal — step-71 auth wiring', () => {
  it('opens WS at the supplied wsPath with ?token=<jwt>', async () => {
    const { useTerminal } = await import('@/hooks/use-terminal');

    renderHook(() =>
      useTerminal({
        wsPath: 'ws://localhost:8000/ws/terminal/sess-uuid-1',
        sessionId: 'sess-uuid-1',
      }),
    );

    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBe(1);
    });

    const sock = FakeWebSocket.instances[0]!;
    expect(sock.url).toBe(
      'ws://localhost:8000/ws/terminal/sess-uuid-1?token=test-jwt-abc123',
    );
  });

  it('omits ?token when the auth store has no token', async () => {
    vi.resetModules();
    vi.doMock('@/lib/api/auth', () => ({
      useAuth: {
        getState: () => ({ token: null }),
        subscribe: () => () => {},
      },
    }));
    const { useTerminal } = await import('@/hooks/use-terminal');

    renderHook(() =>
      useTerminal({
        wsPath: 'ws://localhost:8000/ws/terminal/sess-uuid-2',
        sessionId: 'sess-uuid-2',
      }),
    );

    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBe(1);
    });

    expect(FakeWebSocket.instances[0]!.url).toBe(
      'ws://localhost:8000/ws/terminal/sess-uuid-2',
    );
  });
});