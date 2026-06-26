'use client';

import * as React from 'react';
import { ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';
import type { TraceabilityGraph as TraceabilityGraphType } from '@/lib/architecture/data';

const KIND_COLOR: Record<string, string> = {
  requirement: '#7c3aed',
  adr: '#2563eb',
  task: '#059669',
  test: '#d97706',
  risk: '#dc2626',
};

const KIND_LABEL: Record<string, string> = {
  requirement: 'REQ',
  adr: 'ADR',
  task: 'Task',
  test: 'Test',
  risk: 'Risk',
};

export interface TraceabilityGraphProps {
  graph: TraceabilityGraphType;
  height?: number;
}

export function TraceabilityGraph({
  graph,
  height = 420,
}: TraceabilityGraphProps) {
  const nodes = React.useMemo<Node[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        position: { x: n.x, y: n.y },
        data: {
          label: (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wider opacity-80">
                {KIND_LABEL[n.kind] ?? n.kind}
              </span>
              <span className="font-semibold">{n.label}</span>
            </div>
          ),
        },
        style: {
          background: KIND_COLOR[n.kind] ?? '#475569',
          color: '#fff',
          border: '1px solid #0f172a',
          borderRadius: 8,
          padding: 8,
          fontSize: 11,
          minWidth: 130,
        },
      })),
    [graph],
  );

  const edges = React.useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#94a6cd' },
        labelStyle: { fill: '#c4cfe5', fontSize: 10 },
        labelBgStyle: { fill: '#1f2937' },
      })),
    [graph],
  );

  return (
    <div
      data-testid="traceability-graph"
      data-graph-id={graph.id}
      style={{ height }}
      className="rounded-md border border-forge-700/40 bg-forge-900/40"
    >
      <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.2 }}>
        <Background color="#1f2937" gap={16} />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
