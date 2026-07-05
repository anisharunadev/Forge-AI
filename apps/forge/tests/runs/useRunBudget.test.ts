/**
 * M6-G2 — useRunBudget hook tests (2 cases).
 *
 *   (a) test_use_run_budget_returns_budget_shape — the hook queries
 *       /api/v1/runs/{runId}/budget and surfaces the RunBudget shape
 *       returned by the fetcher.
 *   (b) test_use_run_budget_invalidates_on_cost_updated — when the
 *       'run.cost.updated' WS frame arrives with the matching run_id,
 *       the hook invalidates its query so the next fetch pulls a
 *       fresh budget.
 *
 * Pattern mirrors `apps/forge/tests/copilot/hooks.test.tsx` — module
 * mocks of `lib/runs/data.ts` + `lib/useRealtime.ts` so each test can
 * pin the fetcher return value and the WS handler it wants to fire.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Module mocks — getRunBudget is replaced with a vi.fn() so each test
// can pin its return value. useRealtime is mocked so we can capture the
// subscribe() callback and invoke it from the test body (no real WS).
// ---------------------------------------------------------------------------

const mockGetRunBudget = vi.fn();

vi.mock('@/lib/runs/data', async () => {
  const actual = await vi.importActual<typeof import('@/lib/runs/data')>(
    '@/lib/runs/data',
  );
  return {
    ...actual,
    getRunBudget: (...args: unknown[]) =>
      (mockGetRunBudget as (...args: unknown[]) => unknown)(...args),
  };
});

type Handler = (frame: { topic: string; envelope: unknown }) => void;
const realtimeHandlers: Map<string, Set<Handler>> = new Map();

vi.mock('@/lib/useRealtime', () => ({
  useRealtime: () => ({
    status: 'open' as const,
    subscribe: (topic: string, handler: Handler) => {
      let set = realtimeHandlers.get(topic);
      if (!set) {
        set = new Set();
        realtimeHandlers.set(topic, set);
      }
      set.add(handler);
      return () => {
        realtimeHandlers.get(topic)?.delete(handler);
      };
    },
    unsubscribe: (topic: string, handler: Handler) => {
      realtimeHandlers.get(topic)?.delete(handler);
    },
  }),
}));

// Imports AFTER mocks so they pick up the stubbed modules.
import { useRunBudget } from '@/lib/hooks/useRuns';
import type { RunBudget } from '@/lib/runs/data';

// ---------------------------------------------------------------------------
// Wrapper helper — fresh QueryClient per test so cached state never leaks.
// ---------------------------------------------------------------------------

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  return { wrapper, queryClient };
}

// ---------------------------------------------------------------------------
// Fixture — a representative RunBudget shape matching the type declared
// in `lib/runs/data.ts`.
// ---------------------------------------------------------------------------

const BUDGET_FIXTURE: RunBudget = {
  run_id: 'r-budget-1',
  ceiling_usd: 50,
  spent_usd: 12.34,
  remaining_usd: 37.66,
  headroom_pct: 75.32,
  status: 'active',
  frozen_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  realtimeHandlers.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  realtimeHandlers.clear();
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('useRunBudget', () => {
  it('case (a): test_use_run_budget_returns_budget_shape — fetcher shape surfaces', async () => {
    mockGetRunBudget.mockResolvedValueOnce(BUDGET_FIXTURE);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useRunBudget('r-budget-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetRunBudget).toHaveBeenCalledTimes(1);
    expect(mockGetRunBudget).toHaveBeenCalledWith('r-budget-1');

    // The hook surfaces the full RunBudget shape — every typed field
    // is exposed (ceiling, spent, remaining, headroom, status).
    expect(result.current.data).toEqual(BUDGET_FIXTURE);
    expect(result.current.data?.ceiling_usd).toBe(50);
    expect(result.current.data?.spent_usd).toBe(12.34);
    expect(result.current.data?.remaining_usd).toBe(37.66);
    expect(result.current.data?.status).toBe('active');
  });

  it('case (b): test_use_run_budget_invalidates_on_cost_updated — WS frame triggers refetch', async () => {
    // First call returns the initial budget; second call (after the
    // WS invalidation fires) returns an updated value with a higher
    // spent_usd so we can prove the invalidation actually re-ran the
    // fetcher instead of recycling the cache.
    mockGetRunBudget
      .mockResolvedValueOnce(BUDGET_FIXTURE)
      .mockResolvedValueOnce({
        ...BUDGET_FIXTURE,
        spent_usd: 41.5,
        remaining_usd: 8.5,
        headroom_pct: 17.0,
      });
    const { wrapper, queryClient } = makeWrapper();

    const { result } = renderHook(() => useRunBudget('r-budget-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.spent_usd).toBe(12.34);

    // Locate the registered handler for run.cost.updated and dispatch a
    // matching frame. The hook's useEffect must subscribe via the
    // mocked useRealtime.subscribe seam.
    const handlers = realtimeHandlers.get('run.cost.updated');
    expect(handlers).toBeDefined();
    expect(handlers?.size).toBe(1);

    await act(async () => {
      handlers!.forEach((h) =>
        h({
          topic: 'run.cost.updated',
          envelope: { run_id: 'r-budget-1', spent_usd: 41.5 },
        }),
      );
      // Let the invalidate + refetch microtasks drain.
      await Promise.resolve();
      await Promise.resolve();
    });

    // The query cache should have been invalidated; the next render
    // will pull the second fixture value.
    await waitFor(() => expect(result.current.data?.spent_usd).toBe(41.5));
    expect(mockGetRunBudget).toHaveBeenCalledTimes(2);

    // Foreign-run frames must NOT invalidate this hook's query.
    await act(async () => {
      handlers!.forEach((h) =>
        h({
          topic: 'run.cost.updated',
          envelope: { run_id: 'r-OTHER', spent_usd: 99 },
        }),
      );
      await Promise.resolve();
    });
    // Still 2 — the foreign frame was ignored.
    expect(mockGetRunBudget).toHaveBeenCalledTimes(2);

    // Sanity — queryClient still has only one cached budget entry for
    // the canonical runId.
    const cached = queryClient.getQueryData(['runs', 'budget', 'r-budget-1']);
    expect(cached).toBeDefined();
  });
});