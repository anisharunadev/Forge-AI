/**
 * `/workflow/[stage]` — the canonical stage page.
 *
 * Per Sprint 3 (production-grade the stages), each stage page is
 * rendered through `StagePanel`, which composes the production-grade
 * sub-components (banner, error boundary, skeleton, empty state).
 *
 * Today, every stage deep-links to the underlying center for the
 * heavy interactive UI; the stage page surfaces the heading, the
 * banner, and a "Open workspace" CTA. The center URL is preserved
 * exactly so power users can bookmark it.
 *
 * When a stage has a typed preview (e.g. the Idea stage surfaces the
 * user's most recent ideas), the panel renders that preview inside
 * the panel body. Adding previews is the next iteration.
 */

import * as React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StagePanel } from '@/components/workflow-shell';
import {
  getNextStage,
  getStage,
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_IDS,
} from '@/lib/workflow-shell/stages';
import type { WorkflowStageId } from '@/lib/workflow-shell/types';

interface PageProps {
  readonly params: Promise<{ stage: string }>;
}

function isStageId(value: string): value is WorkflowStageId {
  return (WORKFLOW_STAGE_IDS as ReadonlyArray<string>).includes(value);
}

export function generateStaticParams() {
  return WORKFLOW_STAGES.map((stage) => ({ stage: stage.id }));
}

export default async function WorkflowStagePage({ params }: PageProps) {
  const { stage: rawStage } = await params;
  if (!isStageId(rawStage)) {
    notFound();
  }
  const stage = getStage(rawStage);
  const next = getNextStage(rawStage);

  return (
    <div
      data-testid={`workflow-stage-page-${stage.id}`}
      className="flex flex-col gap-6"
    >
      <StagePanel
        stage={stage.id}
        isLoading={false}
        isError={false}
        isSuccess={true}
        skeletonRows={3}
        emptyTitle={`No ${stage.label.toLowerCase()} yet`}
        emptyDescription={`This is where your ${stage.label.toLowerCase()} work will appear once you start. Forge keeps the workflow spine visible while the underlying center loads.`}
      >
        <Card data-testid="workflow-stage-header" className="border-border bg-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-xl">{stage.label}</CardTitle>
              <span className="rounded-full border border-border bg-card/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Stage {WORKFLOW_STAGE_IDS.indexOf(stage.id) + 1} / {WORKFLOW_STAGE_IDS.length}
              </span>
            </div>
            <CardDescription>{stage.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button asChild variant="default" size="default">
              <Link
                href={stage.centerPath}
                data-testid={`workflow-stage-open-${stage.id}`}
                aria-label={`Open ${stage.label} workspace`}
              >
                Open {stage.label} workspace
              </Link>
            </Button>
            {next ? (
              <Button asChild variant="outline" size="default">
                <Link
                  href={`/workflow/${next.id}`}
                  data-testid={`workflow-stage-next-${stage.id}`}
                  aria-label={`Skip to next stage: ${next.label}`}
                >
                  Skip to {next.label}
                </Link>
              </Button>
            ) : (
              <span
                data-testid={`workflow-stage-final-${stage.id}`}
                className="text-xs text-muted-foreground"
              >
                Final stage — your idea is in production.
              </span>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Underlying center</CardTitle>
            <CardDescription>
              This stage deep-links to <code className="font-mono">{stage.centerPath}</code>.
              The full {stage.label} experience lives there; this page exists to keep the
              workflow spine visible.
            </CardDescription>
          </CardHeader>
        </Card>
      </StagePanel>
    </div>
  );
}