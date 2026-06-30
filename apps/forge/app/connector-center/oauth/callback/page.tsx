'use client';

/**
 * OAuth callback handler for the Connector Center.
 *
 * Flow:
 *   1. Marketplace tab redirects the browser to the upstream OAuth
 *      provider with a CSRF `state` (stored in `sessionStorage`).
 *   2. Provider redirects back to this page with `?code=…&state=…&slug=…`.
 *   3. We validate `state === sessionStorage.oauth_state`, then call
 *      `POST /api/v1/connectors/oauth/callback` with `{ code, state, slug }`.
 *   4. On success → route back to the Connector Center (Connected tab)
 *      and clear the stored state. On failure → render an error card
 *      with a "Try again" link to the marketplace.
 */

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, CircleX, Loader2, Plug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCompleteOAuth } from '@/lib/hooks/useConnectors';

const STORAGE_STATE = 'forge.oauth.state';
const STORAGE_SLUG = 'forge.oauth.slug';

export default function ConnectorOAuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const complete = useCompleteOAuth();

  const [error, setError] = React.useState<string | null>(null);
  const [slug, setSlug] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<'verifying' | 'exchanging' | 'done'>('verifying');

  // Run once on mount.
  const ranRef = React.useRef(false);
  React.useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCallback() {
    const code = params.get('code');
    const state = params.get('state');
    const slugParam = params.get('slug') ?? sessionStorage.getItem(STORAGE_SLUG);
    const storedState = sessionStorage.getItem(STORAGE_STATE);

    if (!code || !state || !slugParam) {
      setError('Missing OAuth parameters. The link may have expired.');
      return;
    }

    if (state !== storedState) {
      setError('State mismatch — possible CSRF attack. Aborting.');
      return;
    }

    setSlug(slugParam);
    setStatus('exchanging');

    try {
      await complete.mutateAsync({ code, state, slug: slugParam });
      sessionStorage.removeItem(STORAGE_STATE);
      sessionStorage.removeItem(STORAGE_SLUG);
      setStatus('done');
      // Give the toast a beat to render, then route.
      setTimeout(() => router.replace('/connector-center?tab=connected'), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OAuth exchange failed.');
    }
  }

  if (error) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-md border border-[var(--accent-rose)]/40 bg-[var(--bg-elevated)] p-6 text-center">
        <CircleX className="mx-auto mb-3 h-10 w-10 text-[var(--accent-rose)]" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-fg-primary">OAuth failed</h2>
        <p className="mt-1 text-sm text-fg-tertiary">{error}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.replace('/connector-center?tab=marketplace')}>
            Back to marketplace
          </Button>
          <Button size="sm" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-24 max-w-md rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 text-center">
      {status === 'done' ? (
        <>
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-[var(--accent-emerald)]" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-fg-primary">Connector connected</h2>
          <p className="mt-1 text-sm text-fg-tertiary">
            <Plug className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {slug} is now linked. Redirecting…
          </p>
        </>
      ) : (
        <>
          <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-[var(--accent-cyan)]" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-fg-primary">
            {status === 'verifying' ? 'Verifying state…' : 'Completing OAuth…'}
          </h2>
          <p className="mt-1 text-sm text-fg-tertiary">
            Hold tight — we're exchanging your code with {slug ?? 'the provider'}.
          </p>
        </>
      )}
    </div>
  );
}