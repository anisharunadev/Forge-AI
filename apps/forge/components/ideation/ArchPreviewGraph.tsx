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
import type { ArchPreview } from '@/lib/ideation/data';

const KIND_COLOR: Record<string, string> = {
  service: '#2563eb',
  database: '#059669',
  queue: '#d97706',
  external: '#7c3aed',
};

function toFlowNodes(preview: ArchPreview): Node[] {
  return preview.nodes.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label },
    style: {
      background: KIND_COLOR[n.kind] ?? '#475569',
      color: '#fff',
      border: '1px solid #1e293b',
      borderRadius: 6,
      fontSize: 12,
      padding: 8,
    },
  }));
}

function toFlowEdges(preview: ArchPreview): Edge[] {
  return preview.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#94a6cd' },
    labelStyle: { fill: '#c4cfe5', fontSize: 10 },
  }));
}

export interface ArchPreviewGraphProps {
  preview: ArchPreview;
  height?: number;
}

export function ArchPreviewGraph({ preview, height = 320 }: ArchPreviewGraphProps) {
  const nodes = React.useMemo(() => toFlowNodes(preview), [preview]);
  const edges = React.useMemo(() => toFlowEdges(preview), [preview]);

  return (
    <div
      data-testid="arch-preview-graph"
      data-preview-id={preview.id}
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
