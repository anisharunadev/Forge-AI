'use client';

/**
 * ConnectionGraph — force-directed mini-graph preview (Zone 11).
 *
 * Self-contained SVG with a hand-rolled force layout. Not as smooth as
 * React Flow for large graphs, but lighter to render in the Overview tile
 * and full-bleed for the Connections tab. When `compact` is true the
 * graph is reduced to 200px; otherwise it fills its container.
 *
 * Renders only a small handful of representative connectors + usage
 * spokes so the visual stays legible.
 */

import * as React from 'react';
import { Sparkles } from 'lucide-react';

import { listConnected, resolveIcon, STATUS_DOT_CLASS, type ConnectorHealthStatus } from '@/lib/connectors';
import { cn } from '@/lib/utils';

interface Node {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: 'forge' | 'connector' | 'service';
  label: string;
  health?: ConnectorHealthStatus;
}

interface Edge {
  from: string;
  to: string;
}

function buildGraph(width: number, height: number): { nodes: Node[]; edges: Edge[] } {
  const cx = width / 2;
  const cy = height / 2;
  const connectors = listConnected().slice(0, 12);
  const nodes: Node[] = [
    { id: 'forge', x: cx, y: cy, vx: 0, vy: 0, kind: 'forge', label: 'Forge' },
    ...connectors.map((c, i) => {
      const angle = (i / connectors.length) * Math.PI * 2;
      const r = Math.min(width, height) * 0.4;
      return {
        id: c.id,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        kind: 'connector' as const,
        label: c.displayName,
        health: c.status,
      };
    }),
  ];
  const edges: Edge[] = connectors.map((c) => ({ from: 'forge', to: c.id }));
  return { nodes, edges };
}

function simulate(nodes: Node[], edges: Edge[], width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  for (let step = 0; step < 60; step++) {
    // Center pull.
    for (const n of nodes) {
      if (n.id === 'forge') continue;
      n.vx += (cx - n.x) * 0.002;
      n.vy += (cy - n.y) * 0.002;
    }
    // Repulsion between non-forge nodes.
    for (let i = 1; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(8, Math.sqrt(dx * dx + dy * dy));
        const force = 240 / (dist * dist);
        a.vx -= dx * force * 0.04;
        a.vy -= dy * force * 0.04;
        b.vx += dx * force * 0.04;
        b.vy += dy * force * 0.04;
      }
    }
    // Edge attraction.
    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.from);
      const b = nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(8, Math.sqrt(dx * dx + dy * dy));
      const target = 90;
      const force = (dist - target) * 0.001;
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
    }
    // Integrate + clamp.
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      n.vx *= 0.86;
      n.vy *= 0.86;
      const margin = 24;
      n.x = Math.min(width - margin, Math.max(margin, n.x));
      n.y = Math.min(height - margin, Math.max(margin, n.y));
      if (n.id === 'forge') {
        n.x = cx;
        n.y = cy;
      }
    }
  }
}

export interface ConnectionGraphProps {
  readonly height?: number;
  readonly compact?: boolean;
  readonly className?: string;
}

export function ConnectionGraph({ height = 420, compact = false, className }: ConnectionGraphProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 800, h: height });

  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ w: r.width, h: height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [height]);

  const { nodes, edges } = React.useMemo(
    () => buildGraph(size.w, size.h),
    [size.w, size.h],
  );

  React.useEffect(() => {
    simulate(nodes, edges, size.w, size.h);
    // We mutate node positions in-place; the JSX reads from `nodes`.
  }, [nodes, edges, size.w, size.h]);

  const forge = nodes.find((n) => n.id === 'forge')!;

  return (
    <div
      ref={ref}
      className={cn('relative w-full overflow-hidden rounded-md bg-[var(--bg-inset)]', className)}
      style={{ height }}
      data-testid="connection-graph"
      data-compact={compact}
    >
      <svg width={size.w} height={size.h}>
        <defs>
          <radialGradient id="forge-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Edges */}
        {edges.map((e) => {
          const a = nodes.find((n) => n.id === e.from)!;
          const b = nodes.find((n) => n.id === e.to)!;
          return (
            <line
              key={`${e.from}-${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--border-default)"
              strokeWidth={1}
              strokeOpacity={0.6}
            />
          );
        })}

        {/* Connector nodes */}
        {nodes.map((n) => {
          if (n.kind === 'forge') {
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <circle r={36} fill="url(#forge-glow)" />
                <circle r={20} fill="var(--bg-elevated)" stroke="var(--accent-primary)" strokeWidth={2} />
                <text textAnchor="middle" dy="4" fontSize="11" fill="var(--fg-primary)" fontWeight={600}>
                  Forge
                </text>
              </g>
            );
          }
          const Icon = resolveIcon(n.id);
          const healthClass = n.health ? STATUS_DOT_CLASS[n.health] : 'bg-fg-tertiary';
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} className="cursor-pointer">
              <circle r={18} fill="var(--bg-elevated)" stroke="var(--border-default)" />
              {/* tiny lucide stand-in: a dot + label */}
              <text textAnchor="middle" dy="3" fontSize="9" fill="var(--fg-secondary)">
                {n.label.slice(0, 3)}
              </text>
              <circle cx={12} cy={-12} r={3} className={healthClass} />
              <text textAnchor="middle" dy={32} fontSize="10" fill="var(--fg-tertiary)">
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>

      {compact ? (
        <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 text-[10px] text-fg-tertiary">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {nodes.length - 1} connectors · click to explore
        </div>
      ) : null}
    </div>
  );
}