/**
 * M6-G1 — useReplayRun hook tests (2 cases).
 *
 *   (a) test_use_replay_run_success_navigates — a successful POST to
 *       /api/v1/runs/{runId}/replay causes toast.success + a
 *       router.push('/runs/{newId}').
 *   (b) test_use_replay_run_failure_toasts_error — when the fetcher
 *       rejects, the mutation surfaces toast.error with the error
 *       message and does NOT navigate.
 *
 * Pattern mirrors `apps/forge/tests/copilot/hooks.test.tsx`:
 *   - module-mock `lib/runs/data.ts` so `replayRun` is a vi.fn().
 *   - module-mock `next/navigation` so `useRouter` is a vi.fn() whose
 *     `.push` is a vi.fn() we can spy on.
 *   - module-mock `sonner` so we can assert toast.success / toast.error.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockReplayRun = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockRouterPush = vi.fn();

vi.mock('@/lib/runs/data', async () => {
  const actual = await vi.importActual<typeof import('@/lib/runs/data')>(
    '@/lib/runs/data',
  );
  return {
    ...actual,
    replayRun: (...args: unknown[]) =>
      (mockReplayRun as (...args: unknown[]) => unknown)(...args),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
  Toaster: () => null,
}));

// Imports AFTER mocks so they pick up the stubbed modules.
import { useReplayRun } from '@/lib/hooks/useRuns';
import type { RunRecord } from '@/lib/api';

// ---------------------------------------------------------------------------
// Wrapper helper
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
// Fixtures
// ---------------------------------------------------------------------------

const SOURCE_RUN: RunRecord = {
  id: 'r-source',
  tenant_id: '11111111-1111-1111-1111-111111111111',
  goal_id: 'goal-source',
  project_id: 'p-1',
  status: 'aborted',
  current_stage: 'qa',
  cost_spent_usd: '7.50',
  cost_ceiling_usd: '50.00',
  triggered_by: { type: 'manual', actor: 'u-1' },
  started_at: '2026-07-01T10:00:00Z',
  finished_at: '2026-07-01T10:05:00Z',
  deleted_at: null,
  archived_at: null,
};

const NEW_RUN: RunRecord = {
  ...SOURCE_RUN,
  id: 'r-new',
  status: 'created',
  current_stage: 'ideation',
  cost_spent_usd: '0',
  finished_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('useReplayRun', () => {
  it('case (a): test_use_replay_run_success_navigates — toast + router.push on success', async () => {
    mockReplayRun.mockResolvedValueOnce({
      run: NEW_RUN,
      source_run_id: SOURCE_RUN.id,
    });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useReplayRun(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('r-source');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Fetcher called once with the source id.
    expect(mockReplayRun).toHaveBeenCalledTimes(1);
    expect(mockReplayRun).toHaveBeenCalledWith('r-source');

    // Success toast.
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Run replayed',
      expect.objectContaining({
        description: expect.stringContaining('r-new') as string,
      }),
    );

    // Router navigates to the NEW run's detail page.
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith('/runs/r-new');

    // No error toast on success.
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('case (b): test_use_replay_run_failure_toasts_error — error surfaces, no navigation', async () => {
    mockReplayRun.mockRejectedValueOnce(
      Object.assign(new Error('cost_cap_exceeded: source run is over budget'), {
        name: 'ApiError',
      }),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useReplayRun(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync('r-source');
      } catch {
        // expected — the hook swallows the throw into the mutation error
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Error toast with the orchestrator message.
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      'Replay failed',
      expect.objectContaining({
        description: expect.stringContaining('cost_cap_exceeded') as string,
      }),
    );

    // NO navigation on failure.
    expect(mockRouterPush).not.toHaveBeenCalled();
    // NO success toast.
    expect(mockToastSuccess).not.toHaveBeenCalled();

    // Fetcher was still called once.
    expect(mockReplayRun).toHaveBeenCalledTimes(1);
  });
});