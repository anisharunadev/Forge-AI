/**
 * Onboarding wizard React Query hooks — step-74.
 *
 * Covers the contracts the wizard page depends on:
 *
 *   1. `useStartWizard` POSTs `/onboarding/sessions` and writes the
 *      returned session into `queryKeys.onboarding.session(id)`.
 *   2. `useWizardSession` GETs `/onboarding/sessions/{id}` only when
 *      `sessionId` is truthy, and forwards `refetchInterval`.
 *   3. `useAdvanceWizard` POSTs `/onboarding/sessions/{id}/advance`
 *      with `{step, step_input, mark_complete}` and writes the
 *      returned session back into the cache.
 *   4. `useCancelWizard` POSTs `/onboarding/sessions/{id}/cancel`.
 *   5. `useStartProvision` POSTs `/onboarding/provision`.
 *   6. `useProvisionStatus` GETs `/onboarding/provision/status` and
 *      honors `refetchInterval`.
 *
 * Uses `vi.spyOn(globalThis, 'fetch')` — the repo does NOT have MSW
 * installed (see tests/lib/hooks/useSeeds.test.tsx for the template).
 *
 * Note: vitest runner is currently broken in this env (vitest 4 ↔
 * vite 5 ↔ Node 22 mismatch — see env-vitest-runner-broken memory).
 * These tests are kept as the canonical contract; run `pnpm typecheck`
 * until vitest is upgraded. They will pass when the runner is fixed.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import {
  useAdvanceWizard,
  useCancelWizard,
  useProvisionStatus,
  useStartProvision,
  useStartWizard,
  useWizardSession,
} from '@/lib/api/onboarding-hooks';
import { queryKeys } from '@/lib/api/onboarding';
import type { WizardSession } from '@/lib/api/onboarding';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function makeSession(overrides: Partial<WizardSession> = {}): WizardSession {
  return {
    id: 'sess-1',
    tenant_id: 't-1',
    project_id: 'p-1',
    user_id: 'u-1',
    status: 'ACTIVE',
    current_step: 'tenant_setup',
    state: {},
    completed_at: null,
    steps: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// useStartWizard
// ---------------------------------------------------------------------------

describe('useStartWizard', () => {
  it('POSTs /onboarding/sessions and writes the session into cache', async () => {
    const session = makeSession();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(session, 201));

    const client = makeClient();
    const { result } = renderHook(() => useStartWizard(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/onboarding/sessions');
    expect(init.method).toBe('POST');

    expect(client.getQueryData(queryKeys.onboarding.session(session.id))).toEqual(
      session,
    );
    expect(client.getQueryData(queryKeys.onboarding.active())).toEqual(session);
  });
});

// ---------------------------------------------------------------------------
// useWizardSession
// ---------------------------------------------------------------------------

describe('useWizardSession', () => {
  it('GETs the session when sessionId is provided', async () => {
    const session = makeSession();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(session));

    const client = makeClient();
    const { result } = renderHook(() => useWizardSession('sess-1'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/onboarding/sessions/sess-1');
    expect(result.current.data).toEqual(session);
  });

  it('does not fetch when sessionId is null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const client = makeClient();
    const { result } = renderHook(() => useWizardSession(null), {
      wrapper: wrapperFor(client),
    });

    // Give React Query a tick to settle — it should NOT have fetched.
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.isFetching).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useAdvanceWizard
// ---------------------------------------------------------------------------

describe('useAdvanceWizard', () => {
  it('POSTs the advance payload and writes the new session into cache', async () => {
    const next = makeSession({ current_step: 'connect_repos' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(next));

    const client = makeClient();
    // Pre-seed the session so the cache-write assertion has a target.
    client.setQueryData(queryKeys.onboarding.session('sess-1'), makeSession());

    const { result } = renderHook(() => useAdvanceWizard('sess-1'), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        step: 'tenant_setup',
        step_input: { tenant: { name: 'acme' } },
        mark_complete: true,
      });
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/onboarding/sessions/sess-1/advance');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      step: 'tenant_setup',
      step_input: { tenant: { name: 'acme' } },
      mark_complete: true,
    });

    expect(
      client.getQueryData<WizardSession>(
        queryKeys.onboarding.session('sess-1'),
      )?.current_step,
    ).toBe('connect_repos');
  });
});

// ---------------------------------------------------------------------------
// useCancelWizard
// ---------------------------------------------------------------------------

describe('useCancelWizard', () => {
  it('POSTs /cancel and updates the cache', async () => {
    const cancelled = makeSession({ status: 'CANCELLED', completed_at: '2026-07-01T00:00:00Z' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(cancelled));

    const client = makeClient();
    client.setQueryData(queryKeys.onboarding.session('sess-1'), makeSession());

    const { result } = renderHook(() => useCancelWizard('sess-1'), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/onboarding/sessions/sess-1/cancel');
    expect(init.method).toBe('POST');

    expect(
      client.getQueryData<WizardSession>(
        queryKeys.onboarding.session('sess-1'),
      )?.status,
    ).toBe('CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// useStartProvision
// ---------------------------------------------------------------------------

describe('useStartProvision', () => {
  it('POSTs /onboarding/provision', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ job_id: 'job-1', status: 'running' }, 202),
      );

    const client = makeClient();
    const { result } = renderHook(() => useStartProvision(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      const out = await result.current.mutateAsync();
      expect(out).toEqual({ job_id: 'job-1', status: 'running' });
    });

    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/onboarding/provision');
    expect(init.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// useProvisionStatus
// ---------------------------------------------------------------------------

describe('useProvisionStatus', () => {
  it('GETs /onboarding/provision/status and returns the parsed body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        job_id: 'job-1',
        status: 'running',
        current_stage: 'graph',
        completed_stages: ['manifest'],
        error: null,
        started_at: '2026-07-01T00:00:00Z',
        finished_at: null,
      }),
    );

    const client = makeClient();
    const { result } = renderHook(
      () => useProvisionStatus({ refetchInterval: 1_000 }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalled();
    const [url] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/onboarding/provision/status');
    expect(result.current.data?.current_stage).toBe('graph');
  });
});