'use client';

/**
 * Stories Center — Timeline View (Step 21).
 *
 * Horizontal swimlanes per assignee. Days on X axis, stories
 * positioned by startDate..endDate. Today indicator (vertical cyan
 * line) marks the current date.
 *
 * Skill influence:
 *   - Color paired with shape/pattern (avatar + dot) so color is never
 *     the only signal.
 *   - prefers-reduced-motion respected (CSS handles it globally).
 */

import * as React from 'react';

import type { Assignee, Story } from '@/lib/stories/types';
import { PRIORITY_DOT_VAR } from '@/lib/stories/types';
import { cn } from '@/lib/utils';

export interface TimelineViewProps {
  readonly stories: ReadonlyArray<Story>;
  readonly assignees: ReadonlyArray<Assignee>;
  readonly onOpenStory: (id: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function TimelineView({ stories, assignees, onOpenStory }: TimelineViewProps) {
  // Window: 14 days centered on today. Real impl would query the
  // sprint date range; here we use a fixed window to keep the demo
  // deterministic.
  const today = new Date('2026-06-25T00:00:00Z');
  const start = new Date(today.getTime() - 5 * DAY_MS);
  const days: Date[] = [];
  for (let i = 0; i < 14; i += 1) {
    days.push(new Date(start.getTime() + i * DAY_MS));
  }
  const windowStart = start.getTime();
  const windowEnd = days[days.length - 1]!.getTime();
  const windowSpan = windowEnd - windowStart;

  const swimlanes = assignees.filter((a) =>
    stories.some((s) => s.assignee?.id === a.id),
  );

  return (
    <section
      aria-label="Timeline"
      data-testid="stories-timeline"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      <div className="thin-scrollbar overflow-x-auto">
        <div className="relative min-w-[1100px]">
          {/* Day header */}
          <div className="sticky top-0 z-10 grid grid-cols-[160px_1fr] border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/90 backdrop-blur">
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
              Assignee
            </div>
            <div className="relative">
              <div className="grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(60px, 1fr))` }}>
                {days.map((d, i) => {
                  const isToday = sameDay(d, today);
                  return (
                    <div
                      key={i}
                      className={cn(
                        'border-l border-[var(--border-subtle)] px-2 py-2 text-[10px]',
                        isToday
                          ? 'font-semibold text-[var(--accent-cyan)]'
                          : 'text-[var(--fg-tertiary)]',
                      )}
                    >
                      {d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Today vertical line — spans full height */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 z-10 h-full w-px bg-[var(--accent-cyan)]/60"
            style={{
              left: `calc(160px + ${(100 / days.length) * 5}%)`,
            }}
          />

          {/* Swimlanes */}
          {swimlanes.map((lane) => {
            const laneStories = stories.filter((s) => s.assignee?.id === lane.id);
            return (
              <div
                key={lane.id}
                className="grid grid-cols-[160px_1fr] border-b border-[var(--border-subtle)]"
                data-testid={`timeline-lane-${lane.id}`}
              >
                <div className="flex items-center gap-2 px-3 py-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: lane.color }}
                  >
                    {lane.initials}
                  </span>
                  <span className="text-xs text-[var(--fg-secondary)]">{lane.name}</span>
                </div>
                <div className="relative h-20">
                  {/* Day gridlines */}
                  <div
                    className="absolute inset-0 grid"
                    style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
                  >
                    {days.map((d, i) => (
                      <div
                        key={i}
                        className="border-l border-[var(--border-subtle)]/50"
                        aria-hidden="true"
                      />
                    ))}
                  </div>

                  {/* Story bars */}
                  {laneStories
                    .filter((s) => s.startDate && s.endDate)
                    .map((s, i) => {
                      const sStart = new Date(s.startDate!).getTime();
                      const sEnd = new Date(s.endDate!).getTime();
                      const left = Math.max(0, ((sStart - windowStart) / windowSpan) * 100);
                      const width = Math.max(
                        2,
                        ((Math.min(sEnd, windowEnd) - Math.max(sStart, windowStart)) /
                          windowSpan) *
                          100,
                      );
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onOpenStory(s.id)}
                          title={s.title}
                          data-testid={`timeline-bar-${s.identifier}`}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            top: `${8 + i * 4}px`,
                          }}
                          className={cn(
                            'absolute flex h-6 items-center gap-1.5 truncate rounded-[var(--radius-sm)] border px-2 text-[10px] font-medium',
                            'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-primary)]',
                            'transition-[box-shadow,border-color] duration-fast ease-out-soft',
                            'hover:border-[var(--border-default)] hover:shadow-[var(--shadow-sm)]',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: PRIORITY_DOT_VAR[s.priority] }}
                          />
                          <span className="truncate">{s.identifier}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            );
          })}

          {swimlanes.length === 0 ? (
            <div className="px-3 py-12 text-center text-sm text-[var(--fg-tertiary)]">
              No stories with start/end dates to plot yet.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}