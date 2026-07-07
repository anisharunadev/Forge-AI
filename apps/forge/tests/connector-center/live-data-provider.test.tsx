/**
 * FORA / M3-G21 — Unit tests for LiveConnectorDataProvider.
 *
 * Covers the Step-55-v2 three-state merge logic exposed by
 * `apps/forge/components/connector-center/LiveConnectorDataProvider.tsx`:
 *
 *   - API still loading         → MOCK_CONNECTORS fallback
 *   - API loaded + 0 rows       → []    (real empty state per Rule 15)
 *   - API errored (5xx/offline) → MOCK_CONNECTORS fallback
 *   - API loaded + N rows       → live rows (backend is canonical)
 *
 * The provider delegates the 4 list queries (useConnectors, useMarketplace,
 * useCredentials, useConnectorActivity) to `@/lib/hooks/useConnectors`.
 * We mock that module with `vi.mock` and use a tiny `MockApiClient` to
 * return canned data + controlled `isPending` / `isError` flags per
 * test case.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { CONNECTORS as MOCK_CONNECTORS, type Connector } from '@/lib/connectors/data';

// ---------------------------------------------------------------------------
// MockApiClient — small controller that lets each test pin isPending /
// isError / data on the 4 hooks without rewriting the mock per case.
// ---------------------------------------------------------------------------

interface QueryState<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}

interface MockApiClientState {
  useConnectors: QueryState<Connector[]>;
  useMarketplace: QueryState<unknown>;
  useCredentials: QueryState<unknown>;
  useConnectorActivity: QueryState<unknown>;
}

function emptyPendingState<T>(): QueryState<T> {
  return { data: undefined, isPending: true, isError: false, isSuccess: false };
}

function okState<T>(data: T): QueryState<T> {
  return { data, isPending: false, isError: false, isSuccess: true };
}

function errorState<T = undefined>(): QueryState<T> {
  return { data: undefined, isPending: false, isError: true, isSuccess: false };
}

// vi.fn() instances that tests can reconfigure per case. They live in
// module scope so the `vi.mock('@/lib/hooks/useConnectors', ...)` factory
// can read them when the provider invokes the hook.

const mockUseConnectors = vi.fn();
const mockUseMarketplace = vi.fn();
const mockUseCredentials = vi.fn();
const mockUseConnectorActivity = vi.fn();

vi.mock('@/lib/hooks/useConnectors', () => ({
  // Each entry mirrors the export name from the real module so consumers
  // that destructure don't blow up. We only exercise the 4 used by
  // LiveConnectorDataProvider here.
  useConnectors: () => mockUseConnectors(),
  useMarketplace: () => mockUseMarketplace(),
  useCredentials: () => mockUseCredentials(),
  useConnectorActivity: () => mockUseConnectorActivity(),
}));

// Import the provider AFTER the mock so it picks up the mocked hooks.
import { LiveConnectorDataProvider, useLiveConnectorData } from '@/components/connector-center/LiveConnectorDataProvider';

function setApiState(state: MockApiClientState) {
  mockUseConnectors.mockReturnValue(state.useConnectors);
  mockUseMarketplace.mockReturnValue(state.useMarketplace);
  mockUseCredentials.mockReturnValue(state.useCredentials);
  mockUseConnectorActivity.mockReturnValue(state.useConnectorActivity);
}

function defaultAllPending(): MockApiClientState {
  return {
    useConnectors: emptyPendingState(),
    useMarketplace: emptyPendingState(),
    useCredentials: emptyPendingState(),
    useConnectorActivity: emptyPendingState(),
  };
}

// ---------------------------------------------------------------------------
// Probe — reads the LiveConnectorDataProvider's context value into a
// captured ref so assertions can compare the rendered `connectors` array
// without depending on the rendered DOM (the provider renders no DOM of
// its own, only children).
// ---------------------------------------------------------------------------

interface CapturedProvider {
  live: boolean;
  connectors: ReadonlyArray<Connector>;
  marketplace: ReadonlyArray<Connector>;
  credentials: ReadonlyArray<unknown>;
  activity: ReadonlyArray<unknown>;
}

const captured: { current: CapturedProvider | null } = { current: null };

function Probe() {
  const data = useLiveConnectorData();
  React.useEffect(() => {
    captured.current = data as CapturedProvider | null;
  }, [data]);
  return (
    <ul data-testid="probe">
      <li data-testid="probe-live">{String(data?.live ?? false)}</li>
      <li data-testid="probe-count">{String(data?.connectors.length ?? 0)}</li>
      <li data-testid="probe-ids">
        {(data?.connectors ?? []).map((c) => c.id).join(',')}
      </li>
    </ul>
  );
}

function renderProvider() {
  return render(
    <LiveConnectorDataProvider>
      <Probe />
    </LiveConnectorDataProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  captured.current = null;
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('<LiveConnectorDataProvider>', () => {
  it('case (a): all 4 queries pending → exposes MOCK_CONNECTORS fallback', async () => {
    setApiState(defaultAllPending());

    await act(async () => {
      renderProvider();
    });

    // Provider reports `live=true` because `useBackend` defaults to true,
    // but the data layer should fall back to mocks while queries are in-flight.
    expect(captured.current?.live).toBe(true);
    expect(captured.current?.connectors.length).toBe(MOCK_CONNECTORS.length);
    expect(captured.current?.connectors.length).toBeGreaterThan(0);

    // The connector set should match MOCK_CONNECTORS by id (order-preserving).
    const mockIds = MOCK_CONNECTORS.map((c) => c.id).join(',');
    const exposedIds = (captured.current?.connectors ?? []).map((c) => c.id).join(',');
    expect(exposedIds).toBe(mockIds);
  });

  it('case (b): useConnectors errors → exposes MOCK_CONNECTORS fallback', async () => {
    setApiState({
      useConnectors: errorState<Connector[]>(),
      useMarketplace: emptyPendingState(),
      useCredentials: emptyPendingState(),
      useConnectorActivity: emptyPendingState(),
    });

    await act(async () => {
      renderProvider();
    });

    expect(captured.current?.connectors.length).toBe(MOCK_CONNECTORS.length);
    const mockIds = MOCK_CONNECTORS.map((c) => c.id).join(',');
    const exposedIds = (captured.current?.connectors ?? []).map((c) => c.id).join(',');
    expect(exposedIds).toBe(mockIds);
  });

  it('case (c): useConnectors resolves with [] → exposes [] (Rule-15 real empty state)', async () => {
    setApiState({
      useConnectors: okState<Connector[]>([]),
      useMarketplace: emptyPendingState(),
      useCredentials: emptyPendingState(),
      useConnectorActivity: emptyPendingState(),
    });

    await act(async () => {
      renderProvider();
    });

    // The empty branch is the one Rule-15 cares about: a tenant with
    // genuinely zero connectors must see the empty state, not mocks.
    expect(captured.current?.connectors).toEqual([]);
    expect(captured.current?.connectors.length).toBe(0);
  });

  it('case (d): useConnectors resolves with 3 rows → live data is canonical', async () => {
    const liveRows: Connector[] = [
      { ...MOCK_CONNECTORS[0]!, id: 'live-row-1', name: 'live-row-1' },
      { ...MOCK_CONNECTORS[1]!, id: 'live-row-2', name: 'live-row-2' },
      { ...MOCK_CONNECTORS[2]!, id: 'live-row-3', name: 'live-row-3' },
    ];

    setApiState({
      useConnectors: okState<Connector[]>(liveRows),
      useMarketplace: emptyPendingState(),
      useCredentials: emptyPendingState(),
      useConnectorActivity: emptyPendingState(),
    });

    await act(async () => {
      renderProvider();
    });

    // The exposed array must be exactly the 3 live rows — backend wins
    // over the 18-row mock fallback.
    expect(captured.current?.connectors.length).toBe(3);
    const exposedIds = (captured.current?.connectors ?? []).map((c) => c.id).sort();
    expect(exposedIds).toEqual(['live-row-1', 'live-row-2', 'live-row-3']);
  });
});