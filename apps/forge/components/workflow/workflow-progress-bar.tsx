'use client';

/**
 * apps/forge/components/workflow/workflow-progress-bar.tsx — the spine
 * of Forge's golden workflow (Sprint 1, HoP reset).
 *
 * Client component — reads stage progress from localStorage via
 * `useWorkflowState` so the ✓ ▶ ○ semantics work across navigations.
 * Props are accepted as overrides for SSR / tests; default is the
 * hook.
 *
 * The small hydration flash (server renders default state, client
 * re-renders with stored state) is intentional — `suppressHydration
 * Warning` keeps React quiet about it.
 */

import Link from 'next/link';
import { ArrowRight, Check, Circle, Play } from 'lucide-react';

import { STAGES, type StageSlug } from '@/lib/workflow/stages';
import { useWorkflowState } from '@/lib/workflow/use-workflow-state';

interface Props {
  /** Override the current stage (e.g. when the URL is authoritative). */
  current?: StageSlug;
  /** Override completed stages (skip hook read). */
  completed?: ReadonlyArray<StageSlug>;
}

export function WorkflowProgressBar(props: Props) {
  const hook = useWorkflowState();
  const current = props.current ?? hook.state.current;
  const completed = props.completed ?? hook.state.completed;

  const completedSet = new Set<StageSlug>(completed);
  const currentIndex = STAGES.findIndex((s) => s.slug === current);

  return (
    <nav
      aria-label="Workflow progress"
      suppressHydrationWarning
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-3 sm:gap-2 sm:px-4"
    >
      {STAGES.map((stage, idx) => {
        const isCompleted = completedSet.has(stage.slug);
        const isCurrent = stage.slug === current;
        const isPast = idx < currentIndex;

        return (
          <Link
            key={stage.slug}
            href={`/workflow/${stage.slug}`}
            aria-current={isCurrent ? 'step' : undefined}
            className={[
              'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors sm:text-sm',
              isCurrent
                ? 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/40'
                : isCompleted || isPast
                  ? 'text-emerald-300 hover:bg-emerald-500/10'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
            ].join(' ')}
          >
            <StageIcon completed={isCompleted || isPast} current={isCurrent} />
            <span className="font-medium">{stage.label}</span>
            {idx < STAGES.length - 1 && (
              <ArrowRight
                className="h-3 w-3 text-slate-600"
                aria-hidden="true"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function StageIcon({
  completed,
  current,
}: {
  completed: boolean;
  current: boolean;
}) {
  if (completed) {
    return <Check className="h-4 w-4 text-emerald-400" aria-label="Done" />;
  }
  if (current) {
    return (
      <Play
        className="h-3.5 w-3.5 fill-sky-400 text-sky-400"
        aria-label="Current"
      />
    );
  }
  return <Circle className="h-4 w-4 text-slate-600" aria-label="Pending" />;
}