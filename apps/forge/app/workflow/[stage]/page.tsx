'use client';

/**
 * apps/forge/app/workflow/[stage]/page.tsx — single dynamic route that
 * serves all 7 golden-workflow stages (Sprint 1, HoP reset).
 *
 * Client component: reads URL params via `useParams()` and stage state
 * via `useWorkflowState()`. URL is authoritative for `current` (so the
 * bar always agrees with where the user clicked); hook owns the
 * `completed[]` list and persists to localStorage.
 *
 * Ponytail: thin route — heavy lifting stays in the existing centers.
 * Sprint 2 inlines the center bodies here.
 */

import { notFound, useParams } from 'next/navigation';

import { WorkflowProgressBar } from '@/components/workflow/workflow-progress-bar';
import {
  getStage,
  isValidStage,
  nextStage,
  stageIndex,
  STAGES
} from '@/lib/workflow/stages';
import { useWorkflowState } from '@/lib/workflow/use-workflow-state';

export default function WorkflowStagePage() {
  const params = useParams<{ stage: string }>();
  const stage = String(params?.stage ?? '');

  if (!isValidStage(stage)) {
    notFound();
  }
  const target = getStage(stage);
  if (!target) {
    notFound();
  }

  const idx = stageIndex(stage);
  const next = nextStage(stage);
  const { state, markComplete, setCurrent } = useWorkflowState();
  const isCompleted = state.completed.includes(stage);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-slate-500">
          Golden workflow · stage {idx + 1} of {STAGES.length}
        </p>
        <h1 className="text-2xl font-semibold text-slate-100 sm:text-3xl">
          {target.verb}
        </h1>
        <p className="max-w-2xl text-sm text-slate-400">
          {target.description}
        </p>
      </header>

      <WorkflowProgressBar current={stage} completed={state.completed} />

      <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-300">
        <p className="text-slate-400">
          This stage opens the existing center at{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200">
            {target.route}
          </code>
          . Inline embedding lands in Sprint 2; the URL above is live now.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={target.route}
            className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
          >
            Open {target.label} center →
          </a>
          <button
            type="button"
            onClick={() => markComplete(stage)}
            disabled={isCompleted}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCompleted ? '✓ Marked complete' : 'Mark this stage complete'}
          </button>
          {next && (
            <button
              type="button"
              onClick={() => {
                markComplete(stage);
                setCurrent(next);
              }}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20"
            >
              Advance to {getStage(next)?.label} →
            </button>
          )}
        </div>
      </section>
    </div>
  );
}