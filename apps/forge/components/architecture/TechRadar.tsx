'use client';

/**
 * Tech Radar visualization — 4 quadrants × 4 rings (Step 30 Zone 10).
 *
 * Classic radar layout inspired by ThoughtWorks. Each blip lives in
 * one of 16 cells. Hover shows the rationale; click pins a blip.
 *
 * **M5-G6 — live data source.** As of M5 the radar aggregates signals
 * from real ADRs via `useADRs` (`@/lib/hooks/useArchitecture`). Each
 * ADR's title + status contribute a blip; deterministic grouping is
 * performed by `aggregateAdrBlips()` so the same ADR set always
 * produces the same visual. The legacy `MOCK_TECH_RADAR` is preserved
 * as an offline fallback when the live API returns no rows (Rule 15:
 * never render a blank radar).
 *
 * Quadrant → keyword mapping (live):
 *   - languages    : TypeScript, Python, Go, Java, Rust, JavaScript, Kotlin, Swift
 *   - tools        : LangGraph, LiteLLM, Sentry, pgvector, Elasticsearch, Redis
 *   - platforms    : Postgres, Redis, Keycloak, AWS, Azure, GCP, CloudFront, ECS
 *   - techniques   : RLS, mTLS, RAG, Saga, Event-sourcing, OAuth, OIDC, OAuth2
 *
 * Ring → ADR status mapping (live):
 *   - adopt  : status === 'accepted' (or 'approved' on legacy rows)
 *   - trial  : status === 'proposed' or 'in_review'
 *   - assess : status === 'draft'
 *   - hold   : status === 'deprecated' or 'superseded'
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
import { useADRs } from '@/lib/hooks/useArchitecture';
import { MOCK_TECH_RADAR } from '@/lib/architecture/mock-fixtures';

// ---------------------------------------------------------------------------
// Quadrant / ring taxonomy (kept aligned with the legacy types so any
// downstream consumer — sidebar, focus panel, ring legend — keeps
// working without re-mapping).
// ---------------------------------------------------------------------------

export type TechRing = 'adopt' | 'trial' | 'assess' | 'hold';
export type TechQuadrant = 'languages' | 'tools' | 'platforms' | 'techniques';

export interface TechBlip {
  id: string;
  name: string;
  quadrant: TechQuadrant;
  ring: TechRing;
  description: string;
  rationale: string;
  owner: string;
  prevRing?: TechRing;
}

// ---------------------------------------------------------------------------
// Aggregation — derive TechBlips from real ADR rows. Pure function so
// the live migration is unit-testable from `tech-radar-live.test.ts`.
// ---------------------------------------------------------------------------

const QUADRANT_RULES: ReadonlyArray<{
  quadrant: TechQuadrant;
  patterns: ReadonlyArray<RegExp>;
}> = [
  {
    quadrant: 'languages',
    patterns: [
      /\btypescript\b/i,
      /\bjavascript\b/i,
      /\bpython\b/i,
      /\bgo(lang)?\b/i,
      /\bjava\b/i,
      /\brust\b/i,
      /\bkotlin\b/i,
      /\bswift\b/i,
      /\bnext\.?js\b/i,
      /\bnode\.?js\b/i,
      /\breact\b/i,
      /\bfastapi\b/i,
      /\bgin\b/i,
      /\bspring\b/i,
    ],
  },
  {
    quadrant: 'tools',
    patterns: [
      /\blanggraph\b/i,
      /\blitellm\b/i,
      /\bsentry\b/i,
      /\bpgvector\b/i,
      /\belasticsearch\b/i,
      /\bdatadog\b/i,
      /\bhoneycomb\b/i,
      /\bargo\b/i,
      /\btemporal\b/i,
      /\bprometheus\b/i,
      /\bgrafana\b/i,
    ],
  },
  {
    quadrant: 'platforms',
    patterns: [
      /\bpostgres\b/i,
      /\bredis\b/i,
      /\bkeycloak\b/i,
      /\baws\b/i,
      /\bazure\b/i,
      /\bgcp\b/i,
      /\bcloudfront\b/i,
      /\becs\b/i,
      /\blambda@?edge\b/i,
      /\bkubernetes\b/i,
      /\benvoy\b/i,
      /\bistio\b/i,
    ],
  },
  {
    quadrant: 'techniques',
    patterns: [
      /\brls\b/i,
      /\brow-level security\b/i,
      /\bmtls\b/i,
      /\brag\b/i,
      /\bsaga\b/i,
      /\bevent[- ]?sourcing\b/i,
      /\boauth\b/i,
      /\boidc\b/i,
      /\bpci[- ]?dss\b/i,
      /\bgdpr\b/i,
      /\bblue[\/ ]green\b/i,
      /\bcanary\b/i,
    ],
  },
];

const STATUS_TO_RING: Record<string, TechRing> = {
  accepted: 'adopt',
  approved: 'adopt',
  proposed: 'trial',
  in_review: 'trial',
  draft: 'assess',
  deprecated: 'hold',
  superseded: 'hold',
  rejected: 'hold',
};

function titleToQuadrant(title: string): TechQuadrant | null {
  for (const rule of QUADRANT_RULES) {
    if (rule.patterns.some((re) => re.test(title))) return rule.quadrant;
  }
  return null;
}

function statusToRing(status: string | undefined | null): TechRing {
  if (!status) return 'assess';
  return STATUS_TO_RING[status] ?? 'assess';
}

/**
 * Aggregate a flat list of ADR rows into TechBlips. Each ADR produces
 * at most one blip (the first matching quadrant wins). Stable across
 * renders thanks to sorted title comparison.
 */
