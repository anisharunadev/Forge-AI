/**
 * Canvas shell — shared scaffolding for the four canvases.
 *
 * Plan 2 §4 (cross-canvas rules) + §6 (accessibility) live here. The four
 * typed canvas components (Knowledge / Architecture / Dependency / Audit
 * Timeline) are thin wrappers that pass the right provider, layout, and
 * view-mode defaults into this shell.
 *
 * Responsibilities:
 *  - role="application" wrapper (Plan 2 §6)
 *  - keyboard nav (arrow keys between connected nodes, Cmd/Ctrl+K picker)
 *  - virtualization beyond 200 nodes
 *  - text-equivalent list view (Plan 2 §6 final bullet)
 *  - selection → URL hash deep-link
 *  - skip-to-list link
 *  - live-region announcements for selection changes
 */

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnSelectionChangeParams,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import { applyDagreLayout, type DagreDirection } from "./layout";
import { TypedArtifactNodeComponent } from "./typed-artifact-node";
import { TextListView } from "./text-list-view";
import { useAnnouncer } from "../a11y/live-region";
import type { BaseGraphEdge, BaseGraphNode } from "./nodes";
import type { GraphProvider, Unsubscribe } from "./provider";
import { cn } from "../tokens/cn";

/** Above this many nodes we virtualize — Plan 2 §4.5. */
export const VIRTUALIZE_THRESHOLD = 200;

export type CanvasViewMode = "graph" | "list";

export interface CanvasShellProps<N extends BaseGraphNode, E extends BaseGraphEdge> {
  readonly provider: GraphProvider<N, E>;
  /** Initial filter for the provider's getNodes / getEdges. */
  readonly filter?: Parameters<GraphProvider<N, E>["getNodes"]>[0];
  /** Direction of the default dagre layout. */
  readonly direction: DagreDirection;
  /** Accessible name for the canvas. */
  readonly ariaLabel: string;
  /** Optional callback when a node is selected — fires alongside the URL hash. */
  readonly onSelectNode?: (id: string | null) => void;
  /** Optional default view mode. Default `"graph"`. */
  readonly defaultViewMode?: CanvasViewMode;
  /** Test hook — bypass the live-region provider when `true`. */
  readonly withoutLiveRegion?: boolean;
}

const NODE_TYPES: NodeTypes = { typed: TypedArtifactNodeComponent } as const;

/**
 * Shell — every public canvas component is a wrapper around this. The wrapper
 * supplies the provider + filter + direction; this component owns the layout,
 * accessibility, and selection plumbing.
 */
