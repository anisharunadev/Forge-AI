'use client';

import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

import { Toaster } from '@/components/ui/toaster';
import { queryClient } from '@/lib/query/client';

/**
 * Top-level client providers.
 *
 * - `NextThemesProvider` from `next-themes` enables the
 *   dark-first / light-ready theme system; the `className="dark"`
 *   on `<html>` in `app/layout.tsx` is the default, and users can
 *   flip to light via the `<ThemeToggle>` in `<Topbar>`.
 * - `QueryClientProvider` mounts TanStack Query. The shared client
 *   lives in `lib/query/client.ts` (step-54 Phase 2) so server code
 *   and tests can reference the same instance.
 * - `<Toaster />` is mounted for shadcn `useToast` calls.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange={false}
      themes={['dark', 'light']}
    >
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </NextThemesProvider>
  );
}