'use client';

/**
 * AuthGuard — Zone 5 (step-52).
 *
 * Wraps protected workspace pages and redirects unauthenticated users
 * to `/login` (preserving the requested URL in `sessionStorage` so we
 * can bounce back after the login completes).
 *
 * Failure modes handled:
 *   1. No token at all                       → redirect to /login.
 *   2. Token present but user not hydrated   → show spinner, kick
 *                                              off `fetchCurrentUser`.
 *   3. Hydration failed (4xx/5xx)            → toast + redirect to
 *                                              /login (the client will
 *                                              also `logout()` so the
 *                                              bad token is cleared).
 *   4. SSR rendering before persist hydration → render the spinner
 *                                              instead of the children
 *                                              to avoid a flash of
 *                                              protected UI.
 *
 * The shell-chrome already wraps every workspace page, so mounting
 * AuthGuard at the (workspace)-equivalent level is the goal file's
 * `// src/app/(workspace)/layout.tsx` pattern. Since the project
 * doesn't yet use a `(workspace)` route group (step-52 is the
 * foundation that makes that refactor safe), we mount AuthGuard
 * inside ShellChrome so the protection applies to every non-auth
 * route automatically.
 */

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';

const RETURN_URL_KEY = 'return_url';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, _hasHydrated, fetchCurrentUser, logout } = useAuth();

  // Have a token but no user yet → try to hydrate. This is the "user
  // refreshed the page after login" path.
  React.useEffect(() => {
    if (!_hasHydrated) return;
    if (token && !user) {
      fetchCurrentUser().catch((err) => {
        // Bad token → bounce to login.
        const message =
          err instanceof ApiError && err.status === 401
            ? 'Session expired. Please sign in again.'
            : 'Couldn\'t verify your session. Please sign in again.';
        toast.error(message);
        logout();
        router.replace('/login');
      });
    }
  }, [_hasHydrated, token, user, fetchCurrentUser, logout, router]);

  // No token at all → bounce to login, preserving where the user was
  // trying to go.
  React.useEffect(() => {
    if (!_hasHydrated) return;
    if (!token) {
      if (pathname && pathname !== '/login') {
        try {
          sessionStorage.setItem(RETURN_URL_KEY, pathname);
        } catch {
          /* private mode */
        }
      }
      router.replace('/login');
    }
  }, [_hasHydrated, token, pathname, router]);

  // SSR / first paint: don't flash protected UI.
  if (!_hasHydrated) {
    return <FullPageSpinner label="Loading…" />;
  }

  // Token but user not yet hydrated (waiting for /auth/me).
  if (token && !user) {
    return <FullPageSpinner label="Verifying your session…" />;
  }

  // No token at all (and redirect already in flight).
  if (!token) {
    return <FullPageSpinner label="Redirecting…" />;
  }

  return <>{children}</>;
}

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center"
      data-testid="auth-guard-spinner"
    >
      <Loader2
        className="h-6 w-6 animate-spin text-[var(--accent-primary)]"
        aria-hidden="true"
      />
      <p className="text-sm text-[var(--fg-tertiary)]">{label}</p>
    </div>
  );
}