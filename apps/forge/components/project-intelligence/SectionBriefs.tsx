'use client';

/**
 * SectionBriefs — left column "Requirement briefs" section (Step 20).
 *
 * Each card: id (B-001) + title + linked epic chip + author + Read/Edit.
 * Header carries a mono "schema v1.0" badge.
 */

import * as React from 'react';
import { BookOpen, Pencil, Plus, User } from 'lucide-react';
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
import type { Epic, RequirementBrief } from '@/lib/intelligence/types';

export interface SectionBriefsProps {
  briefs: ReadonlyArray<RequirementBrief>;
  epics: ReadonlyArray<Epic>;
  isLoading?: boolean;
  onRead?: (id: string) => void;
  onEdit?: (id: string) => void;
  onApproveFirstEpic?: () => void;
}

export function SectionBriefs({
  briefs,
  epics,
  isLoading = false,
  onRead,
  onEdit,
  onApproveFirstEpic,
}: SectionBriefsProps) {
  const epicById = React.useMemo(() => {
    const m = new Map<string, Epic>();
    epics.forEach((e) => m.set(e.id, e));
    return m;
  }, [epics]);

  return (
    <section
      aria-labelledby="section-briefs-h"
      className="space-y-3"
      data-testid="project-section-briefs"
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <h3
            id="section-briefs-h"
            className="text-[15px] font-semibold text-[var(--fg-primary)]"
          >
            Requirement briefs
          </h3>
          <span className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
            schema v1.0
          </span>
          <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">
            {briefs.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SortMenu />
          <a
            href="/project-intelligence?view=briefs"
            className="text-[12px] text-[var(--fg-secondary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
            data-testid="section-briefs-view-all"
          >
            View all →
          </a>
        </div>
      </div>

      {isLoading ? (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="section-briefs-skeleton">
          {Array.from({ length: 2 }).map((_, i) => (
            <BriefCardSkeleton key={i} />
          ))}
        </ul>
      ) : briefs.length === 0 ? (
        <div
          data-testid="section-briefs-empty"
          className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/40"
        >
          <EmptyState
            compact
            illustration={<BookOpen size={28} strokeWidth={1.5} />}
            title="No requirement briefs yet"
            description="Briefs capture the why behind each epic. They're generated when an epic is approved."
            primaryAction={
              onApproveFirstEpic
                ? { label: 'Approve first epic', onClick: onApproveFirstEpic, icon: <Plus className="h-3.5 w-3.5" /> }
                : undefined
            }
          />
        </div>
      ) : (
        <ul
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          aria-label="Requirement briefs"
          data-testid="section-briefs-list"
          data-brief-count={briefs.length}
        >
          {briefs.map((b) => (
            <BriefCardItem
              key={b.id}
              brief={b}
              linkedEpic={epicById.get(b.epicId)}
              onRead={onRead}
              onEdit={onEdit}
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
          data-testid="section-briefs-sort"
        >
          Sort: Recent
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem>By recent</DropdownMenuItem>
        <DropdownMenuItem>By epic</DropdownMenuItem>
        <DropdownMenuItem>By source</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface BriefCardItemProps {
  brief: RequirementBrief;
  linkedEpic?: Epic;
  onRead?: (id: string) => void;
  onEdit?: (id: string) => void;
}

function BriefCardItem({ brief, linkedEpic, onRead, onEdit }: BriefCardItemProps) {
  const sectionCount = brief.sections.length;
  const openQuestions = brief.sections.reduce(
    (acc, s) => acc + (s.openQuestions?.length ?? 0),
    0,
  );
  return (
    <li>
      <div
        className={cn(
          'card-hover flex h-full flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5',
        )}
        data-testid="section-briefs-card"
        data-brief-id={brief.id}
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]"
            aria-hidden="true"
          >
            <BookOpen className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <div className="flex-1 min-w-0">
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              B-{brief.id.slice(-3).toUpperCase()}
            </span>
            <h4 className="truncate text-[14px] font-semibold text-[var(--fg-primary)]">
              {brief.title}
            </h4>
            <p className="mt-1 line-clamp-1 text-[11px] text-[var(--fg-tertiary)]">
              {brief.source}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {linkedEpic ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)]"
              data-testid="section-briefs-epic-chip"
            >
              {linkedEpic.identifier}
            </span>
          ) : null}
          <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
            {sectionCount} sections · {openQuestions} open
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="bg-[var(--bg-elevated)] text-[8px] text-[var(--fg-secondary)]">
                <User className="h-2.5 w-2.5" aria-hidden="true" />
              </AvatarFallback>
            </Avatar>
            <span className="text-[10px] text-[var(--fg-tertiary)]">
              {brief.source.replace(/^.*\/\//, '')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onRead?.(brief.id)}
              data-testid="section-briefs-read"
              className="h-7 px-2 text-[11px]"
            >
              Read
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onEdit?.(brief.id)}
              data-testid="section-briefs-edit"
              className="h-7 px-2 text-[11px]"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              Edit
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

function BriefCardSkeleton() {
  return (
    <li
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="section-briefs-skeleton-card"
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
