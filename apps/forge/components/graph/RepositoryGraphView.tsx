'use client';

import * as React from 'react';
import { ReactFlow,
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';
import { forgeNodeTypes } from './index';
import type { NodeRepoFileData, NodeServiceData } from './types';

/**
 * Repository graph — one root service node per repo, plus a
 * `RepoFileNode` per file. Files are laid out by top-level folder
 * (column per folder, row per file).
 */
export interface RepoFileInput {
  readonly id: string;
  readonly path: string;
  readonly language: string;
  readonly loc?: number;
}

export interface RepositoryGraphViewProps {
  readonly repo: { readonly id: string; readonly name: string };
  readonly files: ReadonlyArray<RepoFileInput>;
  readonly height?: number;
}

function buildNodes(
  repo: { id: string; name: string },
  files: ReadonlyArray<RepoFileInput>,
): Array<Node<(NodeServiceData | NodeRepoFileData) & Record<string, unknown>>> {
  const repoNode: Node<NodeServiceData & Record<string, unknown>> = {
    id: `repo:${repo.id}`,
    type: 'service',
    position: { x: 0, y: 0 },
    data: {
      kind: 'service',
      label: repo.name,
      serviceKind: 'service',
      status: 'healthy',
    },
  };

  // Group files by top-level folder for column layout.
  const byFolder = new Map<string, RepoFileInput[]>();
  for (const f of files) {
    const folder = f.path.split('/')[0] ?? '/';
    const arr = byFolder.get(folder) ?? [];
    arr.push(f);
    byFolder.set(folder, arr);
  }

  const fileNodes: Array<Node<NodeRepoFileData & Record<string, unknown>>> = [];
  let col = 1;
  for (const [folder, arr] of byFolder) {
    arr.forEach((f, row) => {
      fileNodes.push({
        id: `file:${f.id}`,
        type: 'repoFile',
        position: { x: col * 260, y: row * 110 },
        data: {
          kind: 'repoFile',
          label: f.path,
          path: f.path,
          language: f.language,
          ...(f.loc !== undefined ? { loc: f.loc } : {}),
        },
      });
    });
    void folder;
    col += 1;
  }

  return [repoNode, ...fileNodes];
}

function buildEdges(
  repo: { id: string; name: string },
  files: ReadonlyArray<RepoFileInput>,
): Edge[] {
  return files.map((f) => ({
    id: `edge:${repo.id}:${f.id}`,
    source: `repo:${repo.id}`,
    target: `file:${f.id}`,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: 'hsl(var(--border))' },
  }));
}

function RepositoryGraphViewInner({
  repo,
  files,
  height = 480,
}: RepositoryGraphViewProps) {
  const nodes = React.useMemo(() => buildNodes(repo, files), [repo, files]);
  const edges = React.useMemo(() => buildEdges(repo, files), [repo, files]);
  return (
    <div
      data-testid="repository-graph-view"
      data-repo={repo.name}
      data-files={files.length}
      style={{ height }}
      className="rounded-md border bg-card"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={forgeNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background color="hsl(var(--border))" gap={16} />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function RepositoryGraphView(props: RepositoryGraphViewProps) {
  return (
    <ReactFlowProvider>
      <RepositoryGraphViewInner {...props} />
    </ReactFlowProvider>
  );
}
