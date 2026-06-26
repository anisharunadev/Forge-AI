'use client';

/**
 * PRDList — Step 5 enhanced PRD rows.
 *
 * Each row: PRD title + linked idea (chip) + status dot + author
 * + "Open PRD" button. Empty state keeps "Generate first PRD" CTA.
 */

import * as React from 'react';
import { ArrowUpRight, FilePlus2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/src/components/empty-state';
import { cn } from '@/lib/utils';
import type { Idea, PRD } from '@/lib/ideation/data';

const STATUS_DOT: Record<PRD['status'], string> = {
  draft: 'bg-[var(--fg-muted)]',
  review: 'bg-[var(--accent-amber)]',
  approved: 'bg-[var(--accent-emerald)]',
};

export interface PRDListProps {
  prds: ReadonlyArray<PRD>;
  ideas?: ReadonlyArray<Idea>;
  onSelect?: (prd: PRD) => void;
  onGenerate?: () => void;
}

export function PRDList({ prds, ideas, onSelect, onGenerate }: PRDListProps) {
  if (prds.length === 0) {
    return (
      <div data-testid="prd-list-empty" className="card">
        <EmptyState
          illustration={<FilePlus2 size={40} strokeWidth={1.5} />}
          title="No PRDs yet"
          description="PRDs are auto-generated from approved ideas."
          primaryAction={
            onGenerate
              ? { label: 'Generate first PRD', onClick: onGenerate }
              : undefined
          }
        />
      </div>
    );
  }

  const ideaById = React.useMemo(() => {
    const m = new Map<string, Idea>();
    for (const i of ideas ?? []) m.set(i.id, i);
    return m;
  }, [ideas]);

  return (
    <ul role="list" className="flex flex-col gap-2" data-testid="prd-list">
      {prds.map((p) => {
        const idea = ideaById.get(p.ideaId);
        return (
          <li
            key={p.id}
            data-testid={`prd-row-${p.id}`}
            data-prd-id={p.id}
            className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 transition-colors duration-150 ease-out-soft hover:border-[var(--border-default)]"
          >
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[p.status])}
            />
            <span className="sr-only">{p.status}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--fg-primary)]">
                {p.title}
              </p>
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-[var(--fg-tertiary)]">
                <span>{p.id}</span>
                <span aria-hidden="true">·</span>
                <span>{p.owner}</span>
                {idea ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5"
                      data-testid={`prd-linked-idea-${p.id}`}
                    >
                      from {idea.title}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {new Date(p.updatedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: '2-digit',
              })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSelect?.(p)}
              data-testid={`prd-open-${p.id}`}
              className="text-[var(--accent-primary)] hover:bg-[rgba(99,102,241,0.08)] hover:text-[var(--accent-primary)]"
            >
              Open PRD
              <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden="true" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
