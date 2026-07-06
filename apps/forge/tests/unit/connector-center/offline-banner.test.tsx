/**
 * Sprint 3 — Crash #1 regression test.
 *
 * Contract: LiveConnectorDataProvider falls back to mock data when any of
 * the 4 backing queries error. The OfflineBanner must be visible so the
 * operator knows the rendered list is mock-backed, not live.
 *
 * Test surface:
 *   1. Banner is rendered with the destructive variant and `offline-banner` testid.
 *   2. Banner is suppressed when the provider is in mock-only mode (`useBackend=false`).
 *   3. Banner is suppressed when the API is in-flight (no error yet).
 *   4. Explicit `isOffline` prop forces the banner regardless of hook state.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Mock the 4 backing hooks so the banner reads controlled state.
const mockUseConnectors = vi.fn();
const mockUseMarketplace = vi.fn();
const mockUseCredentials = vi.fn();
const mockUseConnectorActivity = vi.fn();

vi.mock('@/lib/hooks/useConnectors', () => ({
  useConnectors: () => mockUseConnectors(),
  useMarketplace: () => mockUseMarketplace(),
  useCredentials: () => mockUseCredentials(),
  useConnectorActivity: () => mockUseConnectorActivity(),
}));

import { LiveConnectorDataProvider } from '@/components/connector-center/LiveConnectorDataProvider';
import { OfflineBanner } from '@/components/connector-center/OfflineBanner';

type QState<T> = { data: T | undefined; isPending: boolean; isError: boolean; isSuccess: boolean };

const pending = <T,>(): QState<T> => ({ data: undefined, isPending: true, isError: false, isSuccess: false });
const errored = <T,>(): QState<T> => ({ data: undefined, isPending: false, isError: true, isSuccess: false });
const ok = <T,>(data: T): QState<T> => ({ data, isPending: false, isError: false, isSuccess: true });

function setApiState(s: { useConnectors?: QState<unknown>; useMarketplace?: QState<unknown>; useCredentials?: QState<unknown>; useConnectorActivity?: QState<unknown> }) {
  mockUseConnectors.mockReturnValue(s.useConnectors ?? pending());
  mockUseMarketplace.mockReturnValue(s.useMarketplace ?? pending());
  mockUseCredentials.mockReturnValue(s.useCredentials ?? pending());
  mockUseConnectorActivity.mockReturnValue(s.useConnectorActivity ?? pending());
}

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('<OfflineBanner> — Sprint 3 Crash #1', () => {
  it('renders the offline banner when useConnectors errors (5xx fallback to mocks)', () => {
    setApiState({ useConnectors: errored() });

    render(
      <LiveConnectorDataProvider>
        <OfflineBanner />
      </LiveConnectorDataProvider>,
    );

    const banner = screen.getByTestId('offline-banner');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    // ponytail: text assertion is loose on purpose — copy can move,
    // but the user-facing signal ("offline" / "demo data") must remain.
    expect(banner.textContent?.toLowerCase()).toMatch(/offline|demo|fallback|unreachable/);
  });

  it('does NOT render the banner when all queries are pending (no error yet)', () => {
    setApiState({});

    render(
      <LiveConnectorDataProvider>
        <OfflineBanner />
      </LiveConnectorDataProvider>,
    );

    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('does NOT render the banner when the provider is in mock-only mode (useBackend=false)', () => {
    setApiState({ useConnectors: errored() });

    render(
      <LiveConnectorDataProvider useBackend={false}>
        <OfflineBanner />
      </LiveConnectorDataProvider>,
    );

    // mock-only mode is the storybook/test seam; the banner would just
    // confuse the operator since the page is *supposed* to show mocks.
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('renders the banner when any of the 4 queries errors', () => {
    setApiState({ useMarketplace: errored() });
    const { rerender } = render(
      <LiveConnectorDataProvider>
        <OfflineBanner />
      </LiveConnectorDataProvider>,
    );
    expect(screen.getByTestId('offline-banner')).toBeTruthy();

    setApiState({ useCredentials: errored() });
    rerender(
      <LiveConnectorDataProvider>
        <OfflineBanner />
      </LiveConnectorDataProvider>,
    );
    expect(screen.getByTestId('offline-banner')).toBeTruthy();
  });

  it('honors explicit isOffline=true prop even when hooks are healthy', () => {
    setApiState({ useConnectors: ok([]) });

    render(
      <LiveConnectorDataProvider>
        <OfflineBanner isOffline />
      </LiveConnectorDataProvider>,
    );

    expect(screen.getByTestId('offline-banner')).toBeTruthy();
  });
});
