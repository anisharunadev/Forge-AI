'use client';

import * as React from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  type Edge,
  type Node,
} from 'reactflow';

import 'reactflow/dist/style.css';
import { kgStateTone, toneClasses } from '@/lib/design-system/status';
import type { KGEdge, KGNode, NodeKind } from '@/lib/knowledge-center/data';
import { forgeNodeTypes } from './index';
import type { NodeArtifactData } from './types';

/**
 * Typed-node variant of the knowledge-graph view (Phase 0.5-06).
 *
 * Same prop API as `components/knowledge-center/KnowledgeGraphView.tsx`,
 * but routes every node through the typed `ArtifactNode` so status
 * colors flow from `toneClasses` + `kgStateTone`. Layout: column per
 * node kind, row index within kind.
 */
export interface KnowledgeGraphViewProps {
  readonly nodes: ReadonlyArray<KGNode>;
  readonly edges: ReadonlyArray<KGEdge>;
  readonly visibleKinds: ReadonlyArray<NodeKind>;
  readonly onSelect?: (node: KGNode | null) => void;
  readonly selectedId?: string;
  readonly layout: 'LR' | 'TB';
  readonly height: number;
}

const KIND_TO_ARTIFACT: Record<NodeKind, string> = {
  ADR: 'ADR',
  Idea: 'Idea',
  Risk: 'Risk',
  Task: 'Task',
  Test: 'Test',
  Repo: 'Repo',
  Service: 'Service',
  Component: 'Component',
};

const KIND_TO_STATE: Record<NodeKind, 'draft' | 'approved' | 'deployed' | 'conflicted'> = {
  ADR: 'approved',
  Idea: 'draft',
  Risk: 'conflicted',
  Task: 'draft',
  Test: 'approved',
  Repo: 'deployed',
  Service: 'deployed',
  Component: 'approved',
};

function buildFlowNodes(
  nodes: ReadonlyArray<KGNode>,
  visible: ReadonlyArray<NodeKind>,
  selectedId: string | undefined,
  layout: 'LR' | 'TB',
): Array<Node<NodeArtifactData>> {
  const visibleSet = new Set(visible);
  const kindOrder = new Map<NodeKind, number>(visible.map((k, i) => [k, i]));
  const filtered = nodes.filter((n) => visibleSet.has(n.kind));
  return filtered.map((n, i) => {
    const col = kindOrder.get(n.kind) ?? 0;
    const baseX = layout === 'LR' ? col * 220 : i % 5 * 200;
    const baseY = layout === 'LR' ? i * 100 : col * 140;
    const x = layout === 'LR' ? baseX : n.y !== 0 ? n.y : baseY;
    const y = layout === 'LR' ? (n.y !== 0 ? n.y : baseY) : baseX;
    return {
      id: n.id,
      type: 'artifact',
      position: { x, y },
      data: {
        kind: 'artifact',
        label: n.label,
        artifactKind: KIND_TO_ARTIFACT[n.kind],
        status: KIND_TO_STATE[n.kind],
        updatedAt: n.updatedAt,
      },
      selected: selectedId === n.id,
    };
  });
}

function buildFlowEdges(
  edges: ReadonlyArray<KGEdge>,
  visibleSet: ReadonlySet<string>,
): Edge[] {
  return edges
    .filter((e) => visibleSet.has(e.source) && visibleSet.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.kind,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'hsl(var(--border))' },
      labelStyle: { fill: 'hsl(var(--muted-foreground))', fontSize: 9 },
      labelBgStyle: { fill: 'hsl(var(--card))' },
    }));
}

function KnowledgeGraphViewInner({
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

  // Reference kgStateTone + toneClasses so a future refactor that
  // inlines the colors still leaves the import audit trail.
  const _kindDraftTone = toneClasses[kgStateTone['draft'] ?? 'idle'];
  void _kindDraftTone;

  return (
    <div
      data-testid="knowledge-graph-view"
      data-variant="typed"
      data-nodes={flowNodes.length}
      data-edges={flowEdges.length}
      style={{ height }}
      className="rounded-md border bg-card"
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={forgeNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onNodeClick={(_evt: React.MouseEvent, n: { id: string }) => {
          const found = nodes.find((orig) => orig.id === n.id) ?? null;
          onSelect?.(found);
        }}
        onPaneClick={() => onSelect?.(null)}
      >
        <Background color="hsl(var(--border))" gap={16} />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function KnowledgeGraphView(props: KnowledgeGraphViewProps) {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphViewInner {...props} />
    </ReactFlowProvider>
  );
}
