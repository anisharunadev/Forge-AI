/**
 * Step-73 Settings hooks — fetch + mutation wiring tests.
 *
 * Covers the canonical hooks consumed by the Settings page:
 *   - useMe / useUpdateMe
 *   - useApiTokens / useCreateApiToken / useRevokeApiToken
 *   - useSessions
 *   - useBranding / useUpdateBranding
 *   - useBillingQuota
 *   - useFeatureFlags / useUpdateFeatureFlag
 *
 * Pattern matches `apps/forge/tests/intelligence/ideation-push-jira.test.tsx`:
 *   - `renderWithClient(QueryClient + QueryClientProvider)`
 *   - `vi.spyOn(globalThis, 'fetch')` for fetch mocking (no MSW)
 *
 * Each test renders a tiny harness component that calls the hook and
 * surfaces the relevant fields on the DOM so assertions can target
 * the rendered output instead of digging through TanStack internals.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';

import {
  useApiTokens,
  useBillingQuota,
  useBranding,
  useCreateApiToken,
  useFeatureFlags,
  useMe,
  useRevokeApiToken,
  useSessions,
  useUpdateBranding,
  useUpdateFeatureFlag,
  useUpdateMe,
} from '@/lib/hooks/useSettings';

// ponytail: vi.SpyInstance.mock.calls is `MockCall[][] | undefined` and
// TS insists on the indexed element being possibly undefined even after
// a `toHaveBeenCalledTimes(1)` await. Capture the call once, then read.
function lastFetchCall(spy: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }): [unknown, RequestInit] {
  const call = spy.mock.calls[0];
  if (!call) throw new Error('expected fetch to have been called');
  return [call[0], (call[1] ?? {}) as RequestInit];
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Server Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Small harness — renders a marker with the field we want to assert. */
function makeHarness<T>(hook: () => T, project: (value: T) => string) {
  return function Harness() {
    const v = hook();
    const projectFn = project as (val: unknown) => string;
    return <span data-testid="out">{projectFn(v)}</span>;
  };
}

describe('step-73 settings hooks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // useMe / useUpdateMe
  // -------------------------------------------------------------------------

  it('useMe fetches and surfaces the principal', async () => {
    const Harness = makeHarness(
      useMe,
      (q) => `${q.isLoading ? 'loading' : 'done'}::${q.data?.id ?? '-'}`,
    );
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ id: 'u-1', email: 'a@b.co', display_name: 'Alice' }),
      );
    renderWithClient(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe('done::u-1'),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/auth/me'),
      expect.any(Object),
    );
  });

  it('useUpdateMe PATCHes /auth/me and invalidates the me query', async () => {
    let invalidations = 0;
    function Harness() {
      const upd = useUpdateMe();
      return (
        <button
          data-testid="go"
          onClick={() => upd.mutate({ displayName: 'Renamed' })}
        >
          go
        </button>
      );
    }
    const { client } = renderWithClient(<Harness />);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'u-1',
          email: 'a@b.co',
          display_name: 'Renamed',
        }),
      );
    const qc = client;
    const spy = vi.spyOn(qc, 'invalidateQueries').mockImplementation(() => {
      invalidations += 1;
      return Promise.resolve();
    });

    await act(async () => {
      screen.getByTestId('go').click();
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    {
      const [url, init] = lastFetchCall(fetchSpy);
      expect(url).toContain('/auth/me');
      expect(init.method).toBe('PATCH');
    }
    await waitFor(() => expect(invalidations).toBeGreaterThanOrEqual(1));
    expect(spy).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // API tokens
  // -------------------------------------------------------------------------

  it('useApiTokens fetches /auth/api-tokens', async () => {
    const Harness = makeHarness(
      useApiTokens,
      (q) => `${q.isLoading ? 'loading' : 'done'}::${q.data?.length ?? 0}`,
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse([
        { id: 't1', name: 'ci', scope: 'read', fingerprint_sha256: 'abc' },
      ]),
    );
    renderWithClient(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe('done::1'),
    );
  });

  it('useCreateApiToken returns the one-shot secret', async () => {
    let captured: unknown = null;
    function Harness() {
      const c = useCreateApiToken();
      return (
        <button
          data-testid="go"
          onClick={async () => {
            const out = await c.mutateAsync({
              name: 'ci',
              scope: 'read',
              expiresInDays: 7,
            });
            captured = out;
          }}
        >
          go
        </button>
      );
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        id: 't1',
        name: 'ci',
        scope: 'read',
        fingerprint_sha256: 'abc',
        secret: 'plain-text-secret-once',
      }),
    );
    renderWithClient(<Harness />);
    await act(async () => {
      screen.getByTestId('go').click();
    });
    await waitFor(() => expect(captured).not.toBeNull());
    expect((captured as { secret: string }).secret).toBe(
      'plain-text-secret-once',
    );
  });

  it('useRevokeApiToken DELETEs /auth/api-tokens/{id} and invalidates', async () => {
    let invalidations = 0;
    function Harness() {
      const r = useRevokeApiToken();
      return (
        <button
          data-testid="go"
          onClick={() => r.mutate('tok-123')}
        >
          go
        </button>
      );
    }
    const { client } = renderWithClient(<Harness />);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({}, true));
    vi.spyOn(client, 'invalidateQueries').mockImplementation(() => {
      invalidations += 1;
      return Promise.resolve();
    });
    await act(async () => {
      screen.getByTestId('go').click();
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    {
      const [url, init] = lastFetchCall(fetchSpy);
      expect(url).toContain('/auth/api-tokens/tok-123');
      expect(init.method).toBe('DELETE');
    }
    await waitFor(() => expect(invalidations).toBeGreaterThanOrEqual(1));
  });

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  it('useSessions fetches /auth/sessions', async () => {
    const Harness = makeHarness(
      useSessions,
      (q) => `${q.isLoading ? 'loading' : 'done'}::${q.data?.length ?? 0}`,
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse([
        { id: 's1', label: 'MacBook', user_agent: 'x', ip: '1.1.1.1' },
      ]),
    );
    renderWithClient(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe('done::1'),
    );
  });

  // -------------------------------------------------------------------------
  // Branding
  // -------------------------------------------------------------------------

  it('useBranding stays disabled when tenantId is null', async () => {
    const Harness = makeHarness(
      () => useBranding(null),
      (q) =>
        `${q.fetchStatus}::${q.status}::${q.data?.logoUrl ?? 'none'}`,
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderWithClient(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent?.startsWith('idle')).toBe(
        true,
      ),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('useUpdateBranding PATCHes /tenants/{id}/branding with body', async () => {
    let captured: unknown = null;
    function Harness() {
      const u = useUpdateBranding('tenant-42');
      return (
        <button
          data-testid="go"
          onClick={async () => {
            captured = await u.mutateAsync({ primaryColor: '#00ff00' });
          }}
        >
          go
        </button>
      );
    }
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          logoUrl: null,
          primaryColor: '#00ff00',
          accentColor: null,
          faviconUrl: null,
          supportEmail: null,
        }),
      );
    renderWithClient(<Harness />);
    await act(async () => {
      screen.getByTestId('go').click();
    });
    await waitFor(() => expect(captured).not.toBeNull());
    {
      const [url, init] = lastFetchCall(fetchSpy);
      expect(url).toContain('/tenants/tenant-42/branding');
      expect(init.method).toBe('PATCH');
      const sent = JSON.parse((init.body as string) ?? '{}');
      expect(sent.primaryColor).toBe('#00ff00');
    }
  });

  // -------------------------------------------------------------------------
  // Billing quota
  // -------------------------------------------------------------------------

  it('useBillingQuota fetches /analytics/quota with tenantId', async () => {
    const Harness = makeHarness(
      () => useBillingQuota('tenant-99'),
      (q) =>
        `${q.isLoading ? 'loading' : 'done'}::${q.data?.monthlyUsdLimit ?? 0}`,
    );
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          plan: 'pro',
          monthlyUsdLimit: 100,
          used_usd: 12.5,
          period_start: '2026-06-01T00:00:00Z',
          period_end: '2026-07-01T00:00:00Z',
        }),
      );
    renderWithClient(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe('done::100'),
    );
    {
      const [url] = lastFetchCall(fetchSpy);
      expect(url).toContain('/analytics/quota');
      expect(url).toContain('tenant_id=tenant-99');
    }
  });

  // -------------------------------------------------------------------------
  // Feature flags
  // -------------------------------------------------------------------------

  it('useFeatureFlags fetches /feature-flags', async () => {
    const Harness = makeHarness(
      useFeatureFlags,
      (q) => `${q.isLoading ? 'loading' : 'done'}::${q.data?.length ?? 0}`,
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse([
        {
          key: 'copilot.enabled',
          value: true,
          type: 'bool',
          description: 'Enable FAB',
          updated_at: null,
        },
      ]),
    );
    renderWithClient(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe('done::1'),
    );
  });

  it('useUpdateFeatureFlag PATCHes /feature-flags/{key} with {value} body', async () => {
    let captured: unknown = null;
    function Harness() {
      const u = useUpdateFeatureFlag();
      return (
        <button
          data-testid="go"
          onClick={async () => {
            captured = await u.mutateAsync({
              key: 'copilot.enabled',
              value: false,
            });
          }}
        >
          go
        </button>
      );
    }
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          key: 'copilot.enabled',
          value: false,
          type: 'bool',
          description: 'Enable FAB',
          updated_at: '2026-07-01T00:00:00Z',
        }),
      );
    renderWithClient(<Harness />);
    await act(async () => {
      screen.getByTestId('go').click();
    });
    await waitFor(() => expect(captured).not.toBeNull());
    {
      const [url, init] = lastFetchCall(fetchSpy);
      expect(url).toContain('/feature-flags/copilot.enabled');
      expect(init.method).toBe('PATCH');
      const sent = JSON.parse((init.body as string) ?? '{}');
      expect(sent).toEqual({ value: false });
    }
  });
});