import { STAGES_IN_ORDER, type Stage, type StageRecord } from '@/lib/types';
import { indexStages } from '@/lib/api';

const STAGE_LABELS: Record<Stage, string> = {
  ideation: 'Ideation',
  architect: 'Architect',
  dev: 'Developer',
  qa: 'QA',
  security: 'Security',
  devops: 'DevOps',
  docs: 'Documentation',
};

export interface TimelineProps {
  runId: string;
  currentStage: Stage | 'done';
  stages: ReadonlyArray<StageRecord>;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const stageBadgeClass: Record<string, string> = {
  pending: 'bg-stage-pending/20 text-stage-pending',
  running: 'bg-stage-running/20 text-stage-running',
  waiting_approval: 'bg-stage-waiting_approval/20 text-stage-waiting_approval',
  approved: 'bg-stage-approved/20 text-stage-approved',
  rejected: 'bg-stage-rejected/20 text-stage-rejected',
  returned: 'bg-stage-returned/20 text-stage-returned',
  skipped: 'bg-stage-skipped/20 text-stage-skipped',
};

/**
 * Render the seven `agent_run_stages` rows (ideation → architect → dev
 * → qa → security → devops → docs) with status, started_at, ended_at,
 * and a current-stage marker. Reads the rows straight from the
 * orchestrator via the parent RSC; no client-side data fetching.
 */
export function Timeline({ runId, currentStage, stages }: TimelineProps) {
  const byStage = indexStages(stages);
  return (
    <section
      aria-label={`Run ${runId} stage timeline`}
      className="card overflow-x-auto"
      data-testid="timeline"
    >
      <h2 className="mb-4 text-lg font-semibold">Stage timeline</h2>
      <ol className="flex min-w-[700px] flex-col gap-2" role="list">
        {STAGES_IN_ORDER.map((stage) => {
          const row = byStage.get(stage) ?? null;
          const status = row?.status ?? 'pending';
          const isCurrent =
            currentStage === stage &&
            (status === 'running' || status === 'waiting_approval');
          return (
            <li
              key={stage}
              className={`flex items-center justify-between rounded-md border px-4 py-3 ${
                isCurrent
                  ? 'border-forge-400 bg-forge-50 dark:bg-forge-800/40'
                  : 'border-forge-200 dark:border-forge-700'
              }`}
              data-stage={stage}
              data-status={status}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`badge ${stageBadgeClass[status] ?? 'bg-stage-pending/20 text-stage-pending'}`}
                  data-testid={`stage-badge-${stage}`}
                >
                  {status.replace('_', ' ')}
                </span>
                <span className="font-medium">{STAGE_LABELS[stage]}</span>
                {isCurrent ? (
                  <span className="badge bg-forge-500 text-white" data-testid="current-stage-marker">
                    current
                  </span>
                ) : null}
              </div>
              <div className="flex gap-6 text-xs text-forge-300">
                <span>
                  <span className="text-forge-200">started</span> {fmtTime(row?.started_at ?? null)}
                </span>
                <span>
                  <span className="text-forge-200">ended</span> {fmtTime(row?.finished_at ?? null)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}