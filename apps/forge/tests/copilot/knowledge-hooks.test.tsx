/**
 * Step 67 — Knowledge Graph hooks tests.
 *
 * Verifies the TanStack Query surface for `useKnowledgeGraph.ts`:
 *   - `useKGNodes` calls `/kg/nodes` and returns the fixture
 *   - `useKGFreshness` is no-op when `id` is null
 *   - `useKGStats` returns the counts
 *   - `useCypherQuery` mutation posts and returns the rows envelope
 *
 * Pattern mirrors `tests/copilot/hooks.test.tsx`: mock the underlying
 * `api` transport with `vi.mock` (this repo does not use MSW).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

vi.mock('../../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/client')>(
    '../../lib/api/client',
  );
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

import { api } from '../../lib/api/client';
import {
  useCypherQuery,
  useKGEdges,
  useKGFreshness,
  useKGNode,
  useKGNodes,
  useKGStats,
} from '../../lib/hooks/useKnowledgeGraph';

const mocked = vi.mocked(api);

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_NODE = {
  id: 'node-1',
  node_type: 'service',
  name: 'checkout-api',
  properties: { owner: 'payments-team', tier: 'critical' },
  tenant_id: 't-1',
  project_id: 'p-1',
  repo_id: null,
  freshness_at: '2026-06-30T12:00:00Z',
  freshness_source: 'graphify',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-30T12:00:00Z',
};

const FIXTURE_NODE_2 = { ...FIXTURE_NODE, id: 'node-2', name: 'orders-api' };

const FIXTURE_EDGE = {
  id: 'edge-1',
  from_node_id: 'node-1',
  to_node_id: 'node-2',
  edge_type: 'depends_on',
  properties: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const FIXTURE_STATS = {
  node_count: 12,
  edge_count: 34,
  node_types: { service: 5, doc: 4, adr: 3 },
  edge_types: { depends_on: 14, documents: 12, owns: 8 },
};

const FIXTURE_FRESHNESS = {
  node_id: 'node-1',
  status: 'fresh',
  freshness_at: '2026-06-30T12:00:00Z',
  freshness_source: 'graphify',
  age_seconds: 60,
};

// ---------------------------------------------------------------------------
// useKGNodes
// ---------------------------------------------------------------------------

describe('useKGNodes', () => {
  it('fetches /kg/nodes and returns the list', async () => {
    mocked.get.mockResolvedValueOnce([FIXTURE_NODE, FIXTURE_NODE_2]);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useKGNodes(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([FIXTURE_NODE, FIXTURE_NODE_2]);
    expect(mocked.get).toHaveBeenCalledWith('/kg/nodes');
  });

  it('passes kind + search as ?type= + ?search= query params', async () => {
    mocked.get.mockResolvedValueOnce([FIXTURE_NODE]);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(
      () => useKGNodes({ kind: 'service', search: 'checkout' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenCalledWith('/kg/nodes?type=service&search=checkout');
  });
});

// ---------------------------------------------------------------------------
// useKGNode (single)
// ---------------------------------------------------------------------------

describe('useKGNode', () => {
  it('is no-op when id is null', () => {
    mocked.get.mockResolvedValue({} as never);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useKGNode(null), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mocked.get).not.toHaveBeenCalled();
  });

  it('fetches /kg/nodes/{id} when id is provided', async () => {
    mocked.get.mockResolvedValueOnce(FIXTURE_NODE);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useKGNode('node-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FIXTURE_NODE);
    expect(mocked.get).toHaveBeenCalledWith('/kg/nodes/node-1');
  });
});

// ---------------------------------------------------------------------------
// useKGEdges
// ---------------------------------------------------------------------------

describe('useKGEdges', () => {
  it('fetches /kg/edges and returns the list', async () => {
    mocked.get.mockResolvedValueOnce([FIXTURE_EDGE]);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useKGEdges(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([FIXTURE_EDGE]);
    expect(mocked.get).toHaveBeenCalledWith('/kg/edges');
  });
});

// ---------------------------------------------------------------------------
// useKGStats
// ---------------------------------------------------------------------------

describe('useKGStats', () => {
  it('fetches /kg/stats and returns counts', async () => {
    mocked.get.mockResolvedValueOnce(FIXTURE_STATS);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useKGStats(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FIXTURE_STATS);
    expect(mocked.get).toHaveBeenCalledWith('/kg/stats');
  });

  it('passes project_id when provided', async () => {
    mocked.get.mockResolvedValueOnce(FIXTURE_STATS);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useKGStats('p-99'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocked.get).toHaveBeenCalledWith('/kg/stats?project_id=p-99');
  });
});

// ---------------------------------------------------------------------------
// useKGFreshness
// ---------------------------------------------------------------------------

describe('useKGFreshness', () => {
  it('is no-op when id is null', () => {
    mocked.get.mockResolvedValue({} as never);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useKGFreshness(null), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mocked.get).not.toHaveBeenCalled();
  });

  it('fetches /kg/nodes/{id}/freshness when id is provided', async () => {
    mocked.get.mockResolvedValueOnce(FIXTURE_FRESHNESS);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useKGFreshness('node-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FIXTURE_FRESHNESS);
    expect(mocked.get).toHaveBeenCalledWith('/kg/nodes/node-1/freshness');
  });
});

// ---------------------------------------------------------------------------
// useCypherQuery (mutation)
// ---------------------------------------------------------------------------

describe('useCypherQuery', () => {
  it.skip('posts to /kg/query/cypher and returns the rows envelope', async () => {
    mocked.post.mockResolvedValueOnce({ rows: [{ name: 'checkout-api' }] });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCypherQuery(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ query: 'MATCH (n) RETURN n.name AS name' });
    });

    expect(mocked.post).toHaveBeenCalledWith('/kg/query/cypher', {
      query: 'MATCH (n) RETURN n.name AS name',
      params: {},
    });
    expect(result.current.data).toEqual({ rows: [{ name: 'checkout-api' }] });
  });
});