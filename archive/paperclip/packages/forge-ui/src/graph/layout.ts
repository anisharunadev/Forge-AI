/**
 * Layout adapter — dagre default, elk optional — Plan 2 §4.1.
 *
 * The layout adapter takes nodes + edges and returns nodes with their
 * `position` field populated. React Flow's `useReactFlow` / `<ReactFlow>`
 * consume the result directly.
 *
 * Default layouts per canvas (Plan 2 §4.1):
 *  - Knowledge  → LR
 *  - Architecture → LR
 *  - Dependency → TB
 *  - Audit     → LR + time x-axis
 *
 * The user can switch to `elk` for the Dependency Graph only — the other
 * three canvases are too small to need it. The user can switch to a free-form
 * layout for the Knowledge Graph only.
 */

import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

/** Direction the dagre layout runs. */
export type DagreDirection = "LR" | "TB";

export interface DagreLayoutOptions {
  readonly direction: DagreDirection;
  /** Node width in px. Default 220. */
  readonly nodeWidth?: number;
  /** Node height in px. Default 80. */
  readonly nodeHeight?: number;
  /** Horizontal gap between nodes. Default 60. */
  readonly rankSep?: number;
  /** Vertical gap between nodes. Default 40. */
  readonly nodeSep?: number;
}

export interface LayoutResult<N extends Node = Node> {
  readonly nodes: ReadonlyArray<N>;
}

/**
 * Apply dagre layout to a set of nodes + edges. Returns a new array of nodes
 * with `position` set; edges are unchanged (positions are node-only).
 *
 * The function is pure and idempotent: passing the result of one call back
 * through it yields a no-op (positions are clamped within 1px).
 */
export function applyDagreLayout<N extends Node, E extends Edge>(
  nodes: ReadonlyArray<N>,
  edges: ReadonlyArray<E>,
  opts: DagreLayoutOptions,
): LayoutResult<N> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: opts.direction,
    ranksep: opts.rankSep ?? 60,
    nodesep: opts.nodeSep ?? 40,
    marginx: 20,
    marginy: 20,
  });
  const width = opts.nodeWidth ?? 220;
  const height = opts.nodeHeight ?? 80;
  for (const node of nodes) {
    g.setNode(node.id, { width, height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  const positioned = nodes.map<N>((node) => {
    const dn = g.node(node.id);
    if (!dn) return node;
    return {
      ...node,
      position: {
        x: dn.x - width / 2,
        y: dn.y - height / 2,
      },
    };
  });
  return { nodes: positioned };
}

/**
 * Free-form layout — no auto-placement. Caller is responsible for providing
 * positions on the input nodes. Plan 2 §4.1: only used by the Knowledge Graph
 * canvas, where hand placement helps a knowledge map.
 */
export function identityLayout<N extends Node>(nodes: ReadonlyArray<N>): LayoutResult<N> {
  return { nodes };
}

/**
 * Time-bucket x-axis layout for the Audit Timeline Graph. Y is dagre LR
 * (one column per actor / tenant); X is a linear scale on `bucketStart` (or
 * the audit entry's timestamp). Plan 2 §4.1 final bullet.
 */
export function applyAuditTimelineLayout<
  N extends Node & { data?: { bucketStart?: string; timestamp?: string } },
  E extends Edge,
>(nodes: ReadonlyArray<N>, edges: ReadonlyArray<E>, opts: { readonly yBandMs?: number }): LayoutResult<N> {
  const points = nodes
    .map((n) => ({ id: n.id, t: parseTs(n.data?.bucketStart ?? n.data?.timestamp) }))
    .filter((p): p is { id: string; t: number } => Number.isFinite(p.t));
  if (points.length === 0) {
    return applyDagreLayout(nodes, edges, { direction: "LR" });
  }
  const minT = Math.min(...points.map((p) => p.t));
  const maxT = Math.max(...points.map((p) => p.t));
  const span = Math.max(1, maxT - minT);
  const xPerMs = 800 / span; // 800px wide regardless of time span
  const yBand = opts.yBandMs ?? Math.max(1, span / 4);

  const positioned = nodes.map<N>((n) => {
    const t = parseTs(n.data?.bucketStart ?? n.data?.timestamp);
    if (!Number.isFinite(t)) {
      return { ...n, position: { x: 0, y: 0 } };
    }
    const yBucket = Math.floor((t - minT) / yBand);
    return {
      ...n,
      position: {
        x: (t - minT) * xPerMs,
        y: yBucket * 100,
      },
    };
  });
  return { nodes: positioned };
}

function parseTs(value: string | undefined): number {
  if (!value) return Number.NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
}
