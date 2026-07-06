'use client';

import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { queryClient } from '@/lib/query/client';

/**
 * Top-level client providers.
 *
 * - `ThemeProvider` (local in `components/theme-provider.tsx`) replaces
 *   `next-themes`; the upstream library emits a React 19 "Encountered a
 *   script tag while rendering" console error because it injects an inline
 *   `<script>` inside its Client Component tree. Our provider uses a
 *   `useLayoutEffect` to apply the stored theme class on `<html>` before
 *   first paint instead.
 * - `QueryClientProvider` mounts TanStack Query. The shared client
 *   lives in `lib/query/client.ts` (step-54 Phase 2) so server code
 *   and tests can reference the same instance.
 * - `<Toaster />` is mounted for shadcn `useToast` calls.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      themes={['dark', 'light']}
    >
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}