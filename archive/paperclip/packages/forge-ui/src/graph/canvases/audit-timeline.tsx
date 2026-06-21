/**
 * AuditTimelineGraphCanvas — Plan 2 §3.4.
 *
 * Wrapper around {@link CanvasShell} configured for the Audit Center. The
 * Audit Timeline Graph uses the LR + time x-axis layout (Plan 2 §4.1) so
 * the audit entries flow left-to-right in time order.
 *
 * Edges with `live: true` (the `followed_by` chain within the current run)
 * are animated. The provider returns them with that flag; the canvas shell
 * surfaces the animation to React Flow.
 */

import {
  ReactFlowProvider,
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { CanvasToolbar, VIRTUALIZE_THRESHOLD } from "../canvas-shell";
import { applyAuditTimelineLayout } from "../layout";
import { TypedArtifactNodeComponent } from "../typed-artifact-node";
import { TextListView } from "../text-list-view";
import type { AuditEdge, AuditNode } from "../nodes";
import type { Unsubscribe } from "../provider";
import type { AuditGraphProvider } from "../providers/audit";

const NODE_TYPES: NodeTypes = { typed: TypedArtifactNodeComponent } as const;

export interface AuditTimelineGraphCanvasProps {
  readonly provider: AuditGraphProvider;
  readonly onSelectNode?: ((id: string | null) => void) | undefined;
  readonly withoutLiveRegion?: boolean;
}

export function AuditTimelineGraphCanvas({
  provider,
  onSelectNode,
  withoutLiveRegion = false,
}: AuditTimelineGraphCanvasProps): JSX.Element {
  const [nodes, setNodes] = useState<ReadonlyArray<Node>>([]);
  const [edges, setEdges] = useState<ReadonlyArray<Edge>>([]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);

  const reload = useCallback(async () => {
    const [providerNodes, providerEdges] = await Promise.all([
      provider.getNodes({}),
      provider.getEdges({}),
    ]);
    const rfNodes: Node[] = providerNodes.map((n) => ({
      id: n.id,
      type: "typed",
      position: { x: 0, y: 0 },
      data: {
        family: n.family,
        label: n.label,
        kind: (n as unknown as { kind?: string }).kind ?? "node",
        subtitle: n.subtitle,
        bucketStart: (n as unknown as { bucketStart?: string }).bucketStart,
        artifact: n,
      },
    }));
    const rfEdges: Edge[] = providerEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.annotation,
      animated: e.kind === "followed_by" && e.live === true,
    }));
    const { nodes: laidOut } = applyAuditTimelineLayout(rfNodes, rfEdges, {});
    setNodes(laidOut);
    setEdges(rfEdges);
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    void reload();
    if (provider.watch) {
      unsubscribeRef.current = provider.watch({}, () => {
        if (!cancelled) void reload();
      });
    }
    return () => {
      cancelled = true;
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [provider, reload]);

  return (
    <section
      ref={wrapperRef}
      role="application"
      aria-label="Audit Timeline Graph"
      data-forge-canvas="audit"
      className="flex h-full w-full flex-col"
    >
      <CanvasToolbar viewMode="graph" onChangeViewMode={() => {}} count={nodes.length} />
      <a
        href="#audit-text-list"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-surface-overlay focus:px-2 focus:py-1"
      >
        Skip to node list
      </a>
      <div className="flex-1 min-h-[320px]">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes as Node[]}
            edges={edges as Edge[]}
            nodeTypes={NODE_TYPES}
            fitView
            minZoom={0.2}
            maxZoom={2}
            defaultEdgeOptions={{ focusable: true }}
            onlyRenderVisibleElements={nodes.length >= VIRTUALIZE_THRESHOLD}
            proOptions={{ hideAttribution: true }}
            aria-label="Audit Timeline Graph view"
            onNodeClick={(_e, n) => onSelectNode?.(n.id)}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <div id="audit-text-list" className="sr-only">
        <AuditTextList provider={provider} />
      </div>
      {/* Suppress unused-var warning when withoutLiveRegion is true. */}
      {withoutLiveRegion ? null : null}
    </section>
  );
}

function AuditTextList({ provider }: { provider: AuditGraphProvider }): JSX.Element {
  const [nodes, setNodes] = useState<ReadonlyArray<AuditNode>>([]);
  const [edges, setEdges] = useState<ReadonlyArray<AuditEdge>>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [n, e] = await Promise.all([provider.getNodes({}), provider.getEdges({})]);
      if (!cancelled) {
        setNodes(n);
        setEdges(e);
      }
    })();
    return () => { cancelled = true; };
  }, [provider]);
  return <TextListView nodes={nodes} edges={edges} ariaLabel="Audit Timeline Graph — text equivalent" />;
}
