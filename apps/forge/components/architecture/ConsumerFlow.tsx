'use client';

/**
 * ConsumerFlow — Sankey-style call flow for API Consumers tab.
 * Renders upstream consumers → service → downstream call counts as
 * a hand-rolled SVG layer. Avoids d3-sankey dependency.
 */

import * as React from 'react';
import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';

interface FlowNode {
  id: string;
  label: string;
  x: number; // 0..1
  y: number; // 0..1
  callsPerDay: number;
  errorRate: number;
}

interface FlowEdge {
  from: string;
  to: string;
  weight: number;
}

const SOURCE_NODES: FlowNode[] = [
  { id: 'dashboard', label: 'dashboard', x: 0.05, y: 0.18, callsPerDay: 1240, errorRate: 0.012 },
  { id: 'cli', label: 'cli', x: 0.05, y: 0.42, callsPerDay: 870, errorRate: 0.018 },
  { id: 'github-bot', label: 'github-bot', x: 0.05, y: 0.62, callsPerDay: 540, errorRate: 0.022 },
  { id: 'orchestrator', label: 'orchestrator', x: 0.05, y: 0.82, callsPerDay: 2200, errorRate: 0.008 },
];

const TARGET_NODES: FlowNode[] = [
  { id: 't-models', label: '/v1/models', x: 0.95, y: 0.22, callsPerDay: 680, errorRate: 0.005 },
  { id: 't-runs', label: '/v1/runs', x: 0.95, y: 0.5, callsPerDay: 1380, errorRate: 0.011 },
  { id: 't-search', label: '/v1/search', x: 0.95, y: 0.78, callsPerDay: 920, errorRate: 0.017 },
];

const EDGES: FlowEdge[] = [
  { from: 'dashboard', to: 't-models', weight: 480 },
  { from: 'dashboard', to: 't-runs', weight: 760 },
  { from: 'cli', to: 't-runs', weight: 540 },
  { from: 'cli', to: 't-search', weight: 330 },
  { from: 'github-bot', to: 't-runs', weight: 380 },
  { from: 'github-bot', to: 't-search', weight: 160 },
  { from: 'orchestrator', to: 't-models', weight: 200 },
  { from: 'orchestrator', to: 't-runs', weight: 800 },
  { from: 'orchestrator', to: 't-search', weight: 1200 },
];

export function ConsumerFlow() {
  const w = 720;
  const h = 320;
  const all = [...SOURCE_NODES, ...TARGET_NODES];
  const nodeById = Object.fromEntries(all.map((n) => [n.id, n]));

  // Vertical thickness proportional to calls/day
  const maxCalls = Math.max(...all.map((n) => n.callsPerDay));
  const thickness = (calls: number) => Math.max(8, (calls / maxCalls) * 36);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3" data-testid="consumer-flow">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ minHeight: 280 }} role="img" aria-label="Consumer call flow Sankey">
        <defs>
          {EDGES.map((e, i) => (
            <linearGradient key={i} id={`g-${i}`} x1="0" x2="1">
              <stop offset="0%" stopColor="var(--accent-indigo)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity={0.35} />
            </linearGradient>
          ))}
        </defs>

        {/* Edges first */}
        {EDGES.map((e, i) => {
          const src = nodeById[e.from];
          const tgt = nodeById[e.to];
          if (!src || !tgt) return null;
          const x1 = src.x * w;
          const x2 = tgt.x * w;
          const y1 = src.y * h;
          const y2 = tgt.y * h;
          const t = (e.weight / maxCalls) * 12 + 4;
          return (
            <motion.path
              key={`e-${i}`}
              d={`M${x1} ${y1 - t / 2} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2 - t / 2} L${x2} ${y2 + t / 2} C${(x1 + x2) / 2} ${y2}, ${(x1 + x2) / 2} ${y1}, ${x1} ${y1 + t / 2} Z`}
              fill={`url(#g-${i})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: i * 0.04 }}
            />
          );
        })}

        {/* Nodes */}
        {all.map((n) => {
          const t = thickness(n.callsPerDay);
          return (
            <g key={n.id} transform={`translate(${n.x * w}, ${n.y * h})`}>
              <rect x={-6} y={-t / 2} width={12} height={t} rx={3} className="fill-[var(--accent-primary)]" opacity={0.9} />
              <text
                x={n.x < 0.5 ? -14 : 14}
                y={-t / 2 - 4}
                fontSize={10}
                fill="var(--fg-primary)"
                textAnchor={n.x < 0.5 ? 'end' : 'start'}
                className="font-mono"
              >
                {n.label}
              </text>
              <text
                x={n.x < 0.5 ? -14 : 14}
                y={-t / 2 + 8}
                fontSize={9}
                fill="var(--fg-tertiary)"
                textAnchor={n.x < 0.5 ? 'end' : 'start'}
                className="font-mono"
              >
                {n.callsPerDay}/d · {(n.errorRate * 100).toFixed(1)}%
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--fg-tertiary)]">
        <span>Source consumers → Service endpoints. Stroke thickness = call volume.</span>
        <span className="font-mono">
          total {SOURCE_NODES.reduce((s, n) => s + n.callsPerDay, 0).toLocaleString()} calls/day
        </span>
      </div>
    </div>
  );
}
