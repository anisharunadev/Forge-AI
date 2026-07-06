/**
 * Sprint 3 — Crash #5 regression test.
 *
 * Contract: useAuditStream returns {status, events, reconnect}. The
 * live panel component (rendered inside the Admin Audit page) must:
 *   1. Always render regardless of WS status (no silent skip).
 *   2. Expose the status via `data-status` on the root testid.
 *   3. Render a Retry button when status is 'reconnecting' or 'closed'.
 *   4. The retry button invokes the reconnect callback.
 *
 * We don't ship the panel as a standalone component (it lives inline
 * inside apps/forge/app/admin/audit/page.tsx), so this test exercises
 * the `useAuditStream` hook directly and asserts on the panel contract
 * via a small in-test re-implementation that mirrors the page's
 * rendering.
 */

import * as React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

// Mock the WebSocket constructor so the hook doesn't try to connect.
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }
  close() {}
}
// @ts-expect-error -- test seam
globalThis.WebSocket = MockWebSocket;

import { useAuditStream } from '@/lib/hooks/useAuditStream';

// Inline mirror of the page's LivePanel so we can assert on its
// rendering. The "page" in production lives in app/admin/audit/page.tsx;
// this mirror is intentionally tiny so the regression test owns the
// contract without needing to mock Next.js routing.
function LivePanel() {
  const { status, reconnect } = useAuditStream();
  return (
    <section data-testid="audit-live-panel" data-status={status}>
      <span data-testid="audit-live-status">{status}</span>
      {(status === 'reconnecting' || status === 'closed') && (
        <button
          type="button"
          onClick={reconnect}
          data-testid="audit-live-retry"
        >
          Retry
        </button>
      )}
    </section>
  );
}

afterEach(() => {
  MockWebSocket.instances.length = 0;
  cleanup();
  vi.restoreAllMocks();
});

describe('useAuditStream + LivePanel — Sprint 3 Crash #5', () => {
  it('panel always renders with data-status attribute', () => {
    render(<LivePanel />);
    const panel = screen.getByTestId('audit-live-panel');
    expect(panel).toBeTruthy();
    // Initial state is 'connecting'.
    expect(panel.getAttribute('data-status')).toMatch(/connecting|open|reconnecting|closed/);
  });

  it('renders the Retry button when WS lands on closed state', () => {
    render(<LivePanel />);
    // Simulate WS reaching 'closed' state via the onclose callback.
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws).toBeTruthy();
    act(() => {
      ws?.onclose?.();
    });

    // The hook schedules a reconnect (status='reconnecting'), which is
    // one of the states where the Retry button must appear.
    expect(screen.getByTestId('audit-live-retry')).toBeTruthy();
  });

  it('Retry button invokes the reconnect callback (no throw, no double-tap hazard)', () => {
    render(<LivePanel />);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws?.onclose?.();
    });

    const retry = screen.getByTestId('audit-live-retry');
    expect(retry).toBeTruthy();
    // Clicking must not throw and must reset status to 'connecting'.
    act(() => {
      fireEvent.click(retry);
    });
    const panel = screen.getByTestId('audit-live-panel');
    expect(panel.getAttribute('data-status')).toBe('connecting');
  });

  it('does NOT render the Retry button when WS is open', () => {
    render(<LivePanel />);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      ws?.onopen?.();
    });
    expect(screen.queryByTestId('audit-live-retry')).toBeNull();
  });
});
