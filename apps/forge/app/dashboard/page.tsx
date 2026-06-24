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
 *
 * Phase 0.5-05: redesigned with `PageHeader` + `SectionCard` +
 * `EmptyState` from `@/components/shell`. Semantic tokens only
 * (no `forge-*` literal color classes).
 */

import { Activity } from 'lucide-react';

import { getRunsView, seedAliasFor } from '@/lib/api';
import { OrchestratorUnreachable } from '@/components/OrchestratorNotice';
import { RealtimeRunsList } from '@/components/RealtimeRunsList';
import { RunStatusBadge } from '@/components/RunStatusBadge';
import { listRuns } from '@/lib/api';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { DemoStateCard } from '@/components/seeds/DemoStateCard';
import { EmptyState, PageHeader, SectionCard } from '@/components/shell';
import type { RunRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function fetchRuns(): Promise<ReadonlyArray<RunRecord>> {
  'use server';
  const res = await fetch(`${getApiBase()}/v1/runs`, {
    cache: 'no-store',
    headers: { 'x-fora-tenant-id': getDevTenantUuid() },
  });
  if (!res.ok) return [];
  return (await res.json()) as ReadonlyArray<RunRecord>;
}

export default async function IssueDashboard() {
  const view = await getRunsView();
  const initialRuns: ReadonlyArray<RunRecord> = view.state === 'ok' ? view.runs : [];

  return (
    <DashboardShell>
      <div className="space-y-8" data-testid="issue-dashboard">
        <PageHeader
          eyebrow="Dashboard"
          title="All runs"
          description="Realtime via WebSocket; polls every 5 s while the socket is reconnecting."
        />

        {/*
         * Plan G commit 4 — per-Center demo state. The card renders
         * nothing on non-demo tenants and surfaces the active seed's
         * status / row count / checksum drift in dev demos.
         */}
        <DemoStateCard seedName="acme-corp" />

        {view.state === 'unreachable' ? (
          <OrchestratorUnreachable view={view} />
        ) : null}

        {view.state === 'ok' ? (
          <SectionCard
            title="Runs"
            data-testid="dashboard-section"
          >
            <RealtimeRunsList
              initialRuns={initialRuns}
              fetcher={fetchRuns}
              hideActions
            />
          </SectionCard>
        ) : null}

        {view.state === 'empty' ? (
          <section data-testid="dashboard-empty-h">
            <EmptyState
              icon={<Activity className="h-5 w-5" aria-hidden="true" />}
              title="No runs yet"
              description="Seed demo-run-001 via ./scripts/dev-up.sh."
            />
          </section>
        ) : null}
      </div>
    </DashboardShell>
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