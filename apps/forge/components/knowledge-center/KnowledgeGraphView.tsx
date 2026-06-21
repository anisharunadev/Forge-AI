'use client';

import * as React from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from 'reactflow';

import 'reactflow/dist/style.css';
import { NODE_COLOR } from './GraphLegend';
import type { KGEdge, KGNode, NodeKind } from '@/lib/knowledge-center/data';

export interface KnowledgeGraphViewProps {
  nodes: ReadonlyArray<KGNode>;
  edges: ReadonlyArray<KGEdge>;
  visibleKinds: ReadonlyArray<NodeKind>;
  onSelect?: (node: KGNode | null) => void;
  selectedId?: string;
  layout: 'LR' | 'TB';
  height: number;
}

function buildFlowNodes(
  nodes: ReadonlyArray<KGNode>,
  visible: ReadonlyArray<NodeKind>,
  selectedId: string | undefined,
  layout: 'LR' | 'TB',
): Node[] {
  const visibleSet = new Set(visible);
  return nodes
    .filter((n) => visibleSet.has(n.kind))
    .map((n) => {
      const x = layout === 'LR' ? n.x : n.y;
      const y = layout === 'LR' ? n.y : n.x;
      const isSelected = selectedId === n.id;
      return {
        id: n.id,
        position: { x, y },
        data: {
          label: (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wider opacity-80">
                {n.kind}
              </span>
              <span className="font-semibold">{n.label}</span>
            </div>
          ),
        },
        style: {
          background: NODE_COLOR[n.kind],
          color: '#fff',
          border: isSelected ? '2px solid #fbbf24' : '1px solid #0f172a',
          borderRadius: 8,
          padding: 6,
          fontSize: 10,
          minWidth: 130,
        },
      };
    });
}

function buildFlowEdges(
  edges: ReadonlyArray<KGEdge>,
  visibleSet: Set<string>,
): Edge[] {
  return edges
    .filter((e) => visibleSet.has(e.source) && visibleSet.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.kind,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#94a6cd' },
      labelStyle: { fill: '#c4cfe5', fontSize: 9 },
      labelBgStyle: { fill: '#1f2937' },
    }));
}

export function KnowledgeGraphView({
  nodes,
  edges,
  visibleKinds,
  onSelect,
  selectedId,
  layout,
  height,
}: KnowledgeGraphViewProps) {
  const visibleSet = React.useMemo(() => {
    const set = new Set<string>();
    const kindSet = new Set(visibleKinds);
    nodes.forEach((n) => {
      if (kindSet.has(n.kind)) set.add(n.id);
    });
    return set;
  }, [nodes, visibleKinds]);

  const flowNodes = React.useMemo(
    () => buildFlowNodes(nodes, visibleKinds, selectedId, layout),
    [nodes, visibleKinds, selectedId, layout],
  );

  const flowEdges = React.useMemo(
    () => buildFlowEdges(edges, visibleSet),
    [edges, visibleSet],
  );

  return (
    <div
      data-testid="knowledge-graph-view"
      data-nodes={flowNodes.length}
      data-edges={flowEdges.length}
      style={{ height }}
      className="rounded-md border border-forge-700/40 bg-forge-900/40"
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onNodeClick={(_: React.MouseEvent, n: { id: string }) => {
          const found = nodes.find((orig) => orig.id === n.id) ?? null;
          onSelect?.(found);
        }}
        onPaneClick={() => onSelect?.(null)}
      >
        <Background color="#1f2937" gap={16} />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
