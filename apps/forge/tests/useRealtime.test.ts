/**
 * FORA-514 — `useRealtime` hook unit tests.
 *
 * Asserts the AC bar:
 *   1. `backoffMsFor` returns the documented schedule (1→2→4→8s, cap 30s,
 *      jitter in [0.75×, 1.0×) so the schedule never sleeps tighter than
 *      750 ms regardless of jitter).
 *   2. Subscribe / unsubscribe pairs register and tear down topic handlers.
 *   3. Status transitions `connecting → open` on socket open, and a close
 *      event schedules a `reconnecting` retry rather than going `closed`.
 *   4. The hook is a no-op when `WebSocket` is undefined (jsdom test mode
 *      by default) — `status === 'closed'` and no socket is opened.
 *   5. When `fallbackPoll` is supplied AND the WS is not `open`, the poll
 *      runs on the supplied interval — covers AC#2's "fall back to polled
 *      REST while reconnecting" contract.
 *   6. While `open`, the polled cadence is suspended (WS frames drive the
 *      UI directly).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  backoffMsFor,
  useRealtime,
  type FrameHandler,
  type WsTopic,
  type WsFrame,
} from '../lib/useRealtime';

/**
 * A minimal WebSocket double that records construction, simulates
 * open/close, and exposes a helper to dispatch a JSON frame. The double
 * is intentionally narrow — the hook only relies on addEventListener
 * and a constructor that takes `(url, protocols?)`.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static reset(): void {
    FakeWebSocket.instances.length = 0;
  }

  url: string;
  protocols?: string[];
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  closed = false;
  readyState = 0;

  constructor(url: string, protocols?: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(name: string, handler: (event: unknown) => void): void {
    if (!this.listeners[name]) this.listeners[name] = [];
    this.listeners[name]!.push(handler);
  }
  removeEventListener(): void {
    /* noop — tests don't need to undo */
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.fire('close', { code: 1006, reason: '' });
  }
  /** Test seam: simulate the upgrade completing. */
  openNow(): void {
    this.readyState = 1;
    this.fire('open', {});
  }
  /** Test seam: dispatch a parsed JSON frame. */
  sendFrame(frame: WsFrame): void {
    this.fire('message', { data: JSON.stringify(frame) });
  }
  /** Test seam: simulate an error without a close. */
  errorOut(): void {
    this.fire('error', { message: 'boom' });
  }
  private fire(name: string, event: unknown): void {
    for (const h of this.listeners[name] ?? []) h(event);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
  // Drop any WebSocket polyfill the previous test installed on globalThis.
  // jsdom does NOT define WebSocket by default; a hook test polyfilled it
  // for the duration of one scenario.
  Reflect.deleteProperty(globalThis as { WebSocket?: unknown }, 'WebSocket');
});

describe('backoffMsFor', () => {
  it('follows the 1→2→4→8s schedule (cap 30s) with deterministic random', () => {
    const r = (): number => 0.5; // jitter = 0.75 + 0.25*0.5 = 0.875 → 875ms floor
    // The actual values:
    //   attempt 0 → 1000 * 0.875 = 875
    //   attempt 1 → 2000 * 0.875 = 1750
    //   attempt 2 → 4000 * 0.875 = 3500
    //   attempt 3 → 8000 * 0.875 = 7000
    //   attempt 4 → 16000 * 0.875 = 14000
    //   attempt 5 → 30000 * 0.875 = 26250 (capped)
    expect(backoffMsFor(0, r)).toBe(875);
    expect(backoffMsFor(1, r)).toBe(1750);
    expect(backoffMsFor(2, r)).toBe(3500);
    expect(backoffMsFor(3, r)).toBe(7000);
    expect(backoffMsFor(4, r)).toBe(14000);
    expect(backoffMsFor(5, r)).toBe(26250);
  });

  it('never sleeps tighter than 750 ms regardless of jitter', () => {
    // Even with random() === 0, the floor clamps to 750 ms so the hook
    // never spins under 1 s as FORA-514 §2 requires.
    expect(backoffMsFor(0, () => 0)).toBeGreaterThanOrEqual(750);
    expect(backoffMsFor(0, () => 0)).toBe(750);
  });

  it('caps at 30 s', () => {
    const r = (): number => 1; // jitter = 1.0 → 30_000
    expect(backoffMsFor(10, r)).toBe(30_000);
    expect(backoffMsFor(20, r)).toBe(30_000);
  });
});

