import Link from 'next/link';
import { getRunsView, getRunStages, seedAliasFor, OrchestratorError } from '@/lib/api';
import { OrchestratorUnreachable } from '@/components/OrchestratorNotice';
import { SEED_TENANT_NAME } from '@/lib/auth';
import type { RunRecord, StageRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * CTO / VP Eng dashboard — throughput, MTTR, audit log, cost by team.
 *
 * FORA-379: every panel now derives numbers from the orchestrator's
 * `GET /v1/runs` (and `/v1/runs/{id}/stages` for stage-level metrics).
 * The seed run from `scripts/dev-up.sh` (`demo-run-001`) gives us
 * deterministic numbers to render against:
 *   - 1 run, goal `demo-goal-forge`, status `running`, stage `architect`,
 *     spent $0 of $100 ceiling.
 *   - 3 started stages (ideation finished, architect + dev running),
 *     4 pending (qa/security/devops/docs).
 *   - 1 finished stage (ideation, 3 min duration) → throughput floor.
 *
 * When the orchestrator is unreachable, the same `OrchestratorUnreachable`
 * notice from the PM/EngLead pages replaces the metrics with `—` and an
 * honest explanation.
 */

interface StageMetrics {
  started: number; // non-pending stages
  finished: number; // finished + approved
  pending: number;
  totalDurationMs: number; // sum of durations across started stages
  decisions: ReadonlyArray<{
    stage: StageRecord['stage'];
    by: string;
    at: string;
    reason?: string;
  }>;
}

function computeStageMetrics(stages: ReadonlyArray<StageRecord>): StageMetrics {
  let started = 0;
  let finished = 0;
  let pending = 0;
  let totalDurationMs = 0;
  const decisions: Array<{
    stage: StageRecord['stage'];
    by: string;
    at: string;
    reason?: string;
  }> = [];

  for (const s of stages) {
    if (s.status === 'pending') {
      pending += 1;
      continue;
    }
    started += 1;
    if (s.started_at) {
      const start = Date.parse(s.started_at);
      const end = s.finished_at ? Date.parse(s.finished_at) : Date.now();
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        totalDurationMs += end - start;
      }
    }
    // Terminal stage statuses (FORA-50 §3.2): approved | rejected |
    // returned | skipped. `running` and `waiting_approval` are not yet
    // terminal, so they don't count toward the finished-stage rollup
    // that drives the throughput number.
    if (
      s.status === 'approved' ||
      s.status === 'rejected' ||
      s.status === 'returned' ||
      s.status === 'skipped'
    ) {
      finished += 1;
    }
    if (s.decision) {
      decisions.push({
        stage: s.stage,
        by: s.decision.by,
        at: s.decision.at,
        reason: s.decision.reason,
      });
    }
  }
  return { started, finished, pending, totalDurationMs, decisions };
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (totalMin < 60) return remSec === 0 ? `${totalMin}m` : `${totalMin}m ${remSec}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default async function CtoDashboard() {
  const view = await getRunsView();

  // Stage-level metrics — best-effort. If the orchestrator is up but the
  // stages endpoint fails for a single run, we still render the rest of
  // the page with the message we got, instead of throwing a 500.
  let stageError: string | null = null;
  let stages: ReadonlyArray<StageRecord> = [];
  if (view.state === 'ok') {
    const first: RunRecord = view.runs[0]!;
    try {
      stages = await getRunStages(first.id);
    } catch (err) {
      stageError =
        err instanceof OrchestratorError
          ? `${err.status > 0 ? `HTTP ${err.status} — ` : ''}${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
    }
  }
  const metrics = computeStageMetrics(stages);

  // Cost-by-goal rollup (already works against the runs view).
  const costByGoal = new Map<string, number>();
  if (view.state === 'ok') {
    for (const r of view.runs) {
      costByGoal.set(r.goal_id, (costByGoal.get(r.goal_id) ?? 0) + Number(r.cost_spent_usd));
    }
  }
  const totalCost = [...costByGoal.values()].reduce((a, b) => a + b, 0);

  // MTTR proxy: average duration of started stages. With the seed's 3
  // started stages (ideation 3m, architect 10m, dev 5m so far) this
  // yields a real, renderable number. We label it "MTTR (avg stage
  // duration, n=N)" so the metric is honest about its derivation.
  const avgDurationMs =
    metrics.started > 0 ? Math.round(metrics.totalDurationMs / metrics.started) : 0;

  // Throughput: finished stages per hour. With 1 stage finished in
  // ~15 min, this is the floor of 4/hr; for v1 we render the raw
  // counts and let the user extrapolate. The metrics endpoint
  // (FORA-50 §4.1 backlog) will replace this with a server-side rollup.
  const throughputText =
    metrics.finished === 0
      ? '0'
      : `${metrics.finished} stage${metrics.finished === 1 ? '' : 's'} finished`;

  return (
    <div className="space-y-8" data-testid="cto-dashboard">
      <header>
        <p className="text-xs uppercase tracking-wider text-forge-300">Persona</p>
        <h1 className="text-2xl font-semibold">CTO / VP Eng</h1>
        <p className="text-sm text-forge-200">
          Tenant {SEED_TENANT_NAME}. Org-wide health, throughput, cost.
        </p>
      </header>

      {view.state === 'ok' ? (
        <p className="text-xs text-forge-300" data-testid="cto-seed-ref">
          Metrics computed from {view.runs.length} active run
          {view.runs.length === 1 ? '' : 's'}
          {view.runs.length === 1 && seedAliasFor(view.runs[0]!.id)
            ? ` (seed: ${seedAliasFor(view.runs[0]!.id)})`
            : ''}.
        </p>
      ) : null}

      {view.state === 'unreachable' ? (
        <OrchestratorUnreachable view={view} />
      ) : null}

      <section className="grid gap-4 md:grid-cols-4" aria-labelledby="cto-kpis-h">
        <h2 id="cto-kpis-h" className="sr-only">Key indicators</h2>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Active runs</p>
          <p className="mt-1 text-3xl font-semibold" data-testid="kpi-active">
            {view.state === 'ok' ? view.runs.length : '—'}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Throughput</p>
          <p
            className="mt-1 text-3xl font-semibold"
            data-testid="kpi-throughput"
            title="Finished stages from the orchestrator; richer numbers wait on the metrics endpoint."
          >
            {view.state === 'ok' ? throughputText : '—'}
          </p>
          <p className="text-xs text-forge-300">finished stages (seed run)</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">MTTR</p>
          <p
            className="mt-1 text-3xl font-semibold"
            data-testid="kpi-mttr"
            title="Average stage duration across started stages from the seed run. Real MTTR (approval-decision latency) waits on the metrics endpoint."
          >
            {view.state === 'ok' && metrics.started > 0
              ? formatDuration(avgDurationMs)
              : '—'}
          </p>
          <p className="text-xs text-forge-300">
            avg stage duration, n={metrics.started}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-forge-300">Cost (USD)</p>
          <p className="mt-1 font-mono text-3xl" data-testid="kpi-cost">
            {view.state === 'ok' ? `$${totalCost.toFixed(2)}` : '—'}
          </p>
        </div>
      </section>

      <section className="card" aria-labelledby="costbygoal-h">
        <h2 id="costbygoal-h" className="text-lg font-semibold">Cost by goal</h2>
        {view.state === 'ok' && costByGoal.size > 0 ? (
          <table className="mt-4 w-full text-sm" data-testid="cost-by-goal">
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
        ) : view.state === 'empty' ? (
          <p className="mt-2 text-sm text-forge-200" data-testid="cost-empty">
            No cost data — orchestrator returned an empty run list.
          </p>
        ) : (
          <p className="mt-2 text-sm text-forge-300">Cost-by-goal unavailable — see notice above.</p>
        )}
      </section>

      <section className="card" aria-labelledby="audit-h">
        <h2 id="audit-h" className="text-lg font-semibold">Audit log</h2>
        {view.state === 'ok' ? (
          <div data-testid="audit-log">
            {metrics.decisions.length === 0 ? (
              <p className="mt-2 text-sm text-forge-200">
                No stage decisions recorded yet. Production audit lives at{' '}
                <code>$FORA_AUDIT_LOG</code> and the broker audit at{' '}
                <code>$FORA_CCB_AUDIT_LOG_PATH</code>; raw events are best read with{' '}
                <code>jq</code>.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-forge-200">
                  Stage decisions from the orchestrator (seed run shows the
                  system decision that advanced ideation → architect). Production
                  audit lives at <code>$FORA_AUDIT_LOG</code>.
                </p>
                <ul className="mt-3 space-y-1 font-mono text-xs" data-testid="audit-events">
                  {metrics.decisions.map((d) => (
                    <li
                      key={`${d.stage}-${d.at}`}
                      className="rounded border border-forge-200/40 p-2"
                    >
                      <span className="text-forge-300">{d.at}</span>{' '}
                      <strong>{d.stage}</strong> decided by <em>{d.by}</em>
                      {d.reason ? <> — {d.reason}</> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : view.state === 'empty' ? (
          <p className="mt-2 text-sm text-forge-200">
            No audit events — orchestrator returned an empty run list.
          </p>
        ) : (
          <p className="mt-2 text-sm text-forge-300">Audit log unavailable — see notice above.</p>
        )}
      </section>

      {stageError ? (
        <p className="text-xs text-amber-300" role="status" data-testid="stage-error">
          Stage metrics unavailable for the seed run: {stageError}. Throughput and
          MTTR show as `—` until the stages endpoint recovers.
        </p>
      ) : null}
    </div>
  );
}