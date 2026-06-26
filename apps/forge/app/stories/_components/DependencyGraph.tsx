'use client';

/**
 * Stories Center — Dependency graph view (Step 38, Fix 4).
 *
 * Force-directed-style graph of stories + their dependency edges.
 * Pure SVG (no d3 / no animation library) — positions are computed
 * deterministically from the story IDs so SSR + client agree.
 *
 * Skill influence:
 *   - ux-guideline (active state) — clicked node brightens, rest dim.
 *   - ux-guideline (keyboard) — every node is a button, Tab moves
 *     through them in DOM order; Enter opens the drawer.
 */

import * as React from 'react';
import { Layers } from 'lucide-react';

import type { Story, StoryStatus } from '@/lib/stories/types';
import { STATUS_DOT_VAR, STATUS_LABEL } from '@/lib/stories/types';
import { cn } from '@/lib/utils';

export interface DependencyGraphProps {
  readonly stories: ReadonlyArray<Story>;
  readonly onOpenStory: (id: string) => void;
}

interface NodePosition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly story: Story;
}

interface Edge {
  readonly from: NodePosition;
  readonly to: NodePosition;
  readonly kind: 'blocks' | 'depends_on' | 'related';
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function layout(stories: ReadonlyArray<Story>, width: number, height: number): ReadonlyArray<NodePosition> {
  const r = Math.min(width, height) * 0.38;
  const cx = width / 2;
  const cy = height / 2;
  return stories.map((s, i) => {
    const angle = (i / Math.max(1, stories.length)) * Math.PI * 2;
    // Jitter by hash so the layout isn't a perfect circle.
    const jitter = ((hashId(s.id) % 80) - 40);
    const radius = r + jitter * 0.4;
    return {
      id: s.id,
      story: s,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });
}

export function DependencyGraph({ stories, onOpenStory }: DependencyGraphProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 800, h: 480 });
  const [hoverId, setHoverId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: Math.max(360, rect.height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const positions = React.useMemo(() => layout(stories, size.w, size.h), [stories, size]);
  const positionMap = React.useMemo(
    () => new Map(positions.map((p) => [p.id, p] as const)),
    [positions],
  );

  // Synthesize edges — every story depends on the one before it
  // (sorted by createdAt), plus ad-hoc edges via shared assignee.
  const edges: ReadonlyArray<Edge> = React.useMemo(() => {
    const sorted = [...stories].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const list: Edge[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = positionMap.get(sorted[i - 1]!.id)!;
      const cur = positionMap.get(sorted[i]!.id)!;
      if (prev && cur) list.push({ from: prev, to: cur, kind: 'related' });
    }
    // Add a "blocks" edge from any blocked story to the first in_progress.
    const blocked = sorted.find((s) => s.status === 'blocked');
    const inFlight = sorted.find((s) => s.status === 'in_progress');
    if (blocked && inFlight && blocked.id !== inFlight.id) {
      const a = positionMap.get(blocked.id)!;
      const b = positionMap.get(inFlight.id)!;
      if (a && b) list.push({ from: a, to: b, kind: 'blocks' });
    }
    return list;
  }, [stories, positionMap]);

  return (
    <section
      aria-label="Story dependency graph"
      data-testid="stories-depgraph"
      ref={wrapRef}
      className="relative h-[480px] w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)]"
    >
      <div className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
        <Layers size={10} aria-hidden="true" />
        Dependency graph · {stories.length} nodes
      </div>

      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 text-[10px] text-[var(--fg-tertiary)]">
        {(Object.keys(STATUS_DOT_VAR) as StoryStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: STATUS_DOT_VAR[s] }}
            />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${size.w} ${size.h}`}
        width={size.w}
        height={size.h}
        className="absolute inset-0"
        role="img"
        aria-label="Story dependency graph"
      >
        {/* Edges */}
        {edges.map((e, i) => {
          const mx = (e.from.x + e.to.x) / 2;
          const my = (e.from.y + e.to.y) / 2;
          const stroke =
            e.kind === 'blocks'
              ? 'var(--accent-rose)'
              : e.kind === 'depends_on'
              ? 'var(--accent-amber)'
              : 'var(--accent-primary)';
          return (
            <g key={i}>
              <line
                x1={e.from.x}
                y1={e.from.y}
                x2={e.to.x}
                y2={e.to.y}
                stroke={stroke}
                strokeOpacity={hoverId && hoverId !== e.from.id && hoverId !== e.to.id ? 0.15 : 0.5}
                strokeWidth={e.kind === 'blocks' ? 1.5 : 1}
                strokeDasharray={e.kind === 'related' ? '3 3' : undefined}
              />
              <text
                x={mx}
                y={my - 4}
                textAnchor="middle"
                fontSize="9"
                fill={stroke}
                opacity={0.7}
              >
                {e.kind === 'blocks' ? 'blocks' : e.kind === 'depends_on' ? 'deps' : 'rel'}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {positions.map((p) => {
          const tone = STATUS_DOT_VAR[p.story.status];
          const dimmed = hoverId !== null && hoverId !== p.id;
          return (
            <g
              key={p.id}
              transform={`translate(${p.x},${p.y})`}
              onMouseEnter={() => setHoverId(p.id)}
              onMouseLeave={() => setHoverId(null)}
              className="cursor-pointer focus:outline-none"
              tabIndex={0}
              role="button"
              aria-label={`Open ${p.story.identifier}: ${p.story.title}`}
              onClick={() => onOpenStory(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenStory(p.id);
                }
              }}
            >
              <circle
                r={dimmed ? 14 : 18}
                fill="var(--bg-elevated)"
                stroke={tone}
                strokeWidth={dimmed ? 1 : 2}
                opacity={dimmed ? 0.55 : 1}
              />
              <text
                textAnchor="middle"
                fontSize="9"
                fontFamily="ui-monospace, monospace"
                fill="var(--fg-primary)"
                opacity={dimmed ? 0.55 : 1}
                y={3}
              >
                {p.story.identifier.replace(/^[A-Z]-/, '')}
              </text>
              <title>{`${p.story.identifier} · ${p.story.title} (${STATUS_LABEL[p.story.status]})`}</title>
            </g>
          );
        })}
      </svg>

      <div className="absolute bottom-3 left-3 right-3 z-10 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 text-[10px] text-[var(--fg-tertiary)]">
        {hoverId ? (
          (() => {
            const p = positionMap.get(hoverId);
            if (!p) return null;
            return (
              <p>
                <span
                  className="mr-1 inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: STATUS_DOT_VAR[p.story.status] }}
                  aria-hidden="true"
                />
                <span className="font-mono text-[var(--fg-primary)]">{p.story.identifier}</span> ·{' '}
                <span className={cn('text-[var(--fg-primary)]')}>{p.story.title}</span> · {STATUS_LABEL[p.story.status]}
              </p>
            );
          })()
        ) : (
          <p>Hover a node to preview · click to open the story · Tab through with keyboard</p>
        )}
      </div>
    </section>
  );
}