describe('useRealtime (with WebSocket)', () => {
  function mountWithSocket(opts: Parameters<typeof useRealtime>[0]) {
    // Install the fake on globalThis so `WebSocket` resolves to it.
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
    // The hook types `WebSocketImpl` as `typeof WebSocket`; the test
    // fake is duck-typed compatible (constructor + addEventListener +
    // close + send-equivalents) but doesn't expose the lib.dom WebSocket
    // `prototype` / CONNECTING constants. The cast is the seam: the fake
    // IS a real WS as far as the hook is concerned.
    const wsImpl = FakeWebSocket as unknown as typeof WebSocket;
    return renderHook(() => useRealtime({ WebSocketImpl: wsImpl, ...opts }));
  }

  it('transitions connecting → open on socket open', () => {
    const { result } = mountWithSocket({ wsUrl: 'ws://test/v1/events' });
    expect(result.current.status).toBe('connecting');
    const sock = FakeWebSocket.instances[0]!;
    expect(sock.url).toBe('ws://test/v1/events?topics=run.updated');
    act(() => sock.openNow());
    expect(result.current.status).toBe('open');
  });

  it('schedules a reconnect on close (exponential backoff)', () => {
    const { result } = mountWithSocket({
      wsUrl: 'ws://test/v1/events',
    });
    const sock = FakeWebSocket.instances[0]!;
    act(() => sock.openNow());
    act(() => sock.close());
    // After close, status flips to `reconnecting` and a retry is queued.
    expect(result.current.status).toBe('reconnecting');
    // Fast-forward past the first backoff (attempt 0 → ~750-1000ms with
    // jitter). Use 1100 ms to clear any plausible jitter window.
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    // A second socket was constructed.
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it('delivers messages to subscribed handlers only', () => {
    const { result } = mountWithSocket({ wsUrl: 'ws://test/v1/events' });
    const sock = FakeWebSocket.instances[0]!;
    act(() => sock.openNow());

    const seen: WsFrame[] = [];
    const handler: FrameHandler = (frame) => seen.push(frame);
    const release = result.current.subscribe('run.updated', handler);
    // Subscribe to a topic we won't fire so the test confirms isolation.
    const seenOther: WsFrame[] = [];
    result.current.subscribe('issue.updated', (frame) => seenOther.push(frame));

    act(() => sock.sendFrame({ topic: 'run.updated', envelope: { x: 1 } }));
    expect(seen).toHaveLength(1);
    expect(seenOther).toHaveLength(0);

    // Unsubscribe and confirm no further deliveries.
    release();
    act(() => sock.sendFrame({ topic: 'run.updated', envelope: { x: 2 } }));
    expect(seen).toHaveLength(1);
  });

  it('falls back to polled cadence when WS is not open', () => {
    const fallback = vi.fn();
    const { result, unmount } = mountWithSocket({
      wsUrl: 'ws://test/v1/events',
      fallbackPoll: fallback,
      pollIntervalMs: 2_000,
    });
    // No socket has been opened yet — `connecting` is the first state.
    // Polling should be active.
    expect(result.current.status).toBe('connecting');
    // First poll fires immediately on mount.
    expect(fallback).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2_000));
    expect(fallback).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(2_000));
    expect(fallback).toHaveBeenCalledTimes(3);

    // Open the socket — polling must stop while `open`.
    const sock = FakeWebSocket.instances[0]!;
    act(() => sock.openNow());
    act(() => vi.advanceTimersByTime(4_000));
    expect(fallback).toHaveBeenCalledTimes(3);

    // Close — polling resumes with the same cadence.
    act(() => sock.close());
    // The reconnect timer is the backoff window — advance past it AND
    // a poll interval to confirm polling resumes.
    act(() => vi.advanceTimersByTime(1_100));
    // We are back in `reconnecting`; the next poll fires on the interval.
    act(() => vi.advanceTimersByTime(2_000));
    expect(fallback.mock.calls.length).toBeGreaterThanOrEqual(4);

    unmount();
  });

  it('uses bearer.<token> as Sec-WebSocket-Protocol when token supplied', () => {
    mountWithSocket({ wsUrl: 'ws://test/v1/events', token: 'abc123' });
    const sock = FakeWebSocket.instances[0]!;
    expect(sock.protocols).toEqual(['bearer.abc123']);
  });

  it('does not open a socket when WebSocket is undefined (jsdom test mode)', () => {
    // No globalThis.WebSocket → the hook must short-circuit to `closed`.
    // We assert this WITHOUT polyfilling, leaving the global absent.
    Reflect.deleteProperty(globalThis as { WebSocket?: unknown }, 'WebSocket');
    const fallback = vi.fn();
    const { result } = renderHook(() =>
      useRealtime({ wsUrl: 'ws://test/v1/events', fallbackPoll: fallback, pollIntervalMs: 1_000 }),
    );
    expect(result.current.status).toBe('closed');
    // The poll fallback still ticks because the hook is reachable but
    // the WS is a no-op — exactly the SSR / jsdom contract.
    act(() => vi.advanceTimersByTime(1_000));
    expect(fallback).toHaveBeenCalled();
  });
});

describe('useRealtime (subscribe API)', () => {
  beforeEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  });

  // Cast through unknown — the test fake is duck-typed compatible
  // (constructor + addEventListener + close) but doesn't expose the
  // lib.dom WebSocket `prototype` / CONNECTING constants.
  const wsImpl = FakeWebSocket as unknown as typeof WebSocket;

  it('subscribe returns an unsubscribe handle that tears down the handler', () => {
    const { result } = renderHook(() =>
      useRealtime({ wsUrl: 'ws://test/v1/events', WebSocketImpl: wsImpl }),
    );
    const sock = FakeWebSocket.instances[0]!;
    act(() => sock.openNow());
    const handler = vi.fn();
    const release = result.current.subscribe('run.stage_changed' as WsTopic, handler);
    act(() => sock.sendFrame({ topic: 'run.stage_changed', envelope: {} }));
    expect(handler).toHaveBeenCalledTimes(1);
    release();
    act(() => sock.sendFrame({ topic: 'run.stage_changed', envelope: {} }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('isolates handlers across topics', () => {
    const { result } = renderHook(() =>
      useRealtime({ wsUrl: 'ws://test/v1/events', WebSocketImpl: wsImpl }),
    );
    const sock = FakeWebSocket.instances[0]!;
    act(() => sock.openNow());
    const a = vi.fn();
    const b = vi.fn();
    result.current.subscribe('run.created', a);
    result.current.subscribe('run.updated', b);
    act(() => sock.sendFrame({ topic: 'run.created', envelope: { id: 1 } }));
    act(() => sock.sendFrame({ topic: 'run.updated', envelope: { id: 2 } }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
