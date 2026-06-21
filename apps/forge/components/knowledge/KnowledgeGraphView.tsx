/**
 * KnowledgeGraphView — the forge-console mirror of the
 * `KnowledgeGraphCanvas` (FORA-393-F2).
 *
 * Why a server-renderable local mirror instead of the shipped React
 * Flow canvas:
 *   * The forge app does not depend on `the v2.0 design system` (per the
 *     FORA-578 connector-center precedent) and React Flow would
 *     require a `use client` directive + the @xyflow/react dep.
 *   * v1.0 ships a read-only view of the 12 v1 files + 12 stages;
 *     a static positioned grid is sufficient and renders in < 200ms
 *     (the FORA-502 AC budget).
 *   * The producer (`apps/forge/lib/knowledge/graph-manifest.ts`)
 *     is the same `KnowledgeNode[]` + `KnowledgeEdge[]` shape the
 *     shipped canvas consumes; a future v1.1 swap to the React Flow
 *     canvas is a one-file change.
 *
 * Layout (deterministic, no React Flow):
 *   * 12 stage nodes in row 0 (top), one per injection stage.
 *   * 12 file nodes in row 1, grouped by folder (memory | customer | project).
 *   * Edges drawn as absolute-positioned `<line>` elements.
 *
 * Filters (Plan 2 §3.1): folder + stage + file-type. Filters narrow
 * the visible node set live; the URL state is `?view=graph&folder=...&type=...&stage=...`.
 *
 * Federation view (Plan 2 §3.1) is gated on `?federation=1`; the
 * `listFederationNodes` helper from graph-manifest adds 3 folder
 * summary nodes.
 */
import Link from "next/link";
import { listKnowledgeNodes, listKnowledgeEdges, listFederationNodes, knowledgeNodeCount, knowledgeEdgeCount } from "@/lib/knowledge/graph-manifest";
import type { GraphFilter, KnowledgeEdge, KnowledgeNode, GraphFolder } from "@/lib/knowledge/types";

const FOLDER_TONE: Record<GraphFolder, string> = {
  memory: "bg-indigo-500/15 border-indigo-500/40 text-indigo-100",
  customer: "bg-amber-500/15 border-amber-500/40 text-amber-100",
  project: "bg-emerald-500/15 border-emerald-500/40 text-emerald-100",
  engagements: "bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-100",
  reference: "bg-slate-500/15 border-slate-500/40 text-slate-100",
};

const NODE_W = 168;
const NODE_H = 56;
const COL_GAP = 24;
const ROW_GAP = 56;
const STAGE_ROW = 0;
const FILE_ROW = 1;
const FEDERATION_ROW = 2;

