'use client';

/**
 * ArchPreviewGrid — grid of preview cards (Step 5 Architecture tab).
 *
 * Each card = thumbnail (graph placeholder) + title + status +
 * "Open" button. Empty state from Step 3.
 */

import * as React from 'react';
import { Network, ArrowUpRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/src/components/empty-state';
import { ArchPreviewGraph } from './ArchPreviewGraph';
import { cn } from '@/lib/utils';
import type { ArchPreview } from '@/lib/ideation/data';

export interface ArchPreviewGridProps {
  previews: ReadonlyArray<ArchPreview>;
  onOpen?: (p: ArchPreview) => void;
  onGenerate?: () => void;
}

export function ArchPreviewGrid({ previews, onOpen, onGenerate }: ArchPreviewGridProps) {
  if (previews.length === 0) {
    return (
      <div className="card" data-testid="arch-empty">
        <EmptyState
          illustration={<Network size={40} strokeWidth={1.5} />}
          title="No previews"
          description="Spin up an architecture preview to validate before coding."
          primaryAction={
            onGenerate ? { label: 'Generate preview', onClick: onGenerate } : undefined
          }
        />
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      data-testid="arch-preview-grid"
    >
      {previews.map((p) => (
        <article
          key={p.id}
          data-testid={`arch-card-${p.id}`}
          className="card group flex flex-col gap-3 transition-[border,transform,box-shadow] duration-200 ease-out-soft hover:-translate-y-px hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]"
        >
          <div
            className={cn(
              'h-[160px] w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)]',
            )}
          >
            {p.nodes.length > 0 ? (
              <ArchPreviewGraph preview={p} />
            ) : (
              <div className="flex h-full items-center justify-center text-[var(--fg-muted)]">
                <Network className="h-8 w-8" aria-hidden="true" />
              </div>
            )}
          </div>
          <header className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{p.title}</h3>
            <p className="line-clamp-2 text-xs text-[var(--fg-secondary)]">{p.description}</p>
          </header>
          <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {p.nodes.length} nodes · {p.edges.length} edges
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpen?.(p)}
              data-testid={`arch-open-${p.id}`}
              className="text-[var(--accent-primary)] hover:bg-[rgba(99,102,241,0.08)] hover:text-[var(--accent-primary)]"
            >
              Open
              <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden="true" />
            </Button>
          </footer>
        </article>
      ))}
    </div>
  );
}
