'use client';

/**
 * app/global-error.tsx — root error boundary.
 *
 * Catches errors that escape the root layout entirely (e.g. a bug in
 * `app/layout.tsx` itself). Because the root layout is the one thing
 * that won't render when this file runs, this boundary MUST include
 * its own `<html>` and `<body>` and inline the minimum CSS needed to
 * match the shell. It cannot rely on `globals.css` being loaded.
 *
 * Per the curated spec, the body uses `bg-background` (hsl --background)
 * so the dark theme holds even on a catastrophic failure.
 */

function truncate(msg: string, max = 240): string {
  if (msg.length <= max) return msg;
  return `${msg.slice(0, max - 1)}…`;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="h-full dark">
      <body
        className="min-h-screen bg-background text-foreground antialiased"
        data-testid="app-global-error"
      >
        <style
          // Inline fallback styles. globals.css is not guaranteed to
          // load alongside this boundary, so we replicate the few
          // tokens the error UI actually uses.
          dangerouslySetInnerHTML={{
            __html: `
              :root { --background: 240 10% 4%; --foreground: 0 0% 98%; --subtle: 240 4% 45%; --muted-foreground: 240 4% 65%; }
              body { font-family: var(--font-sans, system-ui, -apple-system, sans-serif); margin: 0; }
            `,
          }}
        />
        <main
          className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center"
          role="alert"
        >
          <p className="text-2xs font-semibold uppercase tracking-wider text-subtle">
            Something went wrong
          </p>
          <h1 className="mt-3 text-24 font-semibold tracking-tight">
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
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition hover:bg-primary/90"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
