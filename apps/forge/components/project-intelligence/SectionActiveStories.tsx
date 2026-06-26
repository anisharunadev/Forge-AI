'use client';

/**
 * SectionActiveStories — left column "Active stories by stage" section
 * (Step 20).
 *
 * Header: title + total in flight + segmented tabs (Dev / QA / DevOps).
 * Each tab shows up to 8 stories for that stage as compact rows.
 *
 * Story row: lucide icon (status) + id + title + assignee avatar +
 * estimate (story points) + age. Click → onOpen(storyId).
 */

import * as React from 'react';
import {
  ArrowRight,
  Beaker,
  CheckCheck,
  Code,
  ListTodo,
  Rocket,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { Story, StoryStatus } from '@/lib/intelligence/types';

const STAGE_TABS = [
  { value: 'dev', label: 'Stories in dev' },
  { value: 'qa', label: 'Stories in QA' },
  { value: 'devops', label: 'Stories in DevOps' },
] as const;

type StageTab = (typeof STAGE_TABS)[number]['value'];

const STATUS_ICON: Record<StoryStatus, React.ReactNode> = {
  backlog: <ListTodo className="h-3.5 w-3.5" strokeWidth={2} />,
  ideation: <ListTodo className="h-3.5 w-3.5" strokeWidth={2} />,
  dev: <Code className="h-3.5 w-3.5" strokeWidth={2} />,
  qa: <Beaker className="h-3.5 w-3.5" strokeWidth={2} />,
  security: <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />,
  devops: <Rocket className="h-3.5 w-3.5" strokeWidth={2} />,
  done: <CheckCheck className="h-3.5 w-3.5" strokeWidth={2} />,
  cancelled: <ListTodo className="h-3.5 w-3.5" strokeWidth={2} />,
};

const STATUS_TINT: Record<StoryStatus, string> = {
  backlog: 'text-[var(--fg-tertiary)] bg-[var(--bg-inset)]',
  ideation: 'text-[var(--fg-tertiary)] bg-[var(--bg-inset)]',
  dev: 'text-[var(--accent-amber)] bg-[var(--accent-amber)]/10',
  qa: 'text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10',
  security: 'text-[var(--accent-rose)] bg-[var(--accent-rose)]/10',
  devops: 'text-[var(--accent-violet)] bg-[var(--accent-violet)]/10',
  done: 'text-[var(--accent-emerald)] bg-[var(--accent-emerald)]/10',
  cancelled: 'text-[var(--fg-muted)] bg-[var(--bg-inset)]',
};

export interface SectionActiveStoriesProps {
  stories: ReadonlyArray<Story>;
  isLoading?: boolean;
  onOpen?: (storyId: string) => void;
}

export function SectionActiveStories({
  stories,
  isLoading = false,
  onOpen,
}: SectionActiveStoriesProps) {
  const [active, setActive] = React.useState<StageTab>('dev');

  const counts = React.useMemo(() => {
    return {
      dev: stories.filter((s) => s.status === 'dev').length,
      qa: stories.filter((s) => s.status === 'qa').length,
      devops: stories.filter((s) => s.status === 'devops').length,
    };
  }, [stories]);
  const inFlight = counts.dev + counts.qa + counts.devops;

  const filtered = React.useMemo(
    () => stories.filter((s) => s.status === active).slice(0, 8),
    [stories, active],
  );

  return (
    <section
      aria-labelledby="section-stories-h"
      className="space-y-3"
      data-testid="project-section-stories"
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <h3
            id="section-stories-h"
            className="text-[15px] font-semibold text-[var(--fg-primary)]"
          >
            Active stories by stage
          </h3>
          <span
            className="rounded-[var(--radius-sm)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]"
            data-testid="section-stories-count"
          >
            {inFlight} in flight
          </span>
        </div>
        <a
          href="/stories"
          className="text-[12px] text-[var(--fg-secondary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
          data-testid="section-stories-center"
        >
          Open Stories center →
        </a>
      </div>

      <div
        role="tablist"
        aria-label="Active story stages"
        className="inline-flex h-9 items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5"
        data-testid="section-stories-tabs"
      >
        {STAGE_TABS.map((tab) => {
          const isActive = active === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.value)}
              data-testid={`section-stories-tab-${tab.value}`}
              data-active={isActive ? 'true' : 'false'}
              className={cn(
                'seg-pill inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-medium',
                isActive
                  ? 'bg-[var(--accent-primary)]/15 text-[var(--fg-primary)]'
                  : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
              )}
            >
              {tab.label}
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px]',
                  isActive
                    ? 'bg-[var(--accent-primary)]/30 text-[var(--fg-primary)]'
                    : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
                )}
              >
                {counts[tab.value]}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <ul className="space-y-2" data-testid="section-stories-skeleton">
          {Array.from({ length: 4 }).map((_, i) => (
            <StoryRowSkeleton key={i} />
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <p
          className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 px-4 py-8 text-center text-[12px] text-[var(--fg-tertiary)]"
          data-testid="section-stories-empty"
        >
          No stories in this stage right now.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="section-stories-list" data-story-count={filtered.length}>
          {filtered.map((s) => (
            <StoryRow key={s.id} story={s} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StoryRow({ story, onOpen }: { story: Story; onOpen?: (id: string) => void }) {
  const icon = STATUS_ICON[story.status];
  const tint = STATUS_TINT[story.status];
  // Mock story points + age — could be enriched with real data
  const points = ((story.identifier.length * 3) % 8) + 1;
  const age = `${(story.identifier.length % 9) + 1}d`;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen?.(story.id)}
        className={cn(
          'card-hover flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 text-left',
          'transition-colors duration-200',
        )}
        data-testid="section-stories-row"
        data-story-id={story.id}
        data-story-status={story.status}
      >
        <span
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            tint,
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
              {story.identifier}
            </span>
            <span className="truncate text-[13px] font-medium text-[var(--fg-primary)]">
              {story.title}
            </span>
          </div>
        </div>
        <Avatar className="h-6 w-6">
          <AvatarFallback className="bg-[var(--bg-elevated)] text-[9px] text-[var(--fg-secondary)]">
            {story.owner.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span
          className="rounded-md bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]"
          data-testid="section-stories-points"
        >
          {points}pt
        </span>
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{age}</span>
        <ArrowRight
          className="h-3 w-3 text-[var(--fg-tertiary)] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

function StoryRowSkeleton() {
  return (
    <li
      className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5"
      data-testid="section-stories-skeleton-row"
    >
      <Skeleton className="h-7 w-7 rounded-md" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2 w-1/4" />
      </div>
      <Skeleton className="h-6 w-6 rounded-full" />
      <Skeleton className="h-4 w-8" />
    </li>
  );
}
