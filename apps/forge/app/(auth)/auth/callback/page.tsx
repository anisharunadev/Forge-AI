'use client';

/**
 * /auth/callback — Zone 4 (step-52).
 *
 * Receives `?token=...&refresh=...` (and optionally `?error=...`) from
 * the OAuth provider bounce-back. Stores the tokens via the auth store
 * and redirects to the original requested URL (or `/dashboard`).
 *
 * Why not call the backend here?
 *   The OAuth provider hands us a signed token directly — the backend
 *   has already validated the identity-provider code server-side. We
 *   just need to persist the tokens and hydrate the user.
 *
 * Error handling:
 *   - Missing token → bounce to /login with an explanatory toast.
 *   - Backend hydration failure (e.g. /auth/me 5xx) → keep the tokens
 *     (they're valid) but show a "couldn't load your profile" toast
 *     and let AuthGuard decide what to do.
 */

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/lib/api/auth';

const TOKEN_KEY = 'forge_token';
const REFRESH_KEY = 'forge_refresh';

function safeWrite(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode — silent */
  }
}

export default function OAuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { fetchCurrentUser, _hasHydrated } = useAuth();
  const [status, setStatus] = React.useState<'pending' | 'error'>(
    'pending',
  );
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Wait for the auth store to rehydrate from localStorage so we don't
    // race the persist middleware.
    if (!_hasHydrated) return;

    const error = searchParams.get('error');
    if (error) {
      setStatus('error');
      setErrorMessage(
        searchParams.get('error_description') ||
          'OAuth sign-in was cancelled or failed.',
      );
      toast.error('Sign-in failed');
      // Bounce to /login after a short delay so the user can read the
      // message.
      const t = window.setTimeout(() => router.replace('/login'), 1500);
      return () => window.clearTimeout(t);
    }

    const token = searchParams.get('token');
    const refresh = searchParams.get('refresh');

    if (!token || !refresh) {
      setStatus('error');
      setErrorMessage('Missing authentication tokens from the OAuth provider.');
      toast.error('Sign-in failed');
      const t = window.setTimeout(() => router.replace('/login'), 1500);
      return () => window.clearTimeout(t);
    }

    // Persist + hydrate. fetchCurrentUser() will populate user/tenant.
    safeWrite(TOKEN_KEY, token);
    safeWrite(REFRESH_KEY, refresh);

    (async () => {
      try {
        await fetchCurrentUser();
        toast.success('Welcome back');
        const target =
          sessionStorage.getItem('return_url') || '/dashboard';
        sessionStorage.removeItem('return_url');
        router.replace(target);
      } catch (err) {
        // Tokens saved but profile hydration failed — let AuthGuard
        // surface the issue. We still bounce to the dashboard so the
        // user isn't stuck on the callback screen.
        toast.error('Signed in, but couldn\'t load your profile.');
        router.replace('/dashboard');
      }
    })();
  }, [_hasHydrated, searchParams, fetchCurrentUser, router]);

  return (
    <div
      className="flex w-full max-w-[440px] flex-col items-center justify-center gap-4 rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 text-center shadow-[var(--shadow-lg)]"
      data-testid="oauth-callback-card"
    >
      {status === 'pending' ? (
        <>
          <Loader2
            className="h-8 w-8 animate-spin text-[var(--accent-primary)]"
            aria-hidden="true"
          />
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            Finishing sign-in…
          </h2>
          <p className="text-sm text-[var(--fg-tertiary)]">
            Validating your session with the workspace.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold text-[var(--accent-rose)]">
            Sign-in failed
          </h2>
          <p className="text-sm text-[var(--fg-secondary)]">
            {errorMessage || 'Redirecting to the sign-in page…'}
          </p>
        </>
      )}
    </div>
  );
}