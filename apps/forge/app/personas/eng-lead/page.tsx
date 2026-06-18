import Link from 'next/link';
import { listRuns, OrchestratorError } from '@/lib/api';
import { RunStatusBadge } from '@/components/RunStatusBadge';
import { RunActions } from '@/components/RunActions';
import { SEED_TENANT_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Engineering Lead dashboard — runs in flight, blocked work, cost.
 * Read + approve (pause/resume/cancel). This is the only persona that
 * renders the operator action bar (RunActions) per the FORA-374 spec.
 */
export default async function EngLeadDashboard() {
  const runs = await listRuns().catch((err) => {
    if (err instanceof OrchestratorError) return [];
    throw err;
  });

  const total = runs.reduce((acc, r) => acc + Number(r.cost_spent_usd), 0);
  const blocked = runs.filter(
    (r) => r.status === 'paused' || r.status === 'waiting_approval',
  );

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

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase text-forge-300">In flight</p>
          <p className="mt-1 text-3xl font-semibold">{runs.length}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Blocked / waiting</p>
          <p className="mt-1 text-3xl font-semibold">{blocked.length}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Cost (USD)</p>
          <p className="mt-1 font-mono text-3xl">${total.toFixed(2)}</p>
        </div>
      </section>

      <section className="card" aria-labelledby="inflight-h">
        <h2 id="inflight-h" className="text-lg font-semibold">Runs</h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-forge-200">
            No runs visible. The orchestrator is reachable but the seed run id
            (demo-run-001) is not present yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-3" data-testid="eng-runs-list">
            {runs.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-md border border-forge-200/40 p-3"
              >
                <div className="space-y-1">
                  <p className="font-mono text-xs">{r.id}</p>
                  <p className="text-xs text-forge-300">
                    stage <strong>{r.current_stage}</strong> · ceiling $
                    {r.cost_ceiling_usd}
                  </p>
                </div>
                <RunStatusBadge status={r.status} />
                <Link className="text-forge-300 underline" href={`/runs/${r.id}`}>
                  timeline
                </Link>
                <RunActions runId={r.id} status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}