'use client';

/**
 * apps/forge/app/page.tsx — Forge's home (Sprint 1.1).
 *
 * Per HoP audit + user review: drop the "Start a new project" CTA
 * (already lives at /project-onboarding) and the OUTCOMES sidebar
 * group (duplicated existing entries). Home now focuses on moving
 * the user's CURRENT project through the 7-stage workflow.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  WorkflowProgressBar — spine of the app             │
 *   └──────────────────────────────────────────────────────┘
 *   ┌─ Continue where you left off ──────────────────────┐
 *   │ Resumes the stage the user is on (from localStorage).│
 *   └────────────────────────────────────────────────────┘
 *   ┌─ Recent activity ──────────────────────────────────┐
 *   │ (placeholder — Sprint 2 wires audit events)        │
 *   └────────────────────────────────────────────────────┘
 *
 * New users land here first; the "Start new project" path lives
 * at /project-onboarding (sidebar Lifecycle) and is intentionally
 * not surfaced on this page. This page is about advancing the
 * project that's already in flight.
 */

import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';

import { WorkflowProgressBar } from '@/components/workflow/workflow-progress-bar';
import { FIRST_STAGE, STAGES, stageIndex } from '@/lib/workflow/stages';
import { useWorkflowState } from '@/lib/workflow/use-workflow-state';

export default function HomePage() {
  const { state, isReady } = useWorkflowState();
  // ponytail: `state.current` is typed StageSlug; stageIndex always
  // returns a valid index for a valid slug, so the lookup is total.
  const slug = state.current ?? FIRST_STAGE;
  const currentStage = STAGES[stageIndex(slug)]!;
  const stageIdx = stageIndex(slug);

  return (
    <div className="flex flex-col gap-8 p-4 sm:p-6 md:p-8">
      <section className="flex flex-col gap-3">
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs uppercase tracking-wider text-sky-200">
          <Sparkles className="h-3 w-3" />
          Idea → Pull Request
        </p>
        <h1 className="text-2xl font-semibold text-slate-100 sm:text-3xl md:text-4xl">
          Move your current project to production.
        </h1>
        <p className="max-w-2xl text-sm text-slate-400">
          Forge walks seven governed stages from idea to pull request.
          The bar below tracks your progress; the card resumes the
          stage you were on.
        </p>
      </section>

      <WorkflowProgressBar
        current={currentStage.slug}
        completed={state.completed}
      />

      <section className="grid gap-4">
        <Link
          href={`/workflow/${currentStage.slug}`}
          className="group flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-5 transition-colors hover:border-sky-500/40 hover:bg-slate-900"
        >
          <span className="text-xs uppercase tracking-wider text-slate-500">
            Continue where you left off
          </span>
          <span className="flex items-center gap-2 text-base font-medium text-slate-100 sm:text-lg">
            {currentStage.verb}
            <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="text-sm text-slate-400">
            Stage {stageIdx + 1} of {STAGES.length}
            {' · '}
            {isReady ? 'ready to advance' : 'loading state…'}
          </span>
        </Link>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-5">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">
          Recent activity
        </h2>
        <p className="text-sm text-slate-400">
          Activity feed wires in Sprint 2 once audit events + stage
          state land in the backend. For now: open the stage you are
          on to keep moving.
        </p>
      </section>
    </div>
  );
}