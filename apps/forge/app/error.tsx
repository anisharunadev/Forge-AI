'use client';

/**
 * app/error.tsx — per-route error boundary.
 *
 * Caught errors inside the App Router bubble up to the nearest
 * `error.tsx` segment. This is the per-route fallback that replaces
 * the Next.js dev error overlay in production. It is a Client
 * Component (the `reset()` callback requires it) but uses only
 * semantic tokens — no `.card` utility, no `forge-*` literal classes.
 *
 * Plan 0.5-02 establishes this boundary; the new <Shell> layout
 * wraps all routes, so this error UI inherits the same vertical
 * rhythm as the rest of the app.
 */

import { useEffect } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

function truncate(msg: string, max = 240): string {
  if (msg.length <= max) return msg;
  return `${msg.slice(0, max - 1)}…`;
}

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console so dev tooling can attach the
    // source. In production the orchestrator-side logger would pick
    // this up via the React error boundary hook in a future phase.
    // eslint-disable-next-line no-console
    console.error('[app/error.tsx] unhandled route error:', error);
  }, [error]);

  return (
    <main
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center"
      data-testid="app-error"
      role="alert"
    >
      <p className="text-2xs font-semibold uppercase tracking-wider text-subtle">
        Something went wrong
      </p>
      <h1 className="mt-3 text-24 font-semibold tracking-tight text-foreground">
        We hit an unexpected error
      </h1>
      <p className="mt-4 max-w-xl text-14 text-muted-foreground">
        {truncate(error.message || 'No further details are available.')}
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-2xs text-subtle">
          digest: {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
