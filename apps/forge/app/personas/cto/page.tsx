import Link from 'next/link';
import { listRuns, OrchestratorError } from '@/lib/api';
import { SEED_TENANT_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * CTO / VP Eng dashboard — throughput, MTTR, audit log, cost by team.
 *
 * v1 surfaces the run list as a "cost by goal" rollup; richer
 * throughput / MTTR numbers wait on the metrics endpoint (planned in
 * FORA-50 §4.1, not yet shipped). Audit log reads the
 * `.fora/audit/customer-cloud-broker.jsonl` file when present — for
 * v1 we render an inline "audit log: view at <path>" pointer.
 */
export default async function CtoDashboard() {
  const runs = await listRuns().catch((err) => {
    if (err instanceof OrchestratorError) return [];
    throw err;
  });

  const total = runs.reduce((acc, r) => acc + Number(r.cost_spent_usd), 0);
  const costByGoal = new Map<string, number>();
  for (const r of runs) {
    costByGoal.set(r.goal_id, (costByGoal.get(r.goal_id) ?? 0) + Number(r.cost_spent_usd));
  }

  return (
    <div className="space-y-8" data-testid="cto-dashboard">
      <header>
        <p className="text-xs uppercase tracking-wider text-forge-300">Persona</p>
        <h1 className="text-2xl font-semibold">CTO / VP Eng</h1>
        <p className="text-sm text-forge-200">
          Tenant {SEED_TENANT_NAME}. Org-wide health, throughput, cost.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Active runs</p>
          <p className="mt-1 text-3xl font-semibold">{runs.length}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Cost (USD)</p>
          <p className="mt-1 font-mono text-3xl">${total.toFixed(2)}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">MTTR</p>
          <p className="mt-1 text-3xl font-semibold">—</p>
          <p className="text-xs text-forge-300">awaits metrics endpoint</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Throughput</p>
          <p className="mt-1 text-3xl font-semibold">—</p>
          <p className="text-xs text-forge-300">awaits metrics endpoint</p>
        </div>
      </section>

      <section className="card" aria-labelledby="costbygoal-h">
        <h2 id="costbygoal-h" className="text-lg font-semibold">Cost by goal</h2>
        {costByGoal.size === 0 ? (
          <p className="mt-2 text-sm text-forge-200">No cost data — no runs visible.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs uppercase text-forge-300">
              <tr>
                <th className="py-2">Goal</th>
                <th className="py-2 text-right">USD</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...costByGoal.entries()].map(([goal, cost]) => (
                <tr key={goal} className="border-t border-forge-200/40">
                  <td className="py-2 font-mono text-xs">{goal}</td>
                  <td className="py-2 text-right font-mono text-xs">${cost.toFixed(2)}</td>
                  <td className="py-2 text-right">
                    <Link className="text-forge-300 underline" href="/personas/eng-lead">
                      drill in
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" aria-labelledby="audit-h">
        <h2 id="audit-h" className="text-lg font-semibold">Audit log</h2>
        <p className="mt-2 text-sm text-forge-200">
          Production audit lives at{' '}
          <code>$FORA_AUDIT_LOG</code> and the broker audit at{' '}
          <code>$FORA_CCB_AUDIT_LOG_PATH</code>. The Forge console is read-only
          over the orchestrator; raw audit events are best read with{' '}
          <code>jq</code> from the local dev stack.
        </p>
      </section>
    </div>
  );
}