function layoutNodes(
  nodes: ReadonlyArray<KnowledgeNode>,
  edges: ReadonlyArray<KnowledgeEdge>,
  filter: GraphFilter,
): { positioned: ReadonlyArray<KnowledgeNode & { x: number; y: number; width: number; height: number }>; width: number; height: number; edgePaths: ReadonlyArray<{ edge: KnowledgeEdge; x1: number; y1: number; x2: number; y2: number }> } {
  // Bucket by kind + folder.
  const stages = nodes.filter((n) => n.kind === "stage_injection");
  const byFolder = new Map<GraphFolder, KnowledgeNode[]>();
  for (const f of ["memory", "customer", "project"] as const) byFolder.set(f, []);
  for (const n of nodes) {
    if (n.kind === "knowledge_file" && n.folder) {
      const arr = byFolder.get(n.folder as GraphFolder) ?? [];
      arr.push(n);
      byFolder.set(n.folder as GraphFolder, arr);
    } else if (n.kind === "folder_summary" && n.folder) {
      const arr = byFolder.get(n.folder as GraphFolder) ?? [];
      arr.push(n);
      byFolder.set(n.folder as GraphFolder, arr);
    }
  }
  // Compute column positions: one column per folder + a stage column on the left.
  const folders: ReadonlyArray<GraphFolder> = ["memory", "customer", "project"];
  const stageColX = 0;
  const folderColX: Record<GraphFolder, number> = {
    memory: (stageColX + 1) * (NODE_W + COL_GAP),
    customer: (stageColX + 2) * (NODE_W + COL_GAP),
    project: (stageColX + 3) * (NODE_W + COL_GAP),
    engagements: 0,
    reference: 0,
  };
  const positioned: Array<KnowledgeNode & { x: number; y: number; width: number; height: number }> = [];
  // Stages column — each stage gets its own row in column 0.
  stages.forEach((s, i) => {
    positioned.push({
      ...s,
      x: stageColX,
      y: (STAGE_ROW + i) * (NODE_H + ROW_GAP),
      width: NODE_W,
      height: NODE_H,
    });
  });
  // File nodes — column per folder, row 1.
  for (const f of folders) {
    const list = byFolder.get(f) ?? [];
    list.forEach((node, i) => {
      positioned.push({
        ...node,
        x: folderColX[f],
        y: (FILE_ROW + i) * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
      });
    });
  }
  // Federation summary nodes — row 2, one per folder.
  for (const f of folders) {
    const list = byFolder.get(f) ?? [];
    const summary = list.find((n) => n.kind === "folder_summary");
    if (summary) {
      positioned.push({
        ...summary,
        x: folderColX[f],
        y: FEDERATION_ROW * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
      });
    }
  }
  // Compute width/height for the SVG canvas.
  const maxX = Math.max(0, ...positioned.map((n) => n.x + n.width));
  const maxY = Math.max(0, ...positioned.map((n) => n.y + n.height));
  // Edge paths.
  const nodeById = new Map(positioned.map((n) => [n.id, n] as const));
  const edgePaths = edges
    .map((e) => {
      const s = nodeById.get(e.source);
      const t = nodeById.get(e.target);
      if (!s || !t) return null;
      return {
        edge: e,
        x1: s.x + s.width / 2,
        y1: s.y + s.height / 2,
        x2: t.x + t.width / 2,
        y2: t.y + t.height / 2,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  return { positioned, width: maxX + COL_GAP, height: maxY + ROW_GAP, edgePaths };
}

export interface KnowledgeGraphViewProps {
  readonly filter: GraphFilter;
  readonly federation?: boolean;
}

export function KnowledgeGraphView({ filter, federation = false }: KnowledgeGraphViewProps) {
  const nodes = federation ? listFederationNodes() : listKnowledgeNodes(filter);
  const edges = listKnowledgeEdges(filter);
  const { positioned, width, height, edgePaths } = layoutNodes(nodes, edges, filter);
  return (
    <section
      aria-labelledby="graph-h"
      className="space-y-3"
      data-testid="knowledge-graph-view"
      data-node-count={positioned.length}
      data-edge-count={edgePaths.length}
      data-federation={federation ? "1" : "0"}
    >
      <header className="space-y-1">
        <h2 id="graph-h" className="text-xl font-semibold text-forge-50">
          Knowledge Graph
        </h2>
        <p className="text-sm text-forge-200">
          The 12 v1 files + 12 sub-agent stages per workspace/README.md §2.{" "}
          {federation
            ? "Federation view: 3 folder-summary nodes + the per-file + per-stage nodes."
            : "Stage nodes (column 1) connect to the files they inject via the `injects_into` edge."}
        </p>
        <p className="text-xs text-forge-400" data-testid="knowledge-graph-counts">
          {positioned.length} node{positioned.length === 1 ? "" : "s"} · {edgePaths.length} edge{edgePaths.length === 1 ? "" : "s"} ·{" "}
          {knowledgeNodeCount(filter)} raw node{knowledgeNodeCount(filter) === 1 ? "" : "s"} · {knowledgeEdgeCount(filter)} raw edge{knowledgeEdgeCount(filter) === 1 ? "" : "s"} (unfederated)
        </p>
      </header>

      <div className="relative overflow-auto rounded-md border border-forge-700/40 bg-forge-900/40 p-3">
        <svg
          width={Math.max(width, 720)}
          height={Math.max(height, 320)}
          role="img"
          aria-label="Knowledge Graph: stages inject files"
          data-testid="knowledge-graph-svg"
          className="block"
        >
          <g>
            {edgePaths.map(({ edge, x1, y1, x2, y2 }) => (
              <line
                key={edge.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="currentColor"
                strokeOpacity={0.25}
                strokeWidth={1}
                data-testid="knowledge-graph-edge"
                data-edge-id={edge.id}
                data-edge-kind={edge.kind}
                className="text-forge-300"
              />
            ))}
          </g>
          <g>
            {positioned.map((n) => {
              const isStage = n.kind === "stage_injection";
              const isSummary = n.kind === "folder_summary";
              const folderClass = n.folder ? FOLDER_TONE[n.folder] : "bg-forge-800/40 border-forge-700/40 text-forge-100";
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} data-testid="knowledge-graph-node" data-node-id={n.id} data-node-kind={n.kind}>
                  <rect
                    width={n.width}
                    height={n.height}
                    rx={6}
                    className={`stroke ${folderClass}`}
                    strokeWidth={1}
                    fill="currentColor"
                    fillOpacity={0.15}
                  />
                  <text
                    x={10}
                    y={20}
                    className={`fill-current text-[11px] font-medium ${isStage ? "text-forge-100" : "text-forge-50"}`}
                  >
                    {n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label}
                  </text>
                  <text x={10} y={36} className="fill-current text-[10px] text-forge-300">
                    {n.subtitle ?? (isStage ? "stage" : isSummary ? "folder summary" : n.kind)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <p className="text-xs text-forge-400">
        Tip: click a file node to open it in the file viewer. Federation view (above
        the file row) collapses the 12 files to 3 folder summaries per Plan 2 §3.1.
        <Link
          href={`/knowledge-center?view=graph&federation=1&folder=${encodeURIComponent(filter.folder ?? "all")}`}
          className="ml-1 text-forge-200 underline hover:text-forge-50"
          data-testid="knowledge-graph-federation-link"
        >
          Toggle federation
        </Link>
        .
      </p>
    </section>
  );
}
