/**
 * FORA-514 §3 — the issue / runs dashboard at the canonical
 * `/dashboard` route. Renders the same data the persona dashboards
 * read, but tenant-agnostic (no operator action bar) and directly
 * subscribed to `issue.updated` / `issue.created` realtime events.
 *
 * The persona pages (`/personas/{pm,eng-lead,cto}`) are persona-shaped
 * views on top of the same orchestrator data; this page is the
 * "everyone's dashboard" entry point the FORA-374 v1 scope described.
 *
 * SSR pattern matches `eng-lead/page.tsx`: server fetches the run
 * list once for hydration, then `<RealtimeRunsList>` takes over
 * client-side via the `useRealtime` hook.
 */

import { getRunsView, seedAliasFor } from '@/lib/api';
import { OrchestratorUnreachable } from '@/components/OrchestratorNotice';
import { RealtimeRunsList } from '@/components/RealtimeRunsList';
import { RunStatusBadge } from '@/components/RunStatusBadge';
import { listRuns } from '@/lib/api';
import type { RunRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function IssueDashboard() {
  const view = await getRunsView();
  const initialRuns: ReadonlyArray<RunRecord> = view.state === 'ok' ? view.runs : [];

  // Client-side fetcher mirrors the server path. We re-export `listRuns`
  // (server-only) through a thin async wrapper so the client component
  // calls into the same REST endpoint without holding server deps.
  const fetcher = async (): Promise<ReadonlyArray<RunRecord>> => {
    const res = await fetch(`${getApiBase()}/v1/runs`, {
      cache: 'no-store',
      headers: { 'x-fora-tenant-id': getDevTenantUuid() },
    });
    if (!res.ok) return [];
    return (await res.json()) as ReadonlyArray<RunRecord>;
  };

  return (
    <div className="space-y-8" data-testid="issue-dashboard">
      <header>
        <p className="text-xs uppercase tracking-wider text-forge-300">Dashboard</p>
        <h1 className="text-2xl font-semibold">All runs</h1>
        <p className="text-sm text-forge-200">
          Realtime via WebSocket; polls every 5 s while the socket is reconnecting.
        </p>
      </header>

      {view.state === 'unreachable' ? (
        <OrchestratorUnreachable view={view} />
      ) : null}

      {view.state === 'ok' ? (
        <section className="card" aria-labelledby="dashboard-h">
          <h2 id="dashboard-h" className="text-lg font-semibold">
            Runs
          </h2>
          <RealtimeRunsList
            initialRuns={initialRuns}
            fetcher={fetcher}
            hideActions
          />
        </section>
      ) : null}

      {view.state === 'empty' ? (
        <section className="card" aria-labelledby="dashboard-empty-h">
          <h2 id="dashboard-empty-h" className="text-lg font-semibold">
            No runs yet
          </h2>
          <p className="mt-2 text-sm text-forge-200">
            Seed <code>demo-run-001</code> via <code>./scripts/dev-up.sh</code>.
          </p>
        </section>
      ) : null}
    </div>
  );
}

/** Resolve the public orchestrator base URL on the server. */
function getApiBase(): string {
  return (
    process.env.FORA_FORGE_API_URL ??
    process.env.NEXT_PUBLIC_FORGE_API_URL ??
    'http://localhost:4000'
  );
}

/** Dev-only: tenant UUID the orchestrator accepts. Production wires via the identity broker. */
function getDevTenantUuid(): string {
  return '00000000-0000-0000-0000-000000000ace';
}
