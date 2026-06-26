'use client';

/**
 * Architecture Center — Traceability matrix + graph toggle.
 *
 * Default = coverage matrix (Requirements × ADRs × Tasks × Tests).
 * Cell colour encodes coverage strength. Toggle to a flat SVG node
 * view that mirrors the existing `TraceabilityGraph` React Flow viz
 * without pulling it into this client bundle.
 *
 * Skill influence:
 *   - `ux-guideline` "Tables can overflow on mobile" → `overflow-x-auto`
 *     wrapper around the matrix grid.
 *   - `09-empty-illustration.md` — empty graph shows a Network icon
 *     and a single suggestion chip.
 */

import * as React from 'react';
import { Network, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/src/components/empty-state';
import type { TraceabilityGraph, TraceabilityNode, TraceabilityEdge } from '@/lib/architecture/data';

const ROWS = [
  { id: 'requirement', label: 'Requirements' },
  { id: 'adr', label: 'ADRs' },
  { id: 'task', label: 'Tasks' },
  { id: 'test', label: 'Tests' },
] as const;

type RowId = (typeof ROWS)[number]['id'];

function coverageFor(
  row: RowId,
  cell: string,
  nodes: ReadonlyArray<TraceabilityNode>,
  edges: ReadonlyArray<TraceabilityEdge>,
): number {
  // Count edges that originate from a node of `row` kind and land on a
  // node whose label is `cell`. Returns 0 if no link exists.
  const sourceIds = nodes.filter((n) => n.kind === row).map((n) => n.id);
  const targetIds = nodes.filter((n) => n.label === cell).map((n) => n.id);
  return edges.filter(
    (e) => sourceIds.includes(e.source) && targetIds.includes(e.target),
  ).length;
}

function coverageTone(strength: number, max: number): string {
  if (max === 0 || strength === 0) return 'bg-[var(--bg-inset)] text-[var(--fg-muted)]';
  const ratio = strength / max;
  if (ratio >= 0.75) return 'bg-[rgba(16,185,129,0.22)] text-[var(--accent-emerald)]';
  if (ratio >= 0.4) return 'bg-[rgba(245,158,11,0.20)] text-[var(--accent-amber)]';
  return 'bg-[rgba(244,63,94,0.15)] text-[var(--accent-rose)]';
}

function SimpleSVGGraph({ graph }: { graph: TraceabilityGraph }) {
  const width = 720;
  const height = 360;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[360px] w-full"
      data-testid="trace-svg-graph"
      aria-label="Traceability graph"
    >
      <rect width={width} height={height} fill="transparent" />
      {graph.edges.map((e) => {
        const src = graph.nodes.find((n) => n.id === e.source);
        const tgt = graph.nodes.find((n) => n.id === e.target);
        if (!src || !tgt) return null;
        return (
          <line
            key={e.id}
            x1={src.x}
            y1={src.y}
            x2={tgt.x}
            y2={tgt.y}
            stroke="var(--accent-primary)"
            strokeOpacity={0.4}
            strokeWidth={1}
          />
        );
      })}
      {graph.nodes.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <rect x={-50} y={-14} width={100} height={28} rx={6} fill="var(--bg-surface)" stroke="var(--border-default)" />
          <text x={0} y={4} textAnchor="middle" fontSize={10} fill="var(--fg-primary)">
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export interface TraceabilityMatrixProps {
  graph: TraceabilityGraph;
}

export function TraceabilityMatrix({ graph }: TraceabilityMatrixProps) {
  const [view, setView] = React.useState<'matrix' | 'graph'>('matrix');

  if (graph.nodes.length === 0) {
    return (
      <div data-testid="traceability-empty">
        <EmptyState
          illustration={<Network size={40} strokeWidth={1.5} />}
          title="No traceability data yet"
          description="Requirement, ADR, task, test, and risk links will appear here once they are wired up."
          suggestions={['Run forge-architecture-traceability']}
        />
      </div>
    );
  }

  // Build the column set: distinct labels for every node of each kind.
  const colsByKind = (kind: RowId) =>
    Array.from(new Set(graph.nodes.filter((n) => n.kind === kind).map((n) => n.label)));

  const columnsForMatrix = ROWS.flatMap((r) => colsByKind(r.id).map((label) => ({ row: r.id, label })));

  // Compute max strength for tone scaling.
  const maxStrength = columnsForMatrix.reduce((m, c) => {
    const s = coverageFor(c.row, c.label, graph.nodes, graph.edges);
    return Math.max(m, s);
  }, 0);

  return (
    <div className="flex flex-col gap-3" data-testid="traceability-view">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--fg-tertiary)]">
          Requirement → ADR → Task → Test → Risk.
        </p>
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-0.5">
          {(['matrix', 'graph'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              data-testid={`trace-toggle-${v}`}
              aria-pressed={view === v}
              className={cn(
                'rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                view === v
                  ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]',
              )}
            >
              {v === 'matrix' ? 'Matrix' : 'Graph'}
            </button>
          ))}
        </div>
      </div>

      {view === 'matrix' ? (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)]">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-[var(--bg-elevated)] text-[var(--fg-tertiary)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide">Row ↓ / Column →</th>
                {columnsForMatrix.map((c) => (
                  <th key={`${c.row}-${c.label}`} className="px-3 py-2 text-left font-medium">
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{c.row}</span>
                    <div className="truncate text-[var(--fg-primary)]">{c.label}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.id} className="border-t border-[var(--border-subtle)]">
                  <th className="bg-[var(--bg-elevated)] px-3 py-2 text-left font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
                    {row.label}
                  </th>
                  {columnsForMatrix.map((c) => {
                    const s = coverageFor(row.id, c.label, graph.nodes, graph.edges);
                    return (
                      <td
                        key={`${row.id}-${c.label}`}
                        className={cn('px-2 py-2 align-middle', coverageTone(s, maxStrength))}
                        data-testid={`trace-cell-${row.id}-${c.label}`}
                        aria-label={`Coverage ${row.id} → ${c.label}: ${s}`}
                      >
                        <div className="flex items-center justify-center gap-1 font-mono">
                          <span>{s}</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <SimpleSVGGraph graph={graph} />
          <p className="mt-2 text-[10px] text-[var(--fg-tertiary)]">
            <ChevronDown className="inline h-3 w-3" aria-hidden="true" />
            Flat SVG view — use the Agent Center traceability map for the interactive layout.
          </p>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="self-end text-xs text-[var(--accent-primary)] hover:underline"
      >
        View full traceability map →
      </Button>
    </div>
  );
}