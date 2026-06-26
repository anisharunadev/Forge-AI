import { getRunsView } from '@/lib/api';
import { OrchestratorUnreachable } from '@/components/OrchestratorNotice';
import { RealtimeRunsList } from '@/components/RealtimeRunsList';
import { SEED_TENANT_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Engineering Lead dashboard — runs in flight, blocked work, cost.
 * Read + approve (pause/resume/cancel). This is the only persona that
 * renders the operator action bar (RunActions) per the FORA-374 spec.
 *
 * FORA-379: the "Runs in flight" panel now renders real rows from the
 * orchestrator's `GET /v1/runs` index (seeded as `demo-run-001` by
 * `scripts/dev-up.sh`). Action buttons pause / resume / cancel flow
 * through `POST /v1/runs/{id}/{verb}` via the `RunActions` client
 * component. Blocked-work + cost panels read the same view; only when
 * the orchestrator is reachable AND empty do we render the
 * "No runs visible" empty state — when it's unreachable we render an
 * explicit `OrchestratorUnreachable` notice instead.
 */
async function fetchRunsForEngLead() {
  'use server';
  const next = await getRunsView();
  return next.state === 'ok' ? next.runs : [];
}

export default async function EngLeadDashboard() {
  const view = await getRunsView();

  const runs = view.state === 'ok' ? view.runs : [];
  const blocked = runs.filter(
    (r) => r.status === 'paused' || r.status === 'waiting_approval',
  );
  const total = runs.reduce((acc, r) => acc + Number(r.cost_spent_usd), 0);

  return (
    <div className="space-y-8" data-testid="eng-lead-dashboard">
      <header>
        <p className="text-xs uppercase tracking-wider text-forge-300">Persona</p>
        <h1 className="text-2xl font-semibold">Engineering Lead</h1>
        <p className="text-sm text-forge-200">
          Tenant {SEED_TENANT_NAME}. Read + operate. Use the action bar to pause, resume,
          or cancel a run.
        </p>
      </header>

      {view.state === 'unreachable' ? (
        <OrchestratorUnreachable view={view} />
      ) : null}

      <section className="grid gap-4 md:grid-cols-3" aria-labelledby="kpis-h">
        <h2 id="kpis-h" className="sr-only">Key indicators</h2>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Runs in flight</p>
          <p className="mt-1 text-3xl font-semibold" data-testid="kpi-inflight">
            {view.state === 'ok' ? runs.length : '—'}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Blocked / waiting</p>
          <p className="mt-1 text-3xl font-semibold" data-testid="kpi-blocked">
            {view.state === 'ok' ? blocked.length : '—'}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Cost (USD)</p>
          <p className="mt-1 font-mono text-3xl" data-testid="kpi-cost">
            {view.state === 'ok' ? `$${total.toFixed(2)}` : '—'}
          </p>
        </div>
      </section>

      <section className="card" aria-labelledby="inflight-h">
        <h2 id="inflight-h" className="text-lg font-semibold">Runs in flight</h2>
        {view.state === 'ok' ? (
          <RealtimeRunsList
            initialRuns={runs}
            fetcher={fetchRunsForEngLead}
          />
        ) : view.state === 'empty' ? (
          <div data-testid="eng-empty">
            <p className="mt-2 text-sm text-forge-200">
              No runs visible. The orchestrator is reachable but returned an empty list —
              seed <code>demo-run-001</code> via <code>./scripts/dev-up.sh</code>.
            </p>
            <p className="mt-2 text-xs text-forge-300">
              No blocked work.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-forge-300" data-testid="eng-suppressed">
            Runs in flight data unavailable — see notice above.
          </p>
        )}
      </section>
    </div>
  );
}