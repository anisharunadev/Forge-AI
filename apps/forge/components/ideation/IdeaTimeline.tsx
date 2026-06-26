'use client';

/**
 * IdeaTimeline — horizontal swimlane timeline (Step 5 Timeline view).
 *
 * Ideas are grouped into weekly swimlanes and positioned by
 * `createdAt`. Each lane is a row; cards are absolutely positioned
 * along a horizontal axis. No drag in timeline view (per spec).
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Idea } from '@/lib/ideation/data';

const DAYS = 14; // 2-week window
const DAY_MS = 86_400_000;

function bucketKey(d: Date): string {
  // ISO week-start (Monday)
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function laneLabel(iso: string): string {
  const d = new Date(iso);
  return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}`;
}

export interface IdeaTimelineProps {
  ideas: ReadonlyArray<Idea>;
  onSelect?: (idea: Idea) => void;
}

export function IdeaTimeline({ ideas, onSelect }: IdeaTimelineProps) {
  const { lanes, range } = React.useMemo(() => {
    if (ideas.length === 0) {
      const now = new Date();
      const start = new Date(now.getTime() - 6 * DAY_MS);
      return { lanes: [], range: { start, end: now } };
    }
    const sorted = [...ideas].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) {
      const now = new Date();
      const start = new Date(now.getTime() - 6 * DAY_MS);
      return { lanes: [], range: { start, end: now } };
    }
    const start = new Date(new Date(first.createdAt).getTime() - DAY_MS);
    const end = new Date(new Date(last.createdAt).getTime() + DAY_MS);
    const buckets = new Map<string, Idea[]>();
    for (const idea of sorted) {
      const k = bucketKey(new Date(idea.createdAt));
      const existing = buckets.get(k);
      if (existing) existing.push(idea);
      else buckets.set(k, [idea]);
    }
    const laneArr = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({ key, label: laneLabel(key), items }));
    return { lanes: laneArr, range: { start, end } };
  }, [ideas]);

  if (ideas.length === 0) {
    return (
      <div className="card" data-testid="timeline-empty">
        <p className="text-sm text-[var(--fg-tertiary)]">
          No ideas to plot yet. Capture one and it will appear here.
        </p>
      </div>
    );
  }

  const total = range.end.getTime() - range.start.getTime() || 1;

  return (
    <div
      className="flex flex-col gap-3 overflow-x-auto"
      data-testid="idea-timeline"
      role="region"
      aria-label="Idea timeline"
    >
      <div className="grid grid-cols-[140px_1fr] gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Week
        </span>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${DAYS}, minmax(28px, 1fr))` }}
        >
          {Array.from({ length: DAYS }, (_, i) => {
            const d = new Date(range.start.getTime() + i * (total / (DAYS - 1)));
            return (
              <span
                key={i}
                className="text-center font-mono text-[10px] text-[var(--fg-tertiary)]"
              >
                {d.toLocaleDateString(undefined, { day: '2-digit' })}
              </span>
            );
          })}
        </div>
      </div>

      {lanes.map((lane) => (
        <div key={lane.key} className="grid grid-cols-[140px_1fr] items-stretch gap-3">
          <span className="text-xs font-medium text-[var(--fg-secondary)]">{lane.label}</span>
          <div
            className="relative h-[88px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            data-testid={`timeline-lane-${lane.key}`}
          >
            {/* day gridlines */}
            <div
              className="absolute inset-0 grid"
              style={{ gridTemplateColumns: `repeat(${DAYS}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {Array.from({ length: DAYS }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'border-r border-[var(--border-subtle)]/50 last:border-r-0',
                  )}
                />
              ))}
            </div>
            {/* cards positioned by createdAt */}
            {lane.items.map((idea, idx) => {
              const t = new Date(idea.createdAt).getTime();
              const pct = Math.max(0, Math.min(100, ((t - range.start.getTime()) / total) * 100));
              const top = 6 + (idx % 3) * 26;
              return (
                <button
                  key={idea.id}
                  type="button"
                  onClick={() => onSelect?.(idea)}
                  className="absolute z-10 inline-flex max-w-[200px] items-center gap-1.5 truncate rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--fg-primary)] transition-colors duration-150 ease-out-soft hover:border-[var(--border-default)] hover:bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  data-testid={`timeline-card-${idea.id}`}
                  style={{ left: `calc(${pct}% - 6px)`, top: `${top}px` }}
                  aria-label={`${idea.title} — ${new Date(idea.createdAt).toLocaleDateString()}`}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-block h-1.5 w-1.5 rounded-full',
                      idea.status === 'approved' || idea.status === 'shipped'
                        ? 'bg-[var(--accent-emerald)]'
                        : idea.status === 'rejected'
                          ? 'bg-[var(--accent-rose)]'
                          : idea.status === 'prd'
                            ? 'bg-[var(--accent-violet)]'
                            : idea.status === 'scoring' || idea.status === 'discovery'
                              ? 'bg-[var(--accent-cyan)]'
                              : 'bg-[var(--fg-muted)]',
                    )}
                  />
                  <span className="truncate">{idea.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
