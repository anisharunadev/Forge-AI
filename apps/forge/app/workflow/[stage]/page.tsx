/**
 * `/workflow/[stage]` — the canonical stage page.
 *
 * The seven stages (`idea`, `prd`, `architecture`, `tasks`,
 * `approval`, `develop`, `pr`) all render through this single
 * dynamic route. Each stage renders a StagePanel that:
 *
 *   1. Tells the user what stage they're on and why it matters.
 *   2. Embeds the underlying center's primary content (today, as a
 *      redirect/iframe; tomorrow, as a full embedded view).
 *   3. Surfaces a "Next" CTA that advances to the following stage.
 *
 * Unknown stage ids are caught by `notFound()` so a typo never
 * silently renders an empty page.
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
    </div>
  );
}