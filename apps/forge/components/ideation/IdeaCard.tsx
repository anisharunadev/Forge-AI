'use client';

import * as React from 'react';
import { Lightbulb } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Idea } from '@/lib/ideation/data';
import { ScoreBadge } from './ScoreBadge';

const STATUS_TONE: Record<Idea['status'], string> = {
  intake: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  scoring: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
  discovery: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  prd: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  rejected: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  shipped: 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200',
};

const STATUS_LABEL: Record<Idea['status'], string> = {
  intake: 'Intake',
  scoring: 'Scoring',
  discovery: 'Discovery',
  prd: 'PRD',
  approved: 'Approved',
  rejected: 'Rejected',
  shipped: 'Shipped',
};

export interface IdeaCardProps {
  idea: Idea;
  onSelect?: (idea: Idea) => void;
}

export function IdeaCard({ idea, onSelect }: IdeaCardProps) {
  return (
    <article
      data-testid="idea-card"
      data-idea-id={idea.id}
      data-idea-status={idea.status}
      className="card flex flex-col gap-3"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
            <Lightbulb className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold leading-tight">
              {idea.title}
            </h3>
            <p className="font-mono text-xs text-forge-300">{idea.id}</p>
          </div>
        </div>
        <ScoreBadge score={idea.score} />
      </header>

      <p className="text-xs text-forge-200">{idea.summary}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_TONE[idea.status],
          )}
        >
          {STATUS_LABEL[idea.status]}
        </span>
        {idea.tags.map((t) => (
          <Badge key={t} variant="outline" className="text-[10px]">
            {t}
          </Badge>
        ))}
      </div>

      <footer className="flex items-center justify-between border-t border-forge-800 pt-3">
        <div className="flex items-center gap-2 text-[10px] text-forge-300">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-forge-700 bg-forge-800 font-mono text-[10px]">
            {idea.ownerAvatar}
          </span>
          {idea.owner}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSelect?.(idea)}
          data-testid="idea-card-open"
        >
          Open
        </Button>
      </footer>
    </article>
  );
}
