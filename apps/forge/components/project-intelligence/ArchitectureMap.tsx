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
import type { DependencyGraph, ServiceNode } from '@/lib/project-intelligence/data';

const KIND_COLOR: Record<ServiceNode['kind'], string> = {
  service: '#2563eb',
  component: '#0891b2',
  datastore: '#059669',
};

function toFlowNodes(graph: DependencyGraph): Node[] {
  return graph.services.map((s) => ({
    id: s.id,
    position: { x: s.x, y: s.y },
    data: {
      label: (
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider opacity-80">
            {s.kind}
          </span>
          <span className="font-semibold">{s.label}</span>
          <span className="text-[10px] opacity-80">{s.language}</span>
        </div>
      ),
    },
    style: {
      background: KIND_COLOR[s.kind],
      color: '#fff',
      border: '1px solid #0f172a',
      borderRadius: 8,
      padding: 8,
      fontSize: 11,
      minWidth: 140,
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
      stroke: e.cycle ? '#f59e0b' : '#94a6cd',
      strokeWidth: e.cycle ? 2 : 1,
    },
  }));
}

export interface ArchitectureMapProps {
  graph: DependencyGraph;
  height?: number;
}

export function ArchitectureMap({ graph, height = 500 }: ArchitectureMapProps) {
  const nodes = React.useMemo(() => toFlowNodes(graph), [graph]);
  const edges = React.useMemo(() => toFlowEdges(graph), [graph]);
  return (
    <div
      data-testid="architecture-map"
      data-nodes={nodes.length}
      data-edges={edges.length}
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
