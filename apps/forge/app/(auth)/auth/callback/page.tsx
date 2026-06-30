'use client';

/**
 * /auth/callback — step-53 Zone 5 callback handler.
 *
 * Receives the redirect from Keycloak after a successful login. Two
 * shapes of return URL are supported, in priority order:
 *
 *   1. PKCE flow (preferred)  →  `?code=…&state=…`
 *      Read the PKCE verifier from sessionStorage, post the code +
 *      verifier to `/api/v1/auth/oidc/callback`, store the resulting
 *      Forge JWTs in the auth store, and hydrate the user.
 *
 *   2. Token-in-redirect       →  `?token=…&refresh=…`
 *      Legacy shape from step-52's OAuth providers. Persist the
 *      tokens directly and hydrate. Kept for backwards compatibility
 *      with `/auth/oauth/{provider}` redirect responses.
 *
 *   3. Error                   →  `?error=…&error_description=…`
 *      Display a user-facing message and bounce to /login.
 *
 * State validation:
 *   We compare `?state=` to the value we stored in sessionStorage
 *   before redirecting to Keycloak. A mismatch means the response
 *   came from a different flow than the one we initiated — possible
 *   authorization-code injection. Fail closed.
 */

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/lib/api/auth';
import {
  clearPKCEState,
  exchangeCodeForTokens,
  readPKCEState,
} from '@/lib/auth/oidc';

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
      clearPKCEState();
      setStatus('error');
      setErrorMessage(
        searchParams.get('error_description') ||
          'Sign-in was cancelled or failed.',
      );
      toast.error('Sign-in failed');
      const t = window.setTimeout(() => router.replace('/login'), 1500);
      return () => window.clearTimeout(t);
    }

    const code = searchParams.get('code');
    const token = searchParams.get('token');
    const refresh = searchParams.get('refresh');

    // Path 1 — PKCE (preferred). Validate state to defeat code injection.
    if (code) {
      const incomingState = searchParams.get('state');
      const { verifier, state: storedState, returnUrl } = readPKCEState();
      if (!verifier) {
        setStatus('error');
        setErrorMessage(
          'Sign-in session expired — restart from the login page.',
        );
        toast.error('Sign-in failed');
        clearPKCEState();
        const t = window.setTimeout(() => router.replace('/login'), 1500);
        return () => window.clearTimeout(t);
      }
      if (incomingState !== storedState) {
        setStatus('error');
        setErrorMessage('Sign-in state mismatch — please try again.');
        toast.error('Sign-in failed');
        clearPKCEState();
        const t = window.setTimeout(() => router.replace('/login'), 1500);
        return () => window.clearTimeout(t);
      }

      (async () => {
        try {
          const redirectUri = `${window.location.origin}/auth/callback`;
          const tokens = await exchangeCodeForTokens({
            code,
            redirectUri,
            codeVerifier: verifier,
          });
          // Drop the one-shot verifier immediately so a page-reload
          // can't replay it.
          clearPKCEState();

          // Persist tokens via the auth store. We do this BEFORE
          // `fetchCurrentUser` so the /auth/me call is authenticated.
          useAuth.setState({
            token: tokens.access_token,
            refreshToken: tokens.refresh_token,
          });

          await fetchCurrentUser();
          toast.success('Welcome back');
          const target = returnUrl || '/dashboard';
          router.replace(target);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Could not complete sign-in.';
          setStatus('error');
          setErrorMessage(message);
          toast.error('Sign-in failed');
          clearPKCEState();
          const t = window.setTimeout(() => router.replace('/login'), 2000);
          return () => window.clearTimeout(t);
        }
      })();
      return;
    }

    // Path 2 — legacy token-in-redirect (step-52 OAuth).
    if (token && refresh) {
      (async () => {
        try {
          useAuth.setState({
            token,
            refreshToken: refresh,
          });
          await fetchCurrentUser();
          toast.success('Welcome back');
          const target =
            sessionStorage.getItem('return_url') || '/dashboard';
          sessionStorage.removeItem('return_url');
          router.replace(target);
        } catch {
          // Tokens saved but profile hydration failed — let AuthGuard
          // surface the issue. We still bounce to the dashboard so the
          // user isn't stuck on the callback screen.
          toast.error('Signed in, but couldn\'t load your profile.');
          router.replace('/dashboard');
        }
      })();
      return;
    }

    // Neither code nor tokens — bad redirect target.
    setStatus('error');
    setErrorMessage(
      'No authorization code or token received. Restart from the login page.',
    );
    toast.error('Sign-in failed');
    clearPKCEState();
    const t = window.setTimeout(() => router.replace('/login'), 1500);
    return () => window.clearTimeout(t);
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
