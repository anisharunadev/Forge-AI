'use client';

import * as React from 'react';
import { Network } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { KnowledgeGraphView } from '@/components/graph';
import { GraphControls } from '@/components/knowledge-center/GraphControls';
import { GraphLegend } from '@/components/knowledge-center/GraphLegend';
import { GraphSearch } from '@/components/knowledge-center/GraphSearch';
import { NodeInspector } from '@/components/knowledge-center/NodeInspector';
import { useApiData } from '@/hooks/use-api-data';
import type { KGNode, KGEdge, NodeKind } from '@/lib/knowledge-center/data';

const ALL_KINDS: ReadonlyArray<NodeKind> = [
  'Repo',
  'Service',
  'Component',
  'ADR',
  'Idea',
  'Risk',
  'Task',
  'Test',
];

export default function KnowledgeCenterPage() {
  const nodesRes = useApiData<ReadonlyArray<KGNode>>(
    '/v1/knowledge-center/nodes',
  );
  const edgesRes = useApiData<ReadonlyArray<KGEdge>>(
    '/v1/knowledge-center/edges',
  );

  const nodes = nodesRes.data ?? [];
  const edges = edgesRes.data ?? [];

  const [visible, setVisible] = React.useState<ReadonlyArray<NodeKind>>(ALL_KINDS);
  const [selected, setSelected] = React.useState<KGNode | null>(null);
  const [layout, setLayout] = React.useState<'LR' | 'TB'>('LR');
  const [showLegend, setShowLegend] = React.useState(true);

  const toggleKind = (kind: NodeKind) => {
    setVisible((curr) =>
      curr.includes(kind) ? curr.filter((k) => k !== kind) : [...curr, kind],
    );
  };

  return (
    <AdminShell>
      <div className="flex flex-col gap-4" data-testid="knowledge-graph-page">
          <header className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Center
            </p>
            <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                <Network className="h-5 w-5" aria-hidden="true" />
                Knowledge Graph
              </h1>
              <div className="flex items-center gap-2">
                <GraphSearch nodes={nodes} onPick={setSelected} />
                <GraphControls layout={layout} onLayoutChange={setLayout} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Unified view across repos, services, ADRs, ideas, risks, tasks,
              and tests. Click a node to inspect.
            </p>
          </header>

          {showLegend ? (
            <section
              aria-label="Legend"
              className="flex flex-col gap-2 rounded-md border border-forge-700/40 bg-forge-900/40 p-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xs uppercase tracking-wider text-forge-300">
                  Node kinds
                </h2>
                <button
                  type="button"
                  onClick={() => setShowLegend((v) => !v)}
                  className="text-xs text-forge-300 underline-offset-2 hover:underline"
                  data-testid="legend-toggle"
                >
                  Hide
                </button>
              </div>
              <GraphLegend visibleKinds={visible} onToggle={toggleKind} />
            </section>
          ) : (
            <button
              type="button"
              onClick={() => setShowLegend(true)}
              className="self-start text-xs text-forge-300 underline-offset-2 hover:underline"
              data-testid="legend-toggle"
            >
              Show legend
            </button>
          )}

          <KnowledgeGraphView
            nodes={nodes}
            edges={edges}
            visibleKinds={visible}
            onSelect={setSelected}
            selectedId={selected?.id}
            layout={layout}
            height={560}
          />

          <NodeInspector
            node={selected}
            edges={edges}
            allNodes={nodes}
            open={selected != null}
            onOpenChange={(open) => {
              if (!open) setSelected(null);
            }}
          />
        </div>
    </AdminShell>
  );
}
