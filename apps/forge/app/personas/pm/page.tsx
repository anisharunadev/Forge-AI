import Link from 'next/link';
import { listRuns, OrchestratorError } from '@/lib/api';
import { RunStatusBadge } from '@/components/RunStatusBadge';
import { SEED_TENANT_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Product Manager dashboard — PRDs, roadmap, capacity. Read-only.
 *
 * For v1 the "PRD" surface reads the run list and renders each goal
 * with its current stage and cost; the richer PRD feed is owned by
 * the DocAgent (FORA-23). The roadmap timeline is a static Q-by-Q
 * placeholder until the Goal/Project metadata API ships.
 */
export default async function PmDashboard() {
  const runs = await listRuns().catch((err) => {
    if (err instanceof OrchestratorError) return [];
    throw err;
  });

  return (
    <div className="space-y-8" data-testid="pm-dashboard">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-forge-300">Persona</p>
          <h1 className="text-2xl font-semibold">Product Manager</h1>
          <p className="text-sm text-forge-200">
            Tenant {SEED_TENANT_NAME}. Read-only view over goals, runs, and stage progress.
          </p>
        </div>
      </header>

      <section className="card" aria-labelledby="runs-h">
        <h2 id="runs-h" className="text-lg font-semibold">Active runs</h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-forge-200">
            No runs yet. The seed tenant has no demo-run-001 — start one from the
            Engineering Lead dashboard or POST to <code>/v1/runs</code>.
          </p>
        ) : (
          <table className="mt-4 w-full text-sm" data-testid="runs-table">
            <thead className="text-left text-xs uppercase text-forge-300">
              <tr>
                <th className="py-2">Run</th>
                <th className="py-2">Goal</th>
                <th className="py-2">Status</th>
                <th className="py-2">Stage</th>
                <th className="py-2 text-right">Spent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-forge-200/40">
                  <td className="py-2 font-mono text-xs">{r.id}</td>
                  <td className="py-2 font-mono text-xs">{r.goal_id}</td>
                  <td className="py-2"><RunStatusBadge status={r.status} /></td>
                  <td className="py-2">{r.current_stage}</td>
                  <td className="py-2 text-right font-mono text-xs">${r.cost_spent_usd}</td>
                  <td className="py-2 text-right">
                    <Link className="text-forge-300 underline" href={`/runs/${r.id}`}>
                      timeline
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" aria-labelledby="roadmap-h">
        <h2 id="roadmap-h" className="text-lg font-semibold">Roadmap</h2>
        <p className="mt-2 text-sm text-forge-200">
          Roadmap data ships with the Goal/Project metadata API. The DocAgent-generated
          roadmap lives at <code>/docs/roadmap</code>; see{' '}
          <Link href="/personas/cto" className="underline">CTO dashboard</Link> for
          throughput &amp; cost.
        </p>
        <div className="mt-4 grid grid-cols-4 gap-3 text-xs">
          {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
            <div key={q} className="rounded-md border border-forge-200/40 p-3">
              <p className="font-semibold">{q}</p>
              <p className="mt-1 text-forge-300">Capacity placeholder</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}