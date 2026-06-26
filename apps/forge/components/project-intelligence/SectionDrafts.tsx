'use client';

/**
 * SectionDrafts — left column "Draft PRDs" section (Step 20).
 *
 * Each card: id (PRD-001) + title + linked brief chip + lint status + author + Open.
 * Header carries an emerald "lint-passed" pill.
 */

import * as React from 'react';
import { FileText, Sparkles, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DraftPrd, RequirementBrief } from '@/lib/intelligence/types';

export interface SectionDraftsProps {
  drafts: ReadonlyArray<DraftPrd>;
  briefs: ReadonlyArray<RequirementBrief>;
  isLoading?: boolean;
  onOpen?: (id: string) => void;
  onGenerateFirst?: () => void;
  onHowPrdsWork?: () => void;
}

export function SectionDrafts({
  drafts,
  briefs,
  isLoading = false,
  onOpen,
  onGenerateFirst,
  onHowPrdsWork,
}: SectionDraftsProps) {
  const briefById = React.useMemo(() => {
    const m = new Map<string, RequirementBrief>();
    briefs.forEach((b) => m.set(b.id, b));
    return m;
  }, [briefs]);

  return (
    <section
      aria-labelledby="section-drafts-h"
      className="space-y-3"
      data-testid="project-section-drafts"
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <h3
            id="section-drafts-h"
            className="text-[15px] font-semibold text-[var(--fg-primary)]"
          >
            Draft PRDs
          </h3>
          <span
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-emerald)]"
            data-testid="section-drafts-lint-pill"
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]"
              aria-hidden="true"
            />
            lint-passed
          </span>
          <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">
            {drafts.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SortMenu />
          <a
            href="/project-intelligence?view=drafts"
            className="text-[12px] text-[var(--fg-secondary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
            data-testid="section-drafts-view-all"
          >
            View all →
          </a>
        </div>
      </div>

      {isLoading ? (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="section-drafts-skeleton">
          {Array.from({ length: 2 }).map((_, i) => (
            <DraftCardSkeleton key={i} />
          ))}
        </ul>
      ) : drafts.length === 0 ? (
        <div
          data-testid="section-drafts-empty"
          className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/40"
        >
          <EmptyState
            compact
            illustration={<FileText size={28} strokeWidth={1.5} />}
            title="No draft PRDs yet"
            description="Drafts are produced by the architecture pipeline."
            primaryAction={
              onGenerateFirst
                ? { label: 'Generate first PRD', onClick: onGenerateFirst, icon: <Sparkles className="h-3.5 w-3.5" /> }
                : undefined
            }
            secondaryAction={
              onHowPrdsWork
                ? { label: 'How PRDs work', onClick: onHowPrdsWork }
                : undefined
            }
          />
        </div>
      ) : (
        <ul
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          aria-label="Draft PRDs"
          data-testid="section-drafts-list"
          data-draft-count={drafts.length}
        >
          {drafts.map((d) => (
            <DraftCardItem
              key={d.id}
              draft={d}
              linkedBrief={briefById.get(d.id) ?? briefs.find((b) => b.epicId === d.epicId)}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SortMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[11px] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          data-testid="section-drafts-sort"
        >
          Sort: Recent
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem>By recent</DropdownMenuItem>
        <DropdownMenuItem>By epic</DropdownMenuItem>
        <DropdownMenuItem>By lint</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DraftCardItemProps {
  draft: DraftPrd;
  linkedBrief?: RequirementBrief;
  onOpen?: (id: string) => void;
}

function DraftCardItem({ draft, linkedBrief, onOpen }: DraftCardItemProps) {
  const sectionCount = Object.keys(draft.sectionBodies).length;
  return (
    <li>
      <div
        className={cn(
          'card-hover flex h-full flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5',
        )}
        data-testid="section-drafts-card"
        data-prd-id={draft.id}
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--accent-violet)]/15 text-[var(--accent-violet)]"
            aria-hidden="true"
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <div className="flex-1 min-w-0">
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              PRD-{draft.id.slice(-3).toUpperCase()}
            </span>
            <h4 className="truncate text-[14px] font-semibold text-[var(--fg-primary)]">
              {draft.title}
            </h4>
            <p className="mt-1 line-clamp-1 text-[11px] text-[var(--fg-tertiary)]">
              {sectionCount} sections · {draft.lintPassed ? 'lint-passed' : 'lint-pending'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {linkedBrief ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)]"
              data-testid="section-drafts-brief-chip"
            >
              B-{linkedBrief.id.slice(-3).toUpperCase()}
            </span>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="bg-[var(--bg-elevated)] text-[8px] text-[var(--fg-secondary)]">
                <User className="h-2.5 w-2.5" aria-hidden="true" />
              </AvatarFallback>
            </Avatar>
            <span className="text-[10px] text-[var(--fg-tertiary)]">
              architect-agent
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => onOpen?.(draft.id)}
            data-testid="section-drafts-open"
            className="h-7 px-3 text-[11px]"
          >
            Open
          </Button>
        </div>
      </div>
    </li>
  );
}

function DraftCardSkeleton() {
  return (
    <li
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="section-drafts-skeleton-card"
    >
      <div className="flex items-start gap-2">
        <Skeleton className="h-5 w-5 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      <Skeleton className="mt-4 h-3 w-1/2" />
      <div className="mt-4 flex items-center justify-between">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-7 w-16" />
      </div>
    </li>
  );
}
