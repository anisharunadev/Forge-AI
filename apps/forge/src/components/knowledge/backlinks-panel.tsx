'use client';

/**
 * Obsidian-style backlinks panel (Zone 12).
 *
 * Mounted on every artifact editor. Shows:
 *   - "Referenced by" (other artifacts that link to this one)
 *   - "References"    (artifacts this one links to)
 *   - Mini connection preview (3-7 nodes)
 *
 * Clicking any backlink navigates to that artifact via the editor's
 * `onSelect` callback.
 */

import * as React from 'react';
import { ArrowLeft, ArrowRight, Network } from 'lucide-react';

import { cn } from '@/lib/utils';
import { GRAPH_EDGES } from './sample-data';

interface BacklinkRef {
  id: string;
  label: string;
  kind: 'standard' | 'template' | 'policy' | 'runbook' | 'practice';
}

interface Props {
  artifactId: string;
  /** Optional override of derived backlinks. */
  referencesBy?: BacklinkRef[];
  referencesTo?: BacklinkRef[];
  onSelect: (kind: BacklinkRef['kind'], id: string) => void;
}

const KIND_COLOR: Record<BacklinkRef['kind'], string> = {
  standard: 'var(--accent-primary)',
  template: 'var(--accent-cyan)',
  policy: 'var(--accent-violet)',
  runbook: 'var(--accent-emerald)',
  practice: 'var(--accent-amber)',
};

const KIND_PREFIX: Record<BacklinkRef['kind'], string> = {
  standard: 'F-001',
  template: 'F-002',
  policy: 'F-003',
  runbook: 'F-004',
  practice: 'F-005',
};

const ALL_ARTEFACTS: ReadonlyArray<BacklinkRef> = [
  { id: 'F-001-005', label: 'API versioning policy', kind: 'standard' },
  { id: 'F-001-001', label: 'Service ownership standard', kind: 'standard' },
  { id: 'F-001-002', label: 'Incident severity ladder', kind: 'standard' },
  { id: 'F-002-001', label: 'PRD template v3', kind: 'template' },
  { id: 'F-002-002', label: 'ADR template', kind: 'template' },
  { id: 'F-002-003', label: 'Bug report template', kind: 'template' },
  { id: 'F-003-001', label: 'PII handling policy', kind: 'policy' },
  { id: 'F-003-002', label: 'Secret rotation policy', kind: 'policy' },
  { id: 'F-004-001', label: 'Payment service outage', kind: 'runbook' },
  { id: 'F-004-002', label: 'Database failover', kind: 'runbook' },
  { id: 'F-005-001', label: 'Effective code reviews', kind: 'practice' },
  { id: 'F-005-005', label: 'Documenting decisions', kind: 'practice' },
];

function deriveBacklinks(artifactId: string): { by: BacklinkRef[]; to: BacklinkRef[] } {
  const to = GRAPH_EDGES.filter((e) => e.from === artifactId)
    .map((e) => ALL_ARTEFACTS.find((a) => a.id === e.to))
    .filter((x): x is BacklinkRef => Boolean(x));
  const by = GRAPH_EDGES.filter((e) => e.to === artifactId)
    .map((e) => ALL_ARTEFACTS.find((a) => a.id === e.from))
    .filter((x): x is BacklinkRef => Boolean(x));
  // Always show at least one placeholder so the panel never feels empty.
  if (to.length === 0 && by.length === 0) {
    return {
      to: [{ id: `${KIND_PREFIX.template}-002`, label: 'ADR template', kind: 'template' }],
      by: [],
    };
  }
  return { by, to };
}

export function BacklinksPanel({ artifactId, referencesBy, referencesTo, onSelect }: Props) {
  const derived = React.useMemo(() => deriveBacklinks(artifactId), [artifactId]);
  const by = referencesBy ?? derived.by;
  const to = referencesTo ?? derived.to;

  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
      data-testid="ok-backlinks"
      aria-label="Backlinks"
    >
      <header className="mb-2 flex items-center gap-2">
        <Network className="h-3.5 w-3.5 text-[var(--accent-violet)]" aria-hidden="true" />
        <h3 className="text-xs font-semibold text-[var(--fg-primary)]">Connections</h3>
      </header>

      <BacklinkList
        title="Referenced by"
        icon={<ArrowLeft className="h-2.5 w-2.5" aria-hidden="true" />}
        empty="No incoming links yet."
        items={by}
        onSelect={onSelect}
        testIdPrefix="ok-backlinks-by"
      />
      <BacklinkList
        title="References"
        icon={<ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />}
        empty="No outgoing links yet."
        items={to}
        onSelect={onSelect}
        testIdPrefix="ok-backlinks-to"
      />

      <MiniGraph artifactId={artifactId} links={[...by, ...to]} />
    </section>
  );
}

function BacklinkList({
  title,
  icon,
  items,
  empty,
  onSelect,
  testIdPrefix,
}: {
  title: string;
  icon: React.ReactNode;
  items: ReadonlyArray<BacklinkRef>;
  empty: string;
  onSelect: (kind: BacklinkRef['kind'], id: string) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
        {icon}
        {title}
        <span className="font-mono text-[var(--fg-tertiary)]">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="text-[10px] text-[var(--fg-muted)]">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((ref) => (
            <li key={ref.id}>
              <button
                type="button"
                onClick={() => onSelect(ref.kind, ref.id)}
                data-testid={testIdPrefix}
                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: KIND_COLOR[ref.kind] }}
                />
                <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{ref.id}</span>
                <span className="truncate">{ref.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniGraph({ artifactId, links }: { artifactId: string; links: ReadonlyArray<BacklinkRef> }) {
  if (links.length === 0) return null;
  const center = { x: 80, y: 50 };
  const ring = links.slice(0, 6).map((l, i, arr) => {
    const angle = (i / Math.max(1, arr.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...l, x: center.x + Math.cos(angle) * 32, y: center.y + Math.sin(angle) * 26 };
  });

  return (
    <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
        Local connections
      </p>
      <svg viewBox="0 0 160 100" className="h-24 w-full" aria-hidden="true">
        {ring.map((n) => (
          <line
            key={n.id}
            x1={center.x}
            y1={center.y}
            x2={n.x}
            y2={n.y}
            stroke={KIND_COLOR[n.kind]}
            strokeOpacity={0.5}
            strokeWidth={1}
          />
        ))}
        <circle cx={center.x} cy={center.y} r={9} fill="var(--accent-primary)" />
        <text x={center.x} y={center.y + 3} textAnchor="middle" fontSize="8" fill="white" fontFamily="monospace">
          ★
        </text>
        {ring.map((n) => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={5} fill={KIND_COLOR[n.kind]} />
          </g>
        ))}
      </svg>
      <p className="mt-1 font-mono text-[9px] text-[var(--fg-tertiary)]">
        ★ {artifactId} · {ring.length} neighbour{ring.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}