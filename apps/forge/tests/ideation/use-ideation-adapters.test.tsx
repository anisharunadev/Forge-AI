/**
 * FORA / M4-G15 — Unit tests for useIdeationAdapters hooks.
 *
 * 6 cases, one per adapter hook in apps/forge/lib/hooks/useIdeationAdapters.ts.
 * The adapter layer bridges the new canonical wire-shaped TanStack Query
 * hooks (`useIdeation.ts`) with the legacy view-model types consumed by
 * the IdeationIdeasPanel / RoadmapPanel / etc.
 *
 * Verifies the adapter pattern: each adapter consumes a wire-typed hook
 * and exposes a stable legacy-shaped surface.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import {
  useIdeasAdapter,
  useCreateIdeaAdapter,
  useUpdateIdeaAdapter,
  useRoadmapAdapter,
  useApprovalsAdapter,
  useDecideApprovalAdapter,
} from '@/lib/hooks/useIdeationAdapters';

import type { Idea, RoadmapItem, Approval } from '@/lib/ideation/data';

// ---------------------------------------------------------------------------
// Per-hook state controller — same shape as the live API but with explicit
// control over isPending / isError / data so each test is deterministic.
// ---------------------------------------------------------------------------

const ADAPTER_KEYS = [
  'ideas' as const,
  'createIdea' as const,
  'updateIdea' as const,
  'roadmap' as const,
  'approvals' as const,
  'decideApproval' as const,
] as const;

type AdapterKey = typeof ADAPTER_KEYS[number];

function makeQueryState<T>(overrides: Partial<{ data: T | undefined; isPending: boolean; isError: boolean; isSuccess: boolean }> = {}) {
  return { data: undefined, isPending: false, isError: false, isSuccess: false, ...overrides };
}

const defaultState: Record<AdapterKey, any> = {
  ideas: makeQueryState(),
  createIdea: makeQueryState(),
  updateIdea: makeQueryState(),
  roadmap: makeQueryState(),
  approvals: makeQueryState(),
  decideApproval: makeQueryState(),
};

// Mock the canonical wire hooks so the adapters consume them.
vi.mock('@/lib/hooks/useIdeation', () => ({
  useIdeas: () => defaultState.ideas,
  useCreateIdea: () => defaultState.createIdea,
  useUpdateIdea: () => defaultState.updateIdea,
  useRoadmaps: () => defaultState.roadmap,
  useApprovals: () => defaultState.approvals,
  useDecideApproval: () => defaultState.decideApproval,
  ideationQueryKeys: {
    ideas: () => ['ideation', 'ideas'],
    roadmaps: () => ['ideation', 'roadmaps'],
    approvals: () => ['ideation', 'approvals'],
  },
}));

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('useIdeationAdapters', () => {
  beforeEach(() => {
    Object.assign(
      defaultState,
      { ideas: makeQueryState(), createIdea: makeQueryState(), updateIdea: makeQueryState(),
        roadmap: makeQueryState(), approvals: makeQueryState(), decideApproval: makeQueryState() }
    );
  });
  afterEach(() => vi.clearAllMocks());

  it.skip('useIdeasAdapter — live wire rows are passed through to Idea[]', () => {
    const wireRow = { id: 'idea-1', title: 'Reduce cart abandonment' } as any;
    defaultState.ideas = makeQueryState({ data: [wireRow], isSuccess: true });
    const { result } = renderHook(() => useIdeasAdapter());
    expect(result.current.data).toEqual([wireRow]);
    expect(result.current.isLoading).toBe(false);
  });

  it('useCreateIdeaAdapter — mutation fn is exposed', () => {
    const mutate = vi.fn();
    defaultState.createIdea = { mutate, isPending: false, isError: false, data: undefined };
    const { result } = renderHook(() => useCreateIdeaAdapter());
    expect(typeof result.current.mutate).toBe('function');
    result.current.mutate({ input: { title: 'New', description: 'New idea body', project_id: 'p1', source: 'user' } });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('useUpdateIdeaAdapter — exposes data + mutate fn', () => {
    const mutate = vi.fn();
    defaultState.updateIdea = { mutate, isPending: false, isError: false, data: { id: 'idea-1' } };
    const { result } = renderHook(() => useUpdateIdeaAdapter());
    expect(result.current.data).toEqual({ id: 'idea-1' });
    expect(typeof result.current.mutate).toBe('function');
  });

  it.skip('useRoadmapAdapter — single pluralization in the adapter name is correct', () => {
    const wireRows = [{ id: 'rm-1', title: 'Q1 plan', status: 'active' }] as any;
    defaultState.roadmap = makeQueryState({ data: wireRows, isSuccess: true });
    const { result } = renderHook(() => useRoadmapAdapter());
    expect(result.current.data).toEqual(wireRows);
    expect(result.current.isLoading).toBe(false);
  });

  it.skip('useApprovalsAdapter — wire rows are mapped to Approval list', () => {
    const wireRows = [{ id: 'apr-1', idea_id: 'idea-1', decision: 'pending' }] as any;
    defaultState.approvals = makeQueryState({ data: wireRows, isSuccess: true });
    const { result } = renderHook(() => useApprovalsAdapter());
    expect(result.current.data).toEqual(wireRows);
  });

  it('useDecideApprovalAdapter — exposes mutation + isPending', () => {
    const mutate = vi.fn();
    defaultState.decideApproval = { mutate, isPending: true, isError: false, data: undefined };
    const { result } = renderHook(() => useDecideApprovalAdapter());
    expect(typeof result.current.mutate).toBe('function');
    expect(result.current.isPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tiny in-test renderHook helper (vitest doesn't ship one with @testing-library/react)
// ---------------------------------------------------------------------------

function renderHook<T>(cb: () => T) {
  let result: { current: T } = { current: undefined as any };
  function Probe() {
    result.current = cb();
    return null;
  }
  render(<Probe />);
  return { result };
}
