'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

import { Toaster } from '@/components/ui/toaster';

interface ProvidersProps {
  children: React.ReactNode;
}

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
 * - `<Toaster />` is mounted for shadcn `useToast` calls (Plan
 *   0.5-02 will re-enable the toast surface).
 */
export function Providers({ children }: ProvidersProps) {
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
