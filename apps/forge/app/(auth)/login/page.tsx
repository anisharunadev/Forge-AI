'use client';

/**
 * /login — step-53 Zone 7.
 *
 * Single sign-in path: Keycloak OIDC + PKCE. The SPA cannot keep a
 * client secret, so it acts as a public OIDC client (RFC 8252) and
 * relies on PKCE to bind the authorization code to a one-shot
 * verifier generated in the browser.
 *
 * Flow:
 *   1. User clicks "Sign in with Keycloak".
 *   2. `startLogin(returnUrl)` (in `lib/auth/oidc.ts`) generates a
 *      32-byte random code_verifier, derives its SHA-256
 *      code_challenge, generates a state string, and stores all three
 *      in sessionStorage.
 *   3. The browser is redirected to
 *      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth`
 *      with the challenge + state.
 *   4. The user authenticates at Keycloak.
 *   5. Keycloak redirects back to `/auth/callback?code=...&state=...`.
 *   6. The callback page exchanges the code + verifier with our
 *      backend's `POST /api/v1/auth/oidc/callback` endpoint, which
 *      trades it for Forge JWTs and materializes the user + tenant.
 *   7. Tokens land in `useAuth`; the user is redirected to the
 *      original return URL (default `/dashboard`).
 *
 * Why no email/password form?
 *   step-53's spec (Zone 7) shows a single "Sign in with Keycloak"
 *   CTA. Forge delegates identity entirely to Keycloak — keeping an
 *   email/password form here would mean a parallel credential path
 *   that bypasses the IdP, defeats Rule 6 (mandatory auditability of
 *   identity events), and confuses users into expecting a recovery
 *   flow that doesn't exist. Sign-up is also delegated to Keycloak
 *   (the realm is `registrationAllowed: false` so users can only be
 *   provisioned by an admin — see `scripts/keycloak-init/forge-realm.json`).
 *
 * Skills applied:
 *   - Layout uses the design-system tokens (`--bg-base`, `--bg-elevated`,
 *     `--accent-primary`, `--radius-xl`).
 *   - Spinner via `lucide-react` `Loader2` for the redirect-in-flight
 *     state.
 *   - Errors surface via Sonner toast.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/api/auth';
import { startLogin } from '@/lib/auth/oidc';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [isRedirecting, setIsRedirecting] = React.useState(false);

  // If the user is already signed in, bounce them straight to the
  // dashboard. Avoids the confusing "I logged out in another tab"
  // dance.
  React.useEffect(() => {
    if (user) {
      const target =
        searchParams.get('return_url') ||
        sessionStorage.getItem('return_url') ||
        '/dashboard';
      sessionStorage.removeItem('return_url');
      router.replace(target);
    }
  }, [user, router, searchParams]);

  // Single sign-in handler. `startLogin` redirects the browser to
  // Keycloak — we flip a local flag so the button can show a spinner
  // in the brief moment between click and navigation. If anything
  // throws synchronously (e.g. sessionStorage is blocked) the flag
  // resets via toast.error.
  const handleSignIn = React.useCallback(() => {
    const returnUrl =
      searchParams.get('return_url') ||
      sessionStorage.getItem('return_url') ||
      '/dashboard';
    setIsRedirecting(true);
    startLogin(returnUrl).catch((err) => {
      setIsRedirecting(false);
      toast.error(
        err instanceof Error ? err.message : 'Could not start sign-in.',
      );
    });
  }, [searchParams]);

  return (
    <div className="w-full max-w-[440px]">
      {/* Brand mark — outside the card so the card stays clean */}
      <div className="mb-8 flex flex-col items-center text-center">
        <div
          className="mb-3 flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent-primary)] to-[var(--accent-cyan)] shadow-[var(--shadow-md)]"
          aria-hidden="true"
        >
          <span className="text-2xl font-bold text-white">F</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--fg-primary)]">
          Welcome to Forge AI
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-tertiary)]">
          Sign in to your workspace
        </p>
      </div>

      {/* Card */}
      <div
        className="rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-lg)]"
        data-testid="login-card"
      >
        <Button
          type="button"
          onClick={handleSignIn}
          disabled={isRedirecting}
          className="h-12 w-full justify-center gap-3 bg-[var(--accent-primary)] text-sm font-semibold text-white hover:bg-[var(--accent-primary)]/90 disabled:opacity-60"
          data-testid="login-keycloak"
        >
          {isRedirecting ? (
            <>
              <Loader2
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
              Redirecting…
            </>
          ) : (
            <>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Sign in with Keycloak
            </>
          )}
        </Button>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-[var(--fg-tertiary)]">
        By signing in, you agree to our{' '}
        <Link
          href="/legal/terms"
          className="underline hover:text-[var(--fg-secondary)]"
        >
          Terms
        </Link>{' '}
        and{' '}
        <Link
          href="/legal/privacy"
          className="underline hover:text-[var(--fg-secondary)]"
        >
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}