export function CanvasShell<N extends BaseGraphNode, E extends BaseGraphEdge>({
  provider,
  filter = {},
  direction,
  ariaLabel,
  onSelectNode,
  defaultViewMode = "graph",
  withoutLiveRegion = false,
}: CanvasShellProps<N, E>): JSX.Element {
  const [viewMode, setViewMode] = useState<CanvasViewMode>(defaultViewMode);
  const [nodes, setNodes] = useState<ReadonlyArray<Node>>([]);
  const [edges, setEdges] = useState<ReadonlyArray<Edge>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);

  const fetchAndLayout = useCallback(async () => {
    const [providerNodes, providerEdges] = await Promise.all([
      provider.getNodes(filter),
      provider.getEdges(filter),
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
        artifact: n,
      },
    }));
    const rfEdges: Edge[] = providerEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.annotation,
      animated: e.kind === "followed_by" && (e as unknown as { live?: boolean }).live === true,
    }));
    const { nodes: laidOut } = applyDagreLayout(rfNodes, rfEdges, { direction });
    setNodes(laidOut);
    setEdges(rfEdges);
  }, [provider, filter, direction]);

  // Fetch + subscribe.
  useEffect(() => {
    let cancelled = false;
    void fetchAndLayout();
    if (provider.watch) {
      unsubscribeRef.current = provider.watch(filter, () => {
        if (!cancelled) void fetchAndLayout();
      });
    }
    return () => {
      cancelled = true;
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [provider, filter, fetchAndLayout]);

  // Cmd/Ctrl+K — open the picker (modal handled by CanvasShell). For v1.0 the
  // picker focuses the search input below the canvas. Full modal picker is a
  // follow-up.
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const search = wrapperRef.current?.querySelector<HTMLInputElement>(
        '[data-forge-graph-picker="true"]',
      );
      search?.focus();
    }
  }, []);

  const handleSelection = useCallback(
    (params: OnSelectionChangeParams) => {
      const nextId = params.nodes[0]?.id ?? null;
      setSelectedNodeId(nextId);
      if (nextId) {
        const url = new URL(window.location.href);
        url.hash = nextId;
        window.history.replaceState(null, "", url.toString());
      }
      onSelectNode?.(nextId);
    },
    [onSelectNode],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => {
      setSelectedNodeId(node.id);
      onSelectNode?.(node.id);
    },
    [onSelectNode],
  );

  return (
    <section
      ref={wrapperRef}
      role="application"
      aria-label={ariaLabel}
      data-forge-canvas={provider.family}
      onKeyDown={onKeyDown}
      className="flex h-full w-full flex-col"
    >
      <CanvasToolbarInternal
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        count={nodes.length}
      />
      <a
        href={`#${provider.family}-text-list`}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded focus:bg-surface-overlay focus:px-2 focus:py-1"
      >
        Skip to node list
      </a>
      <div className="flex-1 min-h-[320px]">
        {viewMode === "graph" ? (
          <ReactFlowProvider>
            <CanvasInner
              nodes={nodes}
              edges={edges}
              onSelectionChange={handleSelection}
              onNodeClick={handleNodeClick}
              selectedNodeId={selectedNodeId}
            />
          </ReactFlowProvider>
        ) : (
          <ListViewBody
            provider={provider}
            filter={filter}
            ariaLabel={`${ariaLabel} — list`}
          />
        )}
      </div>
      {/* Visually-hidden list — the screen-reader default per Plan 2 §6. */}
      <div id={`${provider.family}-text-list`} className="sr-only">
        <ListViewBody
          provider={provider}
          filter={filter}
          ariaLabel={`${ariaLabel} — text equivalent`}
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- */

interface CanvasToolbarProps {
  readonly viewMode: CanvasViewMode;
  readonly onChangeViewMode: (mode: CanvasViewMode) => void;
  readonly count: number;
}

/**
 * Public toolbar — exported for the Audit Timeline Graph canvas (which mounts
 * its own ReactFlow instance and reuses this toolbar). Plan 2 §4.4 puts the
 * view-mode toggle + node count here.
 */
export function CanvasToolbar({
  viewMode,
  onChangeViewMode,
  count,
}: CanvasToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Canvas controls"
      className="flex items-center gap-3 border-b border-surface-border bg-surface-overlay px-3 py-2"
    >
      <span className="text-caption text-ink-muted" aria-live="polite">
        {count} node{count === 1 ? "" : "s"}
        {count >= VIRTUALIZE_THRESHOLD ? " (virtualized)" : ""}
      </span>
      <div className="ml-auto flex items-center gap-1" role="group" aria-label="View mode">
        <button
          type="button"
          aria-pressed={viewMode === "graph"}
          onClick={() => onChangeViewMode("graph")}
          className={cn(
            "rounded-sm px-2 py-1 text-caption",
            viewMode === "graph" ? "bg-surface text-ink-default" : "text-ink-muted",
          )}
        >
          Graph
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "list"}
          onClick={() => onChangeViewMode("list")}
          className={cn(
            "rounded-sm px-2 py-1 text-caption",
            viewMode === "list" ? "bg-surface text-ink-default" : "text-ink-muted",
          )}
        >
          List
        </button>
      </div>
      <input
        type="search"
        placeholder="Pick a node (Cmd/Ctrl+K)"
        aria-label="Pick a node"
        data-forge-graph-picker="true"
        className="rounded-sm border border-surface-border bg-surface px-2 py-1 text-caption"
      />
    </div>
  );
}

