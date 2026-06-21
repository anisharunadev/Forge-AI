'use client';

import * as React from 'react';

/**
 * Client-side data hook for fetching from the orchestrator via the
 * Next.js proxy. Used by components that previously imported mock
 * data directly.
 *
 * Replaces the pattern:
 *   const { items } = useSomething();  // imported from '@/lib/foo/mock-data'
 *
 * With:
 *   const { data, error, isLoading } = useApiData<Item[]>('/v1/foo');
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <EmptyState />;
 *   return <List items={data ?? []} />;
 *
 * Behavior:
 *   - Server-rendered pages should NOT use this hook; they should
 *     call the data functions from lib/<domain>/data.ts directly.
 *   - This hook returns `data: null` until the first fetch settles.
 *   - On error, `data` stays null and `error` is set. Callers decide
 *     whether to render an empty state or an error banner.
 *   - Refetches on `path` change. No caching beyond the component
 *     lifecycle (use TanStack Query or SWR if you need that).
 */
export interface UseApiDataResult<T> {
  data: T | null;
  error: { status: number; message: string } | null;
  isLoading: boolean;
  refresh: () => void;
}

export function useApiData<T>(
  path: string | null,
  init?: RequestInit,
): UseApiDataResult<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<UseApiDataResult<T>['error']>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(path !== null);
  const [nonce, setNonce] = React.useState(0);
  const inFlight = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (!path) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setIsLoading(true);
    setError(null);

    const url = path.startsWith('/') ? `/api/proxy${path}` : `/api/proxy/${path}`;
    fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
        }
        const json = (await res.json()) as T;
        if (!ctrl.signal.aborted) {
          setData(json);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        const status = /HTTP (\d+)/.exec(message)?.[1]
          ? Number(/HTTP (\d+)/.exec(message)![1])
          : 0;
        setError({ status, message });
        setData(null);
        setIsLoading(false);
      });

    return () => ctrl.abort();
  }, [path, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data,
    error,
    isLoading,
    refresh: () => setNonce((n) => n + 1),
  };
}

/**
 * Convenience: same as useApiData but accepts a fetcher so server
 * components and client components can share the same call site.
 */
export function useApiDataWith<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): UseApiDataResult<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<UseApiDataResult<T>['error']>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);
  const inFlight = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setIsLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!ctrl.signal.aborted) {
          setData(result);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setError({ status: 0, message });
        setIsLoading(false);
      });

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return {
    data,
    error,
    isLoading,
    refresh: () => setNonce((n) => n + 1),
  };
}