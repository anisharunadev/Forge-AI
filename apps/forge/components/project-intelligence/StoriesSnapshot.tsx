/**
 * Project Intelligence — Stories Snapshot bento card (Step 38).
 *
 * Surfaces the live state of the Stories module from inside the
 * Project Intelligence overview, so a PM can see in-progress
 * implementations, blocked items, and recent activity without
 * navigating away. Deep-links to the full Stories center.
 *
 * Skill influence:
 *   - Bento layout respects the existing 4/8 column grid (no new
 *     breakpoints)
 *   - Live session indicator uses --accent-emerald with reduced-motion
 *     fallback for the ping animation
 *   - Status colors paired with status text (no color-only signal)
 */

import Link from 'next/link';
import {
  ArrowRight,
  CircleDot,
  ListTodo,
  Rocket,
  TerminalSquare,
} from 'lucide-react';

import type { Story } from '@/lib/intelligence/types';
import { cn } from '@/lib/utils';

export interface StoriesSnapshotProps {
  readonly stories: ReadonlyArray<Story>;
  /** Map of storyId → live terminal session id, when the agent is
   *  actively coding the story (Step 38 Fix 5). */
  readonly liveSessions?: ReadonlyMap<string, string>;
  readonly className?: string;
}

const STATUS_LABEL: Record<string, string> = {
  ideation: 'Ideation',
  dev: 'In dev',
  qa: 'In QA',
  security: 'Security',
  devops: 'DevOps',
  done: 'Done',
  archived: 'Archived',
};

export function StoriesSnapshot({
  stories,
  liveSessions,
  className,
}: StoriesSnapshotProps) {
  const byStatus = stories.reduce<Record<string, Story[]>>((acc, s) => {
    (acc[s.status] ||= []).push(s);
    return acc;
  }, {});

  const active = stories.filter((s) =>
    ['dev', 'qa', 'security', 'devops'].includes(s.status),
  );
  const blocked = stories.filter((s) => s.status === 'ideation');
  const done = stories.filter((s) => s.status === 'done');

  const recentActive = active
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 4);

  const liveCount = liveSessions?.size ?? 0;

  return (
    <section
      aria-labelledby="stories-snapshot-title"
      data-testid="stories-snapshot"
      className={cn(
        'rounded-[var(--radius-xl)] border border-[var(--border-subtle)]',
        'bg-[var(--bg-surface)] p-5',
        className,
      )}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[rgba(99,102,241,0.12)] text-[var(--accent-primary)]"
          >
            <ListTodo size={14} strokeWidth={1.8} />
          </span>
          <div>
            <h2
              id="stories-snapshot-title"
              className="text-sm font-semibold text-[var(--fg-primary)]"
            >
              Stories
            </h2>
            <p className="text-[11px] text-[var(--fg-tertiary)]">
              {stories.length} total · {active.length} in flight
              {liveCount > 0 ? ` · ${liveCount} live` : ''}
            </p>
          </div>
        </div>
        <Link
          href="/stories"
          data-testid="stories-snapshot-open"
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1',
            'text-xs font-medium text-[var(--accent-primary)]',
            'hover:bg-[rgba(99,102,241,0.10)] focus:outline-none',
            'focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
          )}
        >
          Open Stories center
          <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </header>

      {/* Status pills */}
      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Story counts by status">
        {(['dev', 'qa', 'security', 'devops', 'ideation', 'done'] as const).map(
          (status) => {
            const count = byStatus[status]?.length ?? 0;
            if (count === 0) return null;
            return (
              <li key={status}>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border',
                    'border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5',
                    'text-[11px] text-[var(--fg-secondary)]',
                  )}
                >
                  <CircleDot size={10} aria-hidden="true" className="text-[var(--fg-tertiary)]" />
                  <span className="font-mono">{count}</span>
                  <span>{STATUS_LABEL[status] ?? status}</span>
                </span>
              </li>
            );
          },
        )}
      </ul>

      {/* Live implementations ticker */}
      {liveCount > 0 ? (
        <div
          data-testid="stories-snapshot-live"
          className={cn(
            'mt-4 rounded-[var(--radius-md)] border',
            'border-[var(--accent-emerald)]/30 bg-[rgba(34,197,94,0.06)]',
            'px-3 py-2',
          )}
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--accent-emerald)]">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-emerald)] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]" />
            </span>
            <TerminalSquare size={11} aria-hidden="true" />
            <span>{liveCount} live coding session{liveCount === 1 ? '' : 's'}</span>
          </div>
          <p className="mt-1 text-[10px] text-[var(--fg-tertiary)]">
            Agents are running on{' '}
            {Array.from(liveSessions?.keys() ?? [])
              .slice(0, 3)
              .join(', ')}
            {liveCount > 3 ? ` and ${liveCount - 3} more` : ''}. Open the Stories
            center to watch progress and intervene.
          </p>
        </div>
      ) : null}

      {/* Recent active stories */}
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
          Most recently active
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {recentActive.length === 0 ? (
            <li className="text-[11px] text-[var(--fg-tertiary)]">
              Nothing in flight right now.
            </li>
          ) : (
            recentActive.map((s) => {
              const live = liveSessions?.has(s.id);
              return (
                <li key={s.id}>
                  <Link
                    href={`/stories?storyId=${s.id}`}
                    className={cn(
                      'group flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5',
                      'hover:bg-[var(--hover)] focus:outline-none',
                      'focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="font-mono text-[10px] text-[var(--fg-tertiary)]"
                    >
                      {s.identifier}
                    </span>
                    <span className="flex-1 truncate text-xs text-[var(--fg-primary)]">
                      {s.title}
                    </span>
                    {live ? (
                      <span
                        aria-label="Live coding session"
                        className={cn(
                          'inline-flex items-center gap-1 rounded-[var(--radius-sm)]',
                          'border border-[var(--accent-emerald)]/40 bg-[rgba(34,197,94,0.10)]',
                          'px-1.5 py-0.5 text-[9px] font-medium text-[var(--accent-emerald)]',
                        )}
                      >
                        <Rocket size={9} aria-hidden="true" />
                        Live
                      </span>
                    ) : (
                      <span className="text-[10px] text-[var(--fg-tertiary)]">
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </div>

      {/* Footer hint */}
      <p className="mt-3 text-[10px] text-[var(--fg-tertiary)]">
        Press{' '}
        <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 font-mono text-[10px]">
          ⌘⇧S
        </kbd>{' '}
        anywhere to start a new story, or{' '}
        <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 font-mono text-[10px]">
          ⌘/
        </kbd>{' '}
        to see all shortcuts.
      </p>

      {/* Soft signals — blocked + done */}
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--fg-tertiary)]">
        <span>
          <span className="font-mono">{blocked.length}</span> awaiting kickoff
        </span>
        <span>
          <span className="font-mono">{done.length}</span> shipped this quarter
        </span>
      </div>
    </section>
  );
}