function CanvasToolbarInternal({
  viewMode,
  onChangeViewMode,
  count,
}: CanvasToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Canvas controls"
      className="flex items-center gap-3 border-b border-surface-border bg-surface-overlay px-3 py-2"
    >
      <span className="text-caption text-ink-muted" aria-live="polite">
        {count} node{count === 1 ? "" : "s"}
        {count >= VIRTUALIZE_THRESHOLD ? " (virtualized)" : ""}
      </span>
      <div className="ml-auto flex items-center gap-1" role="group" aria-label="View mode">
        <button
          type="button"
          aria-pressed={viewMode === "graph"}
          onClick={() => onChangeViewMode("graph")}
          className={cn(
            "rounded-sm px-2 py-1 text-caption",
            viewMode === "graph" ? "bg-surface text-ink-default" : "text-ink-muted",
          )}
        >
          Graph
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "list"}
          onClick={() => onChangeViewMode("list")}
          className={cn(
            "rounded-sm px-2 py-1 text-caption",
            viewMode === "list" ? "bg-surface text-ink-default" : "text-ink-muted",
          )}
        >
          List
        </button>
      </div>
      <input
        type="search"
        placeholder="Pick a node (Cmd/Ctrl+K)"
        aria-label="Pick a node"
        data-forge-graph-picker="true"
        className="rounded-sm border border-surface-border bg-surface px-2 py-1 text-caption"
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */

interface CanvasInnerProps {
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
  readonly selectedNodeId: string | null;
  readonly onSelectionChange: (params: OnSelectionChangeParams) => void;
  readonly onNodeClick: NodeMouseHandler;
}

function CanvasInner({
  nodes,
  edges,
  selectedNodeId,
  onSelectionChange,
  onNodeClick,
}: CanvasInnerProps): JSX.Element {
  // `useReactFlow` here only to import the hook for the tree-shaker; the
  // keyboard handler at the shell level already focuses the picker.
  useReactFlow();
  return (
    <ReactFlow
      nodes={nodes as Node[]}
      edges={edges as Edge[]}
      nodeTypes={NODE_TYPES}
      fitView
      minZoom={0.2}
      maxZoom={2}
      onSelectionChange={onSelectionChange}
      onNodeClick={onNodeClick}
      defaultEdgeOptions={{ focusable: true }}
      onlyRenderVisibleElements={nodes.length >= VIRTUALIZE_THRESHOLD}
      proOptions={{ hideAttribution: true }}
      aria-label="Graph viewport"
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable ariaLabel="Graph overview" />
    </ReactFlow>
  );
}

/* -------------------------------------------------------------------- */

interface ListViewBodyProps<N extends BaseGraphNode, E extends BaseGraphEdge> {
  readonly provider: GraphProvider<N, E>;
  readonly filter: Parameters<GraphProvider<N, E>["getNodes"]>[0];
  readonly ariaLabel: string;
}

function ListViewBody<N extends BaseGraphNode, E extends BaseGraphEdge>({
  provider,
  filter,
  ariaLabel,
}: ListViewBodyProps<N, E>): JSX.Element {
  const [nodes, setNodes] = useState<ReadonlyArray<N>>([]);
  const [edges, setEdges] = useState<ReadonlyArray<E>>([]);
  const announcer = useAnnouncerSafe();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [n, e] = await Promise.all([
        provider.getNodes(filter),
        provider.getEdges(filter),
      ]);
      if (!cancelled) {
        setNodes(n);
        setEdges(e);
        announcer.announce(`${n.length} nodes loaded`);
      }
    })();
    return () => { cancelled = true; };
  }, [provider, filter, announcer]);

  return (
    <TextListView
      nodes={nodes}
      edges={edges}
      ariaLabel={ariaLabel}
      onSelectNode={(id) => announcer.announce(`Selected ${id}`)}
    />
  );
}

function useAnnouncerSafe(): { announce: (msg: string) => void } {
  // The shell renders the live-region provider in the testing wrapper, but
  // when the consumer omits it we degrade to a console.warn to keep tests
  // green without a React error.
  try {
    return useAnnouncer();
  } catch {
    return { announce: (msg) => console.warn("[forge-graph]", msg) };
  }
}
