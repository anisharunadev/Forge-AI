'use client';

/**
 * Graph tab (Zone 10) — Obsidian-style connection view scoped to F-001..F-005.
 *
 * Lightweight force-directed layout implemented in pure SVG (no React Flow
 * dependency here to keep this tab isolated). Nodes color by type, edges
 * by relationship kind. Hovering a node highlights its first-degree
 * neighbours; clicking a node opens it in the editor shell.
 */

import * as React from 'react';
import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';
import { GRAPH_EDGES, RUNBOOKS, BEST_PRACTICES } from './sample-data';
import type { Standard, Template, Policy } from '@/lib/org-knowledge/data';

interface Props {
  standards: ReadonlyArray<Standard>;
  templates: ReadonlyArray<Template>;
  policies: ReadonlyArray<Policy>;
  includeProjectScoped?: boolean;
  onOpen: (kind: 'standard' | 'template' | 'policy' | 'runbook' | 'practice', id: string) => void;
}

type ArtifactKind = 'standard' | 'template' | 'policy' | 'runbook' | 'practice';

interface Node {
  id: string;
  label: string;
  kind: ArtifactKind;
  scope: 'org' | 'project';
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Edge {
  from: string;
  to: string;
  kind: 'references' | 'supersedes' | 'depends-on' | 'related-to';
}

const KIND_COLOR: Record<ArtifactKind, string> = {
  standard: 'var(--accent-primary)',
  template: 'var(--accent-cyan)',
  policy: 'var(--accent-violet)',
  runbook: 'var(--accent-emerald)',
  practice: 'var(--accent-amber)',
};

const KIND_RADIUS: Record<ArtifactKind, number> = {
  standard: 22,
  template: 18,
  policy: 20,
  runbook: 18,
  practice: 16,
};

const EDGE_COLOR: Record<Edge['kind'], string> = {
  references: 'var(--accent-primary)',
  supersedes: 'var(--accent-rose)',
  'depends-on': 'var(--accent-amber)',
  'related-to': 'var(--fg-tertiary)',
};

const VIEW_W = 760;
const VIEW_H = 460;

function buildNodes(props: Props): Node[] {
  const nodes: Node[] = [];
  let idx = 0;
  const place = (id: string, label: string, kind: ArtifactKind, scope: 'org' | 'project'): Node => {
    const angle = (idx++ / 14) * Math.PI * 2;
    return {
      id,
      label,
      kind,
      scope,
      x: VIEW_W / 2 + Math.cos(angle) * 140,
      y: VIEW_H / 2 + Math.sin(angle) * 110,
      vx: 0,
      vy: 0,
    };
  };

  props.standards.slice(0, 6).forEach((s, i) => nodes.push(place(`F-001-${String(i + 1).padStart(3, '0')}`, s.title, 'standard', 'org')));
  props.templates.slice(0, 6).forEach((t, i) => nodes.push(place(`F-002-${String(i + 1).padStart(3, '0')}`, t.title, 'template', 'org')));
  props.policies.slice(0, 4).forEach((p, i) => nodes.push(place(`F-003-${String(i + 1).padStart(3, '0')}`, p.title, 'policy', 'org')));
  RUNBOOKS.forEach((r) => nodes.push(place(r.id, r.title, 'runbook', 'org')));
  BEST_PRACTICES.slice(0, 4).forEach((p) => nodes.push(place(p.id, p.title, 'practice', 'org')));
  return nodes;
}

function step(nodes: Node[], edges: ReadonlyArray<Edge>, iterations = 80) {
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      // Repulsion
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const b = nodes[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const force = 1800 / d2;
        a.vx += (dx / Math.sqrt(d2)) * force * 0.02;
        a.vy += (dy / Math.sqrt(d2)) * force * 0.02;
      }
      // Centering
      a.vx += (VIEW_W / 2 - a.x) * 0.0008;
      a.vy += (VIEW_H / 2 - a.y) * 0.0008;
    }
    // Spring on edges
    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.from);
      const b = nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const target = 110;
      const diff = (d - target) / d;
      a.vx += dx * diff * 0.02;
      a.vy += dy * diff * 0.02;
      b.vx -= dx * diff * 0.02;
      b.vy -= dy * diff * 0.02;
    }
    // Integrate + damp
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x = Math.max(KIND_RADIUS[n.kind], Math.min(VIEW_W - KIND_RADIUS[n.kind], n.x));
      n.y = Math.max(KIND_RADIUS[n.kind], Math.min(VIEW_H - KIND_RADIUS[n.kind], n.y));
    }
  }
}

