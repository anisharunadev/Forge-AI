'use client';

/**
 * Diagrams tab — multi-diagram explorer (Step 30 Zone 11).
 *
 * Step 30 calls for C4 Level 1-3 + data flow + sequence. We render
 * three of them (System Context, Container, Data Flow) using a
 * hand-rolled SVG layout — no React Flow for read-only viz, since
 * the existing TraceabilityGraph already uses xyflow for the
 * editable interactive case.
 *
 * Skill influence:
 *   - `style` (Data-Dense Dashboard) — minimal padding, clean
 *     borders, every node clickable to surface details.
 *   - `ux-guideline` "Tables can overflow on mobile" — diagrams
 *     have overflow-auto; sidebar can collapse below 1024px.
 */

import * as React from 'react';
import { Network, ZoomIn, ZoomOut, RotateCcw, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/empty-state';
import type { C4Diagram, DiagramNode } from '@/lib/architecture/mock-fixtures';

const LAYER_TONE: Record<DiagramNode['layer'], string> = {
  user: 'fill-indigo-500/15 stroke-indigo-400',
  gateway: 'fill-cyan-500/15 stroke-cyan-400',
  service: 'fill-emerald-500/15 stroke-emerald-400',
  data: 'fill-amber-500/15 stroke-amber-400',
  external: 'fill-slate-500/15 stroke-slate-400',
};

const LAYER_LABEL: Record<DiagramNode['layer'], string> = {
  user: 'User',
  gateway: 'Gateway',
  service: 'Service',
  data: 'Data',
  external: 'External',
};

export interface DiagramsExplorerProps {
  diagrams: ReadonlyArray<C4Diagram>;
}

export function DiagramsExplorer({ diagrams }: DiagramsExplorerProps) {
  const [activeId, setActiveId] = React.useState<string | null>(diagrams[0]?.id ?? null);
  const [zoom, setZoom] = React.useState(1);
  const [selected, setSelected] = React.useState<DiagramNode | null>(null);
  const [visibleLayers, setVisibleLayers] = React.useState<Set<DiagramNode['layer']>>(
    () => new Set(['user', 'gateway', 'service', 'data', 'external']),
  );

  const active = diagrams.find((d) => d.id === activeId);

  if (diagrams.length === 0) {
    return (
      <EmptyState
        illustration={<Network size={40} strokeWidth={1.5} />}
        title="No diagrams yet"
        description="Diagrams are auto-generated from your architecture entities."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Diagram selector */}
      <aside className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          Diagrams
        </p>
        <ul className="flex flex-col gap-1" role="list">
          {diagrams.map((d) => {
            const isActive = d.id === activeId;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(d.id)}
                  aria-pressed={isActive}
                  className={cn(
                    'w-full rounded-[var(--radius-md)] border px-3 py-2 text-left text-xs transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                    isActive
                      ? 'border-[var(--accent-primary)]/50 bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:border-[var(--border-default)]',
                  )}
                >
                  <span className="block font-medium">{d.name}</span>
                  <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{d.level}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {active ? (
          <>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
              Layers
            </p>
            <ul className="flex flex-col gap-1">
              {(Object.keys(LAYER_LABEL) as DiagramNode['layer'][]).map((layer) => {
                const enabled = visibleLayers.has(layer);
                return (
                  <li key={layer}>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() =>
                          setVisibleLayers((prev) => {
                            const next = new Set(prev);
                            if (next.has(layer)) next.delete(layer);
                            else next.add(layer);
                            return next;
                          })
                        }
                        className="h-3.5 w-3.5 rounded border-[var(--border-default)] bg-[var(--bg-inset)] accent-[var(--accent-primary)]"
                      />
                      <span className={cn('inline-block h-2 w-2 rounded-full border', LAYER_TONE[layer])} aria-hidden="true" />
                      {LAYER_LABEL[layer]}
                    </label>
                  </li>
                );
              })}
            </ul>

            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
              Controls
            </p>
            <div className="flex flex-wrap gap-1">
              <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(2, z + 0.15))} className="h-7 px-2">
                <ZoomIn className="h-3 w-3" aria-hidden="true" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))} className="h-7 px-2">
                <ZoomOut className="h-3 w-3" aria-hidden="true" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setZoom(1)} className="h-7 px-2">
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Export as JSON snapshot of the active diagram.
                  const blob = new Blob([JSON.stringify(active, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${active.id}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="h-7 px-2"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
          </>
        ) : null}
      </aside>

      {/* Canvas */}
      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        {active ? (
          <>
            <header className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{active.name}</h3>
                <p className="text-xs text-[var(--fg-tertiary)]">{active.description}</p>
              </div>
              <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                zoom {Math.round(zoom * 100)}%
              </span>
            </header>

            <div className="overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
              <svg
                viewBox="0 0 800 600"
                className="w-full"
                style={{ minHeight: 360, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                role="img"
                aria-label={`${active.name} diagram`}
              >
                {/* Edges first */}
                {active.edges.map((e) => {
                  const src = active.nodes.find((n) => n.id === e.source);
                  const tgt = active.nodes.find((n) => n.id === e.target);
                  if (!src || !tgt) return null;
                  if (!visibleLayers.has(src.layer) || !visibleLayers.has(tgt.layer)) return null;
                  return (
                    <g key={e.id}>
                      <line
                        x1={src.x}
                        y1={src.y}
                        x2={tgt.x}
                        y2={tgt.y}
                        stroke="var(--border-default)"
                        strokeWidth={1.5}
                        strokeDasharray={src.layer === 'external' ? '4 3' : undefined}
                      />
                      {e.label ? (
                        <text
                          x={(src.x + tgt.x) / 2}
                          y={(src.y + tgt.y) / 2 - 4}
                          fontSize={9}
                          fill="var(--fg-tertiary)"
                          textAnchor="middle"
                          className="font-mono"
                        >
                          {e.label}
                        </text>
                      ) : null}
                    </g>
                  );
                })}

                {/* Nodes */}
                {active.nodes.map((n) => {
                  if (!visibleLayers.has(n.layer)) return null;
                  const isSelected = selected?.id === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      onClick={() => setSelected(isSelected ? null : n)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        x={-70}
                        y={-22}
                        width={140}
                        height={44}
                        rx={6}
                        className={cn('transition-all', LAYER_TONE[n.layer], isSelected && 'stroke-2')}
                        strokeWidth={isSelected ? 2 : 1}
                      />
                      <text x={0} y={-4} fontSize={11} fill="var(--fg-primary)" textAnchor="middle" fontWeight={600}>
                        {n.label}
                      </text>
                      <text x={0} y={11} fontSize={9} fill="var(--fg-tertiary)" textAnchor="middle">
                        {LAYER_LABEL[n.layer]}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {selected ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--fg-primary)]">{selected.label}</p>
                    <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                      layer: {LAYER_LABEL[selected.layer]}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="h-6 px-2 text-[10px]">
                    close
                  </Button>
                </div>
                <p className="mt-2 text-[var(--fg-secondary)]">{selected.details}</p>
              </div>
            ) : (
              <p className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                Click a node to see details. Drag zoom controls to inspect a region.
              </p>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}