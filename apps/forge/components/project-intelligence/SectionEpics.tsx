'use client';

/**
 * SectionEpics — left column "Epics" section (Step 20).
 *
 * Each card carries:
 *   - lucide Layers icon (--accent-primary) + id (mono, E-001) + title
 *   - status badge (On track / At risk / Blocked / Done)
 *   - description (clamp 2)
 *   - progress bar (--bg-inset track + --accent-primary fill)
 *   - assignees (overlapping avatars, +N more) + last activity
 *   - hover lift (--shadow-md, 200ms)
 *   - click → fires onOpen(epicId)
 *
 * Empty state = Step 3 compact EmptyState (Layers illustration).
 * Loading = 3 placeholder cards (shimmer).
 */

import * as React from 'react';
import { ArrowRight, Clock, Layers, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import type { Epic, EpicStatus } from '@/lib/intelligence/types';

const STATUS_TONE: Record<
  EpicStatus,
  { label: string; cls: string; dot: string }
> = {
  draft: {
    label: 'Draft',
    cls: 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)]',
    dot: 'bg-[var(--fg-muted)]',
  },
  active: {
    label: 'On track',
    cls: 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]',
    dot: 'bg-[var(--accent-emerald)]',
  },
  'at-risk': {
    label: 'At risk',
    cls: 'border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]',
    dot: 'bg-[var(--accent-amber)]',
  },
  done: {
    label: 'Done',
    cls: 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-tertiary)]',
    dot: 'bg-[var(--fg-tertiary)]',
  },
  cancelled: {
    label: 'Blocked',
    cls: 'border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 text-[var(--accent-rose)]',
    dot: 'bg-[var(--accent-rose)]',
  },
};

export interface SectionEpicsProps {
  epics: ReadonlyArray<Epic>;
  /** Map of epic id → story count for progress bar. */
  storyCountByEpic: Readonly<Record<string, number>>;
  /** Map of epic id → assignee initials (max 3 shown; +N more). */
  assigneesByEpic: Readonly<Record<string, ReadonlyArray<string>>>;
  isLoading?: boolean;
  onOpen?: (epicId: string) => void;
  onCreateEpic?: () => void;
  onViewArchitectureCenter?: () => void;
}

export function SectionEpics({
  epics,
  storyCountByEpic,
  assigneesByEpic,
  isLoading = false,
  onOpen,
  onCreateEpic,
  onViewArchitectureCenter,
}: SectionEpicsProps) {
  return (
    <section
      aria-labelledby="section-epics-h"
      className="space-y-3"
      data-testid="project-section-epics"
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <h3
            id="section-epics-h"
            className="text-[15px] font-semibold text-[var(--fg-primary)]"
          >
            Epics
          </h3>
          <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">
            {epics.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SortMenu />
          <a
            href="/project-intelligence?view=epics"
            className="text-[12px] text-[var(--fg-secondary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
            data-testid="section-epics-view-all"
          >
            View all →
          </a>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="section-epics-skeleton">
          {Array.from({ length: 3 }).map((_, i) => (
            <EpicCardSkeleton key={i} />
          ))}
        </div>
      ) : epics.length === 0 ? (
        <div
          data-testid="section-epics-empty"
          className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/40"
        >
          <EmptyState
            compact
            illustration={<Layers size={28} strokeWidth={1.5} />}
            title="No epics in this project"
            description="Epics are produced by the architecture pipeline from approved PRDs."
            primaryAction={
              onCreateEpic
                ? { label: 'Create epic', onClick: onCreateEpic, icon: <Plus className="h-3.5 w-3.5" /> }
                : undefined
            }
            secondaryAction={
              onViewArchitectureCenter
                ? { label: 'View architecture center', onClick: onViewArchitectureCenter }
                : undefined
            }
          />
        </div>
      ) : (
        <ul
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          aria-label="Epics"
          data-testid="section-epics-list"
          data-epic-count={epics.length}
        >
          {epics.map((e) => {
            const total = storyCountByEpic[e.id] ?? 0;
            const done = Math.floor(total * 0.6); // mock; can be derived from stories
            const pct = total === 0 ? 0 : Math.round((done / total) * 100);
            return (
              <EpicCardItem
                key={e.id}
                epic={e}
                total={total}
                done={done}
                pct={pct}
                assignees={assigneesByEpic[e.id] ?? []}
                onOpen={onOpen}
              />
            );
          })}
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
          data-testid="section-epics-sort"
        >
          Sort: Updated
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem>By status</DropdownMenuItem>
        <DropdownMenuItem>By progress</DropdownMenuItem>
        <DropdownMenuItem>By updated</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface EpicCardItemProps {
  epic: Epic;
  total: number;
  done: number;
  pct: number;
  assignees: ReadonlyArray<string>;
  onOpen?: (id: string) => void;
}

function EpicCardItem({ epic, total, done, pct, assignees, onOpen }: EpicCardItemProps) {
  const tone = STATUS_TONE[epic.status];
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen?.(epic.id)}
        className={cn(
          'card-hover group w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-left',
          'transition-all duration-200',
        )}
        data-testid="section-epics-card"
        data-epic-id={epic.id}
        data-epic-status={epic.status}
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
            aria-hidden="true"
          >
            <Layers className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                {epic.identifier}
              </span>
            </div>
            <h4 className="truncate text-[14px] font-semibold text-[var(--fg-primary)]">
              {epic.title}
            </h4>
            <p className="mt-1 line-clamp-2 text-[12px] text-[var(--fg-secondary)]">
              {epic.description}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium',
              tone.cls,
            )}
            data-testid="section-epics-status"
            data-status={epic.status}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} aria-hidden="true" />
            {tone.label}
          </span>
        </div>

        <div className="mt-4 space-y-1.5">
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-inset)]"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${done} of ${total} stories complete`}
          >
            <div
              className="h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-300"
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          </div>
          <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
            {done} / {total} stories
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center -space-x-1.5">
            {assignees.slice(0, 3).map((a) => (
              <Avatar
                key={a}
                className="h-6 w-6 border-2 border-[var(--bg-surface)]"
                data-testid="section-epics-assignee"
              >
                <AvatarFallback className="bg-[var(--bg-elevated)] text-[9px] text-[var(--fg-secondary)]">
                  {a.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
            {assignees.length > 3 ? (
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--bg-surface)] bg-[var(--bg-inset)] text-[9px] text-[var(--fg-secondary)]">
                +{assignees.length - 3}
              </span>
            ) : null}
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--fg-tertiary)]">
            <Clock className="h-2.5 w-2.5" aria-hidden="true" />
            {epic.updatedAt}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-end text-[10px] text-[var(--fg-tertiary)]">
          <span className="inline-flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            Open epic <ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />
          </span>
        </div>
      </button>
    </li>
  );
}

function EpicCardSkeleton() {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      data-testid="section-epics-skeleton-card"
    >
      <div className="flex items-start gap-2">
        <Skeleton className="h-5 w-5 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
        <Skeleton className="h-5 w-16 rounded-md" />
      </div>
      <Skeleton className="mt-4 h-1 w-full rounded-full" />
      <div className="mt-3 flex items-center justify-between">
        <div className="flex -space-x-1.5">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-6 w-6 rounded-full" />
        </div>
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}