export function ArtifactGraph({ standards, templates, policies, includeProjectScoped, onOpen }: Props) {
  const [hovered, setHovered] = React.useState<string | null>(null);

  const nodes = React.useMemo(() => buildNodes({ standards, templates, policies, includeProjectScoped, onOpen }), [
    standards,
    templates,
    policies,
    includeProjectScoped,
    onOpen,
  ]);
  const edges = React.useMemo<Edge[]>(() => {
    const out: Edge[] = [...GRAPH_EDGES];
    // Bridge: each runbook gets a "depends-on" edge to its related policy
    RUNBOOKS.forEach((r) => {
      if (r.id === 'F-004-001') out.push({ from: r.id, to: 'F-003-002', kind: 'depends-on' });
      if (r.id === 'F-004-002') out.push({ from: r.id, to: 'F-001-002', kind: 'references' });
    });
    return out.filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
  }, [nodes]);

  React.useEffect(() => {
    step(nodes, edges, 120);
  }, [nodes, edges]);

  const neighbours = React.useMemo(() => {
    if (!hovered) return new Set<string>();
    const set = new Set<string>([hovered]);
    for (const e of edges) {
      if (e.from === hovered) set.add(e.to);
      if (e.to === hovered) set.add(e.from);
    }
    return set;
  }, [hovered, edges]);

  return (
    <div className="flex flex-col gap-3" data-testid="ok-graph">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--fg-secondary)]">
        <p className="font-medium text-[var(--fg-primary)]">Knowledge graph — artifacts only</p>
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
          {nodes.length} nodes · {edges.length} edges
        </span>
        <span className="ml-auto inline-flex flex-wrap items-center gap-3">
          {(['standard', 'template', 'policy', 'runbook', 'practice'] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--fg-tertiary)]">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: KIND_COLOR[k] }}
              />
              {k}
            </span>
          ))}
        </span>
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2"
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-[460px] w-full"
          role="img"
          aria-label="Knowledge graph of standards, templates, policies, runbooks, and best practices"
          data-testid="ok-graph-svg"
        >
          <defs>
            {(Object.keys(EDGE_COLOR) as Edge['kind'][]).map((kind) => (
              <marker
                key={kind}
                id={`arrow-${kind}`}
                viewBox="0 0 10 10"
                refX="10"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_COLOR[kind]} />
              </marker>
            ))}
          </defs>
          {/* edges */}
          {edges.map((e, i) => {
            const a = nodes.find((n) => n.id === e.from);
            const b = nodes.find((n) => n.id === e.to);
            if (!a || !b) return null;
            const highlighted = hovered !== null && (hovered === e.from || hovered === e.to);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={EDGE_COLOR[e.kind]}
                strokeOpacity={highlighted ? 0.95 : 0.35}
                strokeWidth={highlighted ? 1.5 : 1}
                markerEnd={`url(#arrow-${e.kind})`}
                data-testid="ok-graph-edge"
                data-edge-kind={e.kind}
              />
            );
          })}
          {/* nodes */}
          {nodes.map((n) => {
            const r = KIND_RADIUS[n.kind];
            const isHovered = hovered === n.id;
            const isNeighbour = neighbours.has(n.id);
            const dim = hovered !== null && !isNeighbour;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onOpen(n.kind, n.id)}
                style={{ cursor: 'pointer', opacity: dim ? 0.3 : 1, transition: 'opacity 200ms' }}
                data-testid="ok-graph-node"
                data-node-id={n.id}
                data-node-kind={n.kind}
              >
                <circle r={r + 4} fill={KIND_COLOR[n.kind]} opacity={isHovered ? 0.25 : 0} />
                <circle
                  r={r}
                  fill="var(--bg-elevated)"
                  stroke={KIND_COLOR[n.kind]}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                />
                <text
                  textAnchor="middle"
                  dy="-4"
                  fontSize="9"
                  fontFamily="var(--font-mono, monospace)"
                  fill="var(--fg-tertiary)"
                >
                  {n.id}
                </text>
                <text
                  textAnchor="middle"
                  dy="8"
                  fontSize="10"
                  fontWeight={isHovered ? 700 : 500}
                  fill="var(--fg-primary)"
                >
                  {n.label.length > 16 ? `${n.label.slice(0, 14)}…` : n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </motion.div>
      <p className="text-[10px] text-[var(--fg-tertiary)]">
        Click a node to open. Hover to highlight connections. Toggle "Include
        project-scoped" above to widen the graph.
      </p>
    </div>
  );
}