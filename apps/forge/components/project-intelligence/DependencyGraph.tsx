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
import type { DependencyGraph } from '@/lib/project-intelligence/data';

function toFlowNodes(graph: DependencyGraph): Node[] {
  return graph.services.map((s) => ({
    id: s.id,
    position: { x: s.x, y: s.y },
    data: { label: s.label },
    style: {
      background: '#1e293b',
      color: '#c4cfe5',
      border: '1px solid #243152',
      borderRadius: 6,
      padding: 6,
      fontSize: 11,
    },
  }));
}

function toFlowEdges(graph: DependencyGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.cycle === true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: e.cycle ? '#f59e0b' : '#64748b',
      strokeWidth: e.cycle ? 2 : 1,
    },
  }));
}

export interface DependencyGraphViewProps {
  graph: DependencyGraph;
  height?: number;
}

export function DependencyGraphView({
  graph,
  height = 500,
}: DependencyGraphViewProps) {
  const nodes = React.useMemo(() => toFlowNodes(graph), [graph]);
  const edges = React.useMemo(() => toFlowEdges(graph), [graph]);
  const cycles = graph.edges.filter((e) => e.cycle).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-forge-300">
        {graph.edges.length} edges · {cycles} on cycle paths (orange, animated).
      </p>
      <div
        data-testid="dependency-graph"
        data-edges={graph.edges.length}
        data-cycles={cycles}
        style={{ height }}
        className="rounded-md border border-forge-700/40 bg-forge-900/40"
      >
        <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.2 }}>
          <Background color="#1f2937" gap={16} />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
