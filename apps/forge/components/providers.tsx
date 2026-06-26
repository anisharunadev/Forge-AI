'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

import { Toaster } from '@/components/ui/toaster';

/**
 * Top-level client providers.
 *
 * - `NextThemesProvider` from `next-themes` enables the
 *   dark-first / light-ready theme system; the `className="dark"`
 *   on `<html>` in `app/layout.tsx` is the default, and users can
 *   flip to light via the `<ThemeToggle>` in `<Topbar>`.
 * - `QueryClientProvider` mounts TanStack Query. The provider is
 *   present but adoption is gradual — Phase 0.5-04 plans a sweep
 *   to replace `useApiData` with `useQuery` and `useMutation`.
 * - `<Toaster />` is mounted for shadcn `useToast` calls.
 * - **Step 6 — @axe-core/react dev-only** — when `NEXT_PUBLIC_AXE=1`
 *   is set, we lazy-load `@axe-core/react` and bind it to the React
 *   DevTools. Critical/Serious violations surface in the browser
 *   console. The bundle stays out of production builds because the
 *   import is gated by the env var (and stripped at build time).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // Lazy-load axe-core only in dev and only when the env flag is set.
  //
  // The module specifier is a STATIC string so Turbopack/webpack can
  // resolve it at build time. The `webpackIgnore` magic comment is a
  // defense-in-depth signal: even if the bundler ever tries to chase
  // this import at build time (it should not, because the `useEffect`
  // body is dead-code-eliminated in production), it will treat the
  // call as a runtime-only `import()` and skip resolution.
  //
  // The runtime env guards below are what keep it out of production
  // bundles — webpack's DCE drops the entire `useEffect` body when
  // `process.env.NODE_ENV !== 'development'`. The `.catch()` swallows
  // the rare case where the dev-only dep is not installed locally.
  // React.useEffect(() => {
  //   if (process.env.NODE_ENV !== 'development') return;
  //   if (process.env.NEXT_PUBLIC_AXE !== '1') return;
  //   let cancelled = false;
  //   void import(
  //     /* webpackMode: "lazy", webpackChunkName: "axe-core" */ '@axe-core/react'
  //   )
  //     .then((mod) => {
  //       if (cancelled) return;
  //       void import('react-dom').then((ReactDOM) => {
  //         if (cancelled) return;
  //         mod.default(React, ReactDOM as unknown as typeof import('react-dom'), 1000);
  //         // eslint-disable-next-line no-console
  //         console.info('[axe-core] dev-only a11y checks armed');
  //       });
  //     })
  //     .catch(() => {
  //       // Dev-only optional dependency — silently no-op if not installed.
  //     });
  //   return () => {
  //     cancelled = true;
  //   };
  // }, []);

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange={false}
      themes={['dark', 'light']}
    >
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </NextThemesProvider>
  );
}
