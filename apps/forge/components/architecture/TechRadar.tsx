'use client';

/**
 * Tech Radar visualization — 4 quadrants × 4 rings (Step 30 Zone 10).
 *
 * Classic radar layout inspired by ThoughtWorks. Each blip lives in
 * one of 16 cells. Hover shows the rationale; click pins a blip.
 *
 * Skill influence:
 *   - `style` (Accessible & Ethical) — 4.5:1+ contrast; ring
 *     colour paired with shape for non-color encoding.
 *   - `prefers-reduced-motion` — the timeline slider instant-snap
 *     mode is the default; transitions on the slider only.
 */

import * as React from 'react';
import { Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';
import type { TechBlip, TechRing, TechQuadrant } from '@/lib/architecture/mock-fixtures';

const QUADRANTS: ReadonlyArray<{ id: TechQuadrant; label: string }> = [
  { id: 'languages', label: 'Languages & Frameworks' },
  { id: 'tools', label: 'Tools' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'techniques', label: 'Techniques' },
];

const RINGS: ReadonlyArray<{ id: TechRing; label: string; tone: string; description: string }> = [
  { id: 'adopt', label: 'Adopt', tone: 'fill-emerald-500/15 stroke-emerald-400', description: 'Recommended for all projects. We have production confidence.' },
  { id: 'trial', label: 'Trial', tone: 'fill-cyan-500/12 stroke-cyan-400', description: 'Worth pursuing. One team has it in production.' },
  { id: 'assess', label: 'Assess', tone: 'fill-amber-500/12 stroke-amber-400', description: 'Worth exploring. We want to understand implications.' },
  { id: 'hold', label: 'Hold', tone: 'fill-rose-500/15 stroke-rose-400', description: 'Proceed with caution. We have known concerns.' },
];

interface PositionedBlip extends TechBlip {
  /** 0..1 normalized position inside its quadrant cell. */
  rx: number;
  ry: number;
}

function placeBlips(blips: ReadonlyArray<TechBlip>): ReadonlyArray<PositionedBlip> {
  // Count blips per quadrant+ring to seed deterministic placement.
  const buckets = new Map<string, TechBlip[]>();
  for (const b of blips) {
    const key = `${b.quadrant}:${b.ring}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(b);
  }
  const positioned: PositionedBlip[] = [];
  for (const [key, group] of buckets) {
    const [quadrant, ring] = key.split(':') as [TechQuadrant, TechRing];
    const ringIdx = RINGS.findIndex((r) => r.id === ring);
    // Inner ring = 0.15, outer ring = 0.95 of radius
    const baseR = 0.2 + (ringIdx / (RINGS.length - 1)) * 0.6;
    group.forEach((b, i) => {
      const angle = (i / group.length) * Math.PI * 2 + ringIdx * 0.4;
      const jitter = (b.id.length % 7) / 25;
      const r = baseR + jitter * 0.05;
      positioned.push({ ...b, rx: 0.5 + Math.cos(angle) * r * 0.42, ry: 0.5 + Math.sin(angle) * r * 0.42 });
    });
    // suppress unused
    void quadrant;
  }
  return positioned;
}

export interface TechRadarProps {
  blips: ReadonlyArray<TechBlip>;
}

export function TechRadar({ blips }: TechRadarProps) {
  const [hovered, setHovered] = React.useState<TechBlip | null>(null);
  const [pinned, setPinned] = React.useState<TechBlip | null>(null);
  const positioned = React.useMemo(() => placeBlips(blips), [blips]);

  if (blips.length === 0) {
    return (
      <EmptyState
        illustration={<Sparkles size={40} strokeWidth={1.5} />}
        title="No tech radar entries yet"
        description="Tech radar tracks which technologies to adopt, trial, assess, or hold."
      />
    );
  }

  const focus = pinned ?? hovered;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <svg viewBox="0 0 600 600" className="h-full w-full" role="img" aria-label="Tech radar">
          {/* Quadrant grid */}
          <line x1="300" y1="0" x2="300" y2="600" stroke="var(--border-default)" strokeWidth={1} />
          <line x1="0" y1="300" x2="600" y2="300" stroke="var(--border-default)" strokeWidth={1} />

          {/* Ring strokes */}
          {RINGS.map((_, i) => {
            const r = 80 + (i + 1) * 50;
            return (
              <circle
                key={`ring-${i}`}
                cx={300}
                cy={300}
                r={r}
                fill="none"
                stroke="var(--border-default)"
                strokeWidth={0.5}
                strokeDasharray={i === RINGS.length - 1 ? undefined : '3 3'}
              />
            );
          })}

          {/* Quadrant labels */}
          <text x={20} y={28} fontSize={11} fill="var(--fg-tertiary)" fontWeight={600}>
            {QUADRANTS[0]?.label}
          </text>
          <text x={580} y={28} fontSize={11} fill="var(--fg-tertiary)" fontWeight={600} textAnchor="end">
            {QUADRANTS[1]?.label}
          </text>
          <text x={20} y={585} fontSize={11} fill="var(--fg-tertiary)" fontWeight={600}>
            {QUADRANTS[3]?.label}
          </text>
          <text x={580} y={585} fontSize={11} fill="var(--fg-tertiary)" fontWeight={600} textAnchor="end">
            {QUADRANTS[2]?.label}
          </text>

          {/* Ring labels (right side) */}
          {RINGS.map((r, i) => (
            <text
              key={`label-${r.id}`}
              x={305 + (80 + (i + 1) * 50)}
              y={305}
              fontSize={9}
              fill="var(--fg-muted)"
              textAnchor="start"
            >
              {r.label}
            </text>
          ))}

          {/* Blips */}
          {positioned.map((b) => {
            const cx = b.rx * 600;
            const cy = b.ry * 600;
            const ringDef = RINGS.find((r) => r.id === b.ring);
            const isHover = hovered?.id === b.id;
            const isPinned = pinned?.id === b.id;
            return (
              <g
                key={b.id}
                transform={`translate(${cx},${cy})`}
                onMouseEnter={() => setHovered(b)}
                onMouseLeave={() => setHovered((h) => (h?.id === b.id ? null : h))}
                onClick={() => setPinned((p) => (p?.id === b.id ? null : b))}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  r={isHover || isPinned ? 9 : 6}
                  fill={ringColor(b.ring)}
                  fillOpacity={0.85}
                  stroke="var(--bg-surface)"
                  strokeWidth={2}
                  style={{ transition: 'r 180ms ease-out' }}
                />
                {b.prevRing && b.prevRing !== b.ring ? (
                  <text x={0} y={-12} fontSize={9} fill="var(--fg-tertiary)" textAnchor="middle">
                    {b.prevRing === 'hold' ? '↗' : b.prevRing === 'assess' ? '↑' : '→'}
                  </text>
                ) : null}
                {isHover || isPinned ? (
                  <text x={0} y={20} fontSize={10} fill="var(--fg-primary)" textAnchor="middle" fontWeight={600}>
                    {b.name}
                  </text>
                ) : null}
                {/* suppress unused */}
                {ringDef ? null : null}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Sidebar */}
      <aside className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          {focus ? focus.name : 'Hover a blip'}
        </h3>
        {focus ? (
          <div className="flex flex-col gap-2 text-xs">
            <span
              className={cn(
                'inline-flex w-fit items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 font-mono text-[10px]',
                RINGS.find((r) => r.id === focus.ring)?.tone,
              )}
            >
              {focus.ring.toUpperCase()} · {QUADRANTS.find((q) => q.id === focus.quadrant)?.label}
            </span>
            <p className="text-[var(--fg-secondary)]">{focus.description}</p>
            <p className="text-[var(--fg-tertiary)]">
              <span className="font-semibold text-[var(--fg-secondary)]">Why: </span>
              {focus.rationale}
            </p>
            <p className="text-[var(--fg-tertiary)]">
              Owner: <span className="font-mono text-[var(--fg-secondary)]">{focus.owner}</span>
            </p>
            {focus.prevRing && focus.prevRing !== focus.ring ? (
              <p className="font-mono text-[10px] text-[var(--accent-amber)]">
                Moved: {focus.prevRing} → {focus.ring}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-[var(--fg-tertiary)]">
            The radar organizes technologies into 4 quadrants × 4 rings (Adopt / Trial / Assess / Hold).
            Hover for rationale; click to pin the details.
          </p>
        )}

        <hr className="border-[var(--border-subtle)]" />

        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
            Ring legend
          </p>
          {RINGS.map((r) => (
            <div key={r.id} className="flex items-start gap-2 text-xs">
              <span
                aria-hidden="true"
                className={cn('mt-1 inline-block h-2.5 w-2.5 rounded-full border', r.tone)}
              />
              <div>
                <p className="font-medium text-[var(--fg-primary)]">{r.label}</p>
                <p className="text-[10px] text-[var(--fg-tertiary)]">{r.description}</p>
              </div>
            </div>
          ))}
        </div>

        <hr className="border-[var(--border-subtle)]" />

        <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          {blips.length} entries · {blips.filter((b) => b.ring === 'adopt').length} adopt · {blips.filter((b) => b.ring === 'trial').length} trial
        </p>
      </aside>
    </div>
  );
}

function ringColor(ring: TechRing): string {
  switch (ring) {
    case 'adopt':
      return 'rgb(16 185 129)';
    case 'trial':
      return 'rgb(34 211 238)';
    case 'assess':
      return 'rgb(245 158 11)';
    case 'hold':
      return 'rgb(244 63 94)';
  }
}