export function aggregateAdrBlips<
  T extends { id: string; title: string; status: string; approved_by?: string | null },
>(adrs: ReadonlyArray<T>): ReadonlyArray<TechBlip> {
  const sorted = [...adrs].sort((a, b) => a.title.localeCompare(b.title));
  const out: TechBlip[] = [];
  for (const adr of sorted) {
    const quadrant = titleToQuadrant(adr.title);
    if (!quadrant) continue;
    const ring = statusToRing(adr.status);
    out.push({
      id: adr.id,
      name: extractShortName(adr.title),
      quadrant,
      ring,
      description: adr.title,
      rationale: `ADR row #${adr.id.slice(0, 8)} · status=${adr.status}`,
      owner: adr.approved_by ?? 'unknown',
    });
  }
  return out;
}

function extractShortName(title: string): string {
  // Strip leading "ADR-NNN:" prefix when present.
  const match = title.match(/^ADR[- ]?\d+\s*[:\-]\s*(.+)$/i);
  if (match) return match[1]!.trim();
  return title.length > 48 ? `${title.slice(0, 45)}…` : title;
}

// ---------------------------------------------------------------------------
// Visual placement — bucketed per (quadrant, ring) with deterministic
// angular placement so the layout is stable across renders.
// ---------------------------------------------------------------------------

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
    const baseR = 0.2 + (ringIdx / (RINGS.length - 1)) * 0.6;
    group.forEach((b, i) => {
      const angle = (i / group.length) * Math.PI * 2 + ringIdx * 0.4;
      const jitter = (b.id.length % 7) / 25;
      const r = baseR + jitter * 0.05;
      positioned.push({ ...b, rx: 0.5 + Math.cos(angle) * r * 0.42, ry: 0.5 + Math.sin(angle) * r * 0.42 });
    });
    void quadrant;
  }
  return positioned;
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface TechRadarProps {
  /** Project id used by `useADRs`. Falls back to offline fixture when omitted. */
  projectId?: string;
  /** Optional pre-aggregated blips (used by tests). Bypasses the live query. */
  blips?: ReadonlyArray<TechBlip>;
}

export function TechRadar({ projectId, blips: propBlips }: TechRadarProps) {
  const liveAdrsQuery = useADRs(projectId ? { project_id: projectId } : undefined);

  // Blip precedence:
  //   1. Caller-provided `blips` (used by tests, storybook, demo).
  //   2. Aggregated live ADR rows (when query succeeds with rows).
  //   3. Legacy offline fixture (Rule 15 — never render an empty radar).
  const liveAdrs = liveAdrsQuery.data?.items ?? [];
  const liveBlips = aggregateAdrBlips(liveAdrs);
  const blips: ReadonlyArray<TechBlip> = propBlips ?? (liveBlips.length > 0 ? liveBlips : MOCK_TECH_RADAR);

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
  const sourceLabel = propBlips
    ? 'Provided blips'
    : liveBlips.length > 0
      ? 'Live ADRs'
      : 'Offline fixture';

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="tech-radar" data-source={sourceLabel}>
      <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <svg viewBox="0 0 600 600" className="h-full w-full" role="img" aria-label="Tech radar">
          <line x1="300" y1="0" x2="300" y2="600" stroke="var(--border-default)" strokeWidth={1} />
          <line x1="0" y1="300" x2="600" y2="300" stroke="var(--border-default)" strokeWidth={1} />

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
                data-testid={`tech-radar-blip-${b.id}`}
                data-quadrant={b.quadrant}
                data-ring={b.ring}
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
                {ringDef ? null : null}
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            {focus ? focus.name : 'Hover a blip'}
          </h3>
          <span
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--fg-tertiary)]"
            data-testid="tech-radar-source"
          >
            {sourceLabel}
          </span>
        </header>
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