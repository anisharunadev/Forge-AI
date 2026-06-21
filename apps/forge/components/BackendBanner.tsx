import * as React from 'react';

/**
 * Visible "backend not running" notice for terminal + onboarding
 * pages (Phase A.3). The page still renders — the banner just
 * makes it obvious why interactive features don't work.
 *
 * Two variants:
 *   - `terminal`: tells the user to run `pnpm dev:terminal`
 *   - `onboarding`: tells the user to run `pnpm dev:stub`
 */
export type BackendKind = 'terminal' | 'onboarding' | 'orchestrator';

const COPY: Record<BackendKind, { title: string; body: React.ReactNode; cmd: string }> = {
  terminal: {
    title: 'Terminal sidecar not running',
    body: (
      <>
        The xterm.js pane can render but cannot execute commands until the local PTY
        sidecar is started on <code>ws://localhost:4001</code>.
      </>
    ),
    cmd: 'pnpm dev:terminal',
  },
  onboarding: {
    title: 'Orchestrator stub not running',
    body: (
      <>
        The wizard can collect your inputs, but the final <em>Confirm</em> step has no
        backend to provision against. Start the dev orchestrator stub on{' '}
        <code>http://localhost:4000</code> to enable project creation.
      </>
    ),
    cmd: 'pnpm dev:stub',
  },
  orchestrator: {
    title: 'Orchestrator unreachable',
    body: (
      <>
        The Forge console could not reach the orchestrator REST API. Run data on this
        page is showing seed data; live data will replace it once the backend is
        reachable.
      </>
    ),
    cmd: 'pnpm dev:stub',
  },
};

export function BackendBanner({
  kind,
  status,
}: {
  kind: BackendKind;
  status?: { error: string; httpStatus?: number } | null;
}) {
  const copy = COPY[kind];
  return (
    <div
      role="alert"
      data-testid={`backend-banner-${kind}`}
      className="card border-amber-400/50 bg-amber-400/5"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30">
          <span aria-hidden="true">⚠</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-200">{copy.title}</p>
          <p className="mt-1 text-sm text-amber-100/80">{copy.body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="rounded-md bg-amber-400/10 px-2 py-1 font-mono text-xs text-amber-100 ring-1 ring-inset ring-amber-400/20">
              {copy.cmd}
            </code>
            <span className="text-xs text-amber-100/60">
              or run the full stack:&nbsp;
              <code className="font-mono">pnpm dev:stack</code>
            </span>
          </div>
          {status?.error ? (
            <p className="mt-3 font-mono text-xs text-amber-100/70">
              {status.httpStatus && status.httpStatus > 0 ? `HTTP ${status.httpStatus} — ` : ''}
              {status.error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}