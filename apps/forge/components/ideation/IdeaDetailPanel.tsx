'use client';

import * as React from 'react';
import { Lightbulb, AlertTriangle, FileText } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScoreBadge } from './ScoreBadge';
import type { Idea } from '@/lib/ideation/data';

export interface IdeaDetailPanelProps {
  idea: Idea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IdeaDetailPanel({
  idea,
  open,
  onOpenChange,
}: IdeaDetailPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl"
        data-testid="idea-detail-panel"
      >
        {idea ? (
          <div className="flex h-full flex-col gap-4 overflow-y-auto pr-2">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5" aria-hidden="true" />
                {idea.title}
              </SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs">{idea.id}</span> · created{' '}
                {new Date(idea.createdAt).toLocaleDateString()}
              </SheetDescription>
            </SheetHeader>

            <div className="flex items-center gap-2">
              <ScoreBadge score={idea.score} />
              <Badge variant="outline">{idea.status}</Badge>
              <Badge variant="outline">{idea.impact} impact</Badge>
            </div>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Summary
              </h3>
              <p className="text-sm text-forge-100">{idea.summary}</p>
            </section>

            <Separator />

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Score breakdown
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-forge-300">Impact</dt>
                <dd className="font-mono">{idea.scoreBreakdown.impact}/10</dd>
                <dt className="text-forge-300">Feasibility</dt>
                <dd className="font-mono">
                  {idea.scoreBreakdown.feasibility}/10
                </dd>
                <dt className="text-forge-300">Confidence</dt>
                <dd className="font-mono">
                  {idea.scoreBreakdown.confidence}/10
                </dd>
                <dt className="text-forge-300">Effort</dt>
                <dd className="font-mono">{idea.scoreBreakdown.effort}/10</dd>
              </dl>
            </section>

            <Separator />

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Analysis
              </h3>
              <p className="text-sm text-forge-100">{idea.analysis}</p>
            </section>

            {idea.risks.length > 0 ? (
              <section>
                <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  Risks
                </h3>
                <ul className="list-inside list-disc text-sm text-forge-100">
                  {idea.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {idea.prdRef ? (
              <section>
                <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  PRD
                </h3>
                <p className="font-mono text-xs text-forge-100">{idea.prdRef}</p>
              </section>
            ) : null}

            <Separator />

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Owner
              </h3>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-forge-700 bg-forge-800 font-mono text-[10px]">
                  {idea.ownerAvatar}
                </span>
                <span className="text-sm">{idea.owner}</span>
              </div>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Tags
              </h3>
              <div className="flex flex-wrap gap-1">
                {idea.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
