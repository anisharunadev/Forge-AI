import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getRun,
  getRunStages,
  OrchestratorError,
} from '@/lib/api';
import { RunStatusBadge } from '@/components/RunStatusBadge';
import { RunActions } from '@/components/RunActions';
import { RealtimeTimeline } from '@/components/RealtimeTimeline';

export const dynamic = 'force-dynamic';

export default async function RunDetailPage({
  params,
}: {
  params: { id: string };
}) {
  try {
    const [run, stages] = await Promise.all([
      getRun(params.id),
      getRunStages(params.id),
    ]);

    return (
      <div className="space-y-6" data-testid="run-detail">
        <header className="card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-forge-300">Run</p>
              <h1 className="font-mono text-xl">{run.id}</h1>
              <p className="mt-1 text-sm text-forge-200">
                goal <code>{run.goal_id}</code> · project <code>{run.project_id}</code>{' '}
                · tenant <code>{run.tenant_id}</code>
              </p>
              <p className="text-xs text-forge-300">
                triggered by {run.triggered_by.type}/{run.triggered_by.actor}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <RunStatusBadge status={run.status} />
              <p className="font-mono text-xs">
                ${run.cost_spent_usd} / ${run.cost_ceiling_usd}
              </p>
              <RunActions runId={run.id} status={run.status} />
            </div>
          </div>
        </header>

        <RealtimeTimeline
          runId={run.id}
          initialCurrentStage={run.current_stage}
          initialStages={stages}
          fetcher={async () => {
            const [r, s] = await Promise.all([getRun(params.id), getRunStages(params.id)]);
            return { currentStage: r.current_stage, stages: s };
          }}
        />

        <p className="text-sm">
          <Link href="/personas/eng-lead" className="underline">
            ← back to Engineering Lead
          </Link>
        </p>
      </div>
    );
  } catch (err) {
    if (err instanceof OrchestratorError && err.status === 404) notFound();
    throw err;
  }
}