/**
 * `/workflow/*` layout — wraps every stage page with the
 * `WorkflowProgressBar` and (M20) the `HeroJourneyBanner`.
 *
 * Per M20 (Phase C — Experience):
 *   - The progress bar still shows "where in the workflow you are"
 *     (the 7 stages).
 *   - The hero journey banner shows "what you should do next" + the
 *     elapsed time since you started the journey.
 *
 * The hero journey banner reads the current stage from the URL via
 * the layout's `params` slot; for static segments we re-use the
 * `<HeroJourneySlot>` sub-component that resolves the stage from
 * `usePathname()`.
 */

import * as React from 'react';
import { Suspense } from 'react';
import { headers } from 'next/headers';

import { HeroJourneyBanner } from '@/components/workflow-shell';
import { WorkflowProgressBar } from '@/components/workflow-shell';
import { WORKFLOW_STAGES, WORKFLOW_STAGE_IDS } from '@/lib/workflow-shell/stages';
import type { WorkflowStageId, WorkflowProgress } from '@/lib/workflow-shell/types';

const DEFAULT_PROGRESS: WorkflowProgress = {
  projectId: 'placeholder',
  stages: WORKFLOW_STAGES.map((stage, idx) => ({
    id: stage.id,
    status: idx === 0 ? 'current' : 'pending',
  })),
  currentStage: WORKFLOW_STAGES[0]!.id,
};

function ProgressBarFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="workflow-progress-bar-fallback"
      className="h-9 rounded-lg border border-border bg-card/60"
    />
  );
}

/**
 * `HeroJourneySlot` — client subcomponent that resolves the stage
 * from the URL pathname (`/workflow/[stage]`) and renders the
 * `HeroJourneyBanner`. Kept client-side because it reads
 * `localStorage` for the journey start timestamp.
 */
function HeroJourneySlot({ stage }: { stage: WorkflowStageId }) {
  return <HeroJourneyBanner stage={stage} />;
}

/**
 * Server-side stage resolution. The current Next.js App Router
 * does not expose route params to `layout.tsx`, so we read the
 * pathname from the `x-pathname` header (set by the proxy) or
 * fall back to `'idea'` (the first stage) when unavailable.
 */
function isStageId(value: string): value is WorkflowStageId {
  return (WORKFLOW_STAGE_IDS as ReadonlyArray<string>).includes(value);
}

async function resolveStageFromHeaders(): Promise<WorkflowStageId> {
  // `headers()` is async in Next 15+. The header is set by our
  // `proxy.ts` (or `middleware.ts` for the legacy Next 15 surface).
  try {
    const h = await headers();
    const candidate = h.get('x-pathname') ?? h.get('x-invoke-path') ?? '';
    const match = candidate.match(/\/workflow\/([a-z]+)/);
    if (match && match[1] && isStageId(match[1])) return match[1];
  } catch {
    /* headers() not available — fall through */
  }
  return 'idea';
}

export default async function WorkflowLayout({ children }: { children: React.ReactNode }) {
  const stage = await resolveStageFromHeaders();
  return (
    <div
      data-testid="workflow-layout"
      className="flex flex-col gap-4 px-4 py-6 md:px-6 lg:px-8"
    >
      <Suspense fallback={<ProgressBarFallback />}>
        <WorkflowProgressBar progress={DEFAULT_PROGRESS} />
      </Suspense>
      <HeroJourneySlot stage={stage} />
      {children}
    </div>
  );
}