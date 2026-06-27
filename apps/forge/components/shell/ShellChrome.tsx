'use client';

/**
 * ShellChrome — gates the Sidebar / Topbar / MobileNav on the current
 * pathname. Added in step-52 so the auth routes (`/login`,
 * `/auth/callback`) get a clean, chrome-free canvas without
 * restructuring the root layout.
 *
 * The match logic is intentionally a small allow-list:
 *   - `/login` and `/auth/callback`           → no chrome
 *   - Anything else                            → full chrome
 *
 * Keep this list in sync with `app/(auth)/layout.tsx` if new auth
 * routes are added (e.g. `/auth/2fa`, `/auth/verify-email`).
 */

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { PageContainer } from './PageContainer';
import { AuthGuard } from '@/components/auth-guard';
import { ApiErrorBoundary } from '@/components/api-error-boundary';

const CHROME_FREE_PATHS = ['/login', '/auth/callback'];

function isChromeFree(pathname: string | null): boolean {
  if (!pathname) return false;
  return CHROME_FREE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function ShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const chromeFree = isChromeFree(pathname);

  if (chromeFree) {
    // Auth canvas — render the children directly. The `(auth)` layout
    // supplies its own centered container.
    return <>{children}</>;
  }

  // Workspace canvas — guarded by AuthGuard. Anyone without a token
  // gets bounced to /login (with the requested URL preserved). The
  // ApiErrorBoundary catches render-time errors and shows a recovery
  // surface so one broken component doesn't take down the whole shell.
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main-content" className="min-w-0 flex-1">
          <PageContainer>
            <AuthGuard>
              <ApiErrorBoundary>{children}</ApiErrorBoundary>
            </AuthGuard>
          </PageContainer>
        </main>
      </div>
      <MobileNav />
    </div>
  );
}