/**
 * Step 69 — TanStack Query hook tests for the new ideation hooks
 * (`lib/api/ideation-hooks.ts`).
 *
 * Focuses on the **non-obvious** request shapes — query-param
 * semantics for `compare_impact` and `score/batch`. Mounts hooks
 * inside a QueryClientProvider so mutation invalidation runs
 * end-to-end.
 *
 * Fetch is mocked via `vi.spyOn(globalThis, 'fetch')` — same pattern
 * as `tests/intelligence/ideation-push-jira.test.tsx`.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { act, render } from '@testing-library/react';

import {
  useCompareImpact,
  useScoreBatch,
  useRoadmap,
  useRunPipeline,
} from '@/lib/api/ideation-hooks';
import { queryKeys } from '@/lib/api/ideation';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('useCompareImpact (query-param shape)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ entries: [] }));
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('serialises ideaIds as repeated idea_ids query params, NOT a JSON body', async () => {
    let lastUrl = '';
    fetchSpy.mockImplementation(async (input) => {
      lastUrl = String(input);
      return jsonResponse({ entries: [] });
    });

    function Probe() {
      const mutate = useCompareImpact();
      React.useEffect(() => {
        void mutate.mutateAsync({ ideaIds: ['a', 'b', 'c'] });
      }, [mutate]);
      return null;
    }

    renderWithClient(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(lastUrl).toContain('/ideation/ideas/impact/compare');
    expect(lastUrl).toContain('idea_ids=a');
    expect(lastUrl).toContain('idea_ids=b');
    expect(lastUrl).toContain('idea_ids=c');
    // The body must be empty (or undefined) — backend expects query params.
    const [, init] = fetchSpy.mock.calls.at(-1) ?? [];
    const body = (init as RequestInit | undefined)?.body;
    expect(body === undefined || body === null || body === '').toBe(true);
  });
});

describe('useScoreBatch (query-param shape + strategy default)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse([]));
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('defaults strategy to "ai" and serialises idea_ids as repeated params', async () => {
    let lastUrl = '';
    fetchSpy.mockImplementation(async (input) => {
      lastUrl = String(input);
      return jsonResponse([]);
    });

    function Probe() {
      const mutate = useScoreBatch();
      React.useEffect(() => {
        void mutate.mutateAsync({ ideaIds: ['x', 'y'] });
      }, [mutate]);
      return null;
    }

    renderWithClient(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(lastUrl).toContain('/ideation/ideas/score/batch');
    expect(lastUrl).toContain('idea_ids=x');
    expect(lastUrl).toContain('idea_ids=y');
    expect(lastUrl).toContain('strategy=ai');
  });
});

describe('useRoadmap (enabled gate)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({
          id: 'rm-1',
          name: 'Q3',
          horizon: 'NOW',
          theme: 'g',
          status: 'DRAFT',
          items: [],
          generated_by: 'u',
          approved_by: null,
          tenant_id: 't',
          project_id: 'p',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
      );
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('does NOT fetch when id is null', async () => {
    function Probe() {
      useRoadmap(null);
      return null;
    }
    renderWithClient(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches when id is provided', async () => {
    function Probe() {
      useRoadmap('rm-1');
      return null;
    }
    renderWithClient(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      '/ideation/roadmaps/rm-1',
    );
  });
});

describe('useRunPipeline (invalidation)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        session_id: 'sess-1',
        idea_id: 'idea-1',
        status: 'running',
        steps: [],
      }),
    );
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('hits /ideation/workflows/ideas/{id}/start (NOT /workflows/run)', async () => {
    let lastUrl = '';
    fetchSpy.mockImplementation(async (input) => {
      lastUrl = String(input);
      return jsonResponse({
        session_id: 'sess-1',
        idea_id: 'idea-1',
        status: 'running',
        steps: [],
      });
    });

    let qc: ReturnType<typeof useQueryClient> | null = null;
    function Probe() {
      qc = useQueryClient();
      const mutate = useRunPipeline();
      // Seed the ideas cache so we can prove the invalidation hits it.
      React.useEffect(() => {
        qc?.setQueryData(queryKeys.ideation.ideas(), {
          items: [],
          total: 0,
        });
        void mutate.mutateAsync({ idea_id: 'idea-42' });
      }, [mutate, qc]);
      return null;
    }

    renderWithClient(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(lastUrl).toContain('/ideation/workflows/ideas/idea-42/start');
    expect(lastUrl).not.toContain('/workflows/run');
    // The ideas query was invalidated → the cache is wiped.
    expect(qc?.getQueryData(queryKeys.ideation.ideas())).toBeUndefined();
  });
});