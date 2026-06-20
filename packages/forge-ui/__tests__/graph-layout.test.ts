/**
 * FORA-393-F2 / FORA-508 — layout adapter tests.
 *
 * Dagre layout is pure and deterministic. We assert:
 *  - LR vs TB produce different x/y dominance
 *  - identityLayout is a no-op
 *  - audit timeline layout maps timestamps to a linear x axis
 */

import { describe, it, expect } from "vitest";
import {
  applyDagreLayout,
  applyAuditTimelineLayout,
  identityLayout,
  classifyEdgeKind,
  FAMILY_TOKENS,
} from "../src/graph";
import type { Edge, Node } from "@xyflow/react";

const NODES: Node[] = [
  { id: "a", type: "typed", position: { x: 0, y: 0 }, data: {} },
  { id: "b", type: "typed", position: { x: 0, y: 0 }, data: {} },
  { id: "c", type: "typed", position: { x: 0, y: 0 }, data: {} },
];
const EDGES: Edge[] = [
  { id: "ab", source: "a", target: "b" },
  { id: "bc", source: "b", target: "c" },
];

describe("applyDagreLayout", () => {
  it("sets a non-zero position on every node", () => {
    const { nodes } = applyDagreLayout(NODES, EDGES, { direction: "LR" });
    for (const n of nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it("LR and TB produce different x/y dominance", () => {
    const lr = applyDagreLayout(NODES, EDGES, { direction: "LR" });
    const tb = applyDagreLayout(NODES, EDGES, { direction: "TB" });
    const lrSpanX = Math.max(...lr.nodes.map((n) => n.position.x)) - Math.min(...lr.nodes.map((n) => n.position.x));
    const lrSpanY = Math.max(...lr.nodes.map((n) => n.position.y)) - Math.min(...lr.nodes.map((n) => n.position.y));
    const tbSpanX = Math.max(...tb.nodes.map((n) => n.position.x)) - Math.min(...tb.nodes.map((n) => n.position.x));
    const tbSpanY = Math.max(...tb.nodes.map((n) => n.position.y)) - Math.min(...tb.nodes.map((n) => n.position.y));
    expect(lrSpanX).toBeGreaterThan(lrSpanY);
    expect(tbSpanY).toBeGreaterThan(tbSpanX);
  });
});

describe("identityLayout", () => {
  it("is a no-op", () => {
    const out = identityLayout(NODES);
    expect(out.nodes).toBe(NODES);
  });
});

describe("applyAuditTimelineLayout", () => {
  const baseTs = "2026-06-20T00:00:00Z";
  const nodes: Node[] = [
    { id: "a", type: "typed", position: { x: 0, y: 0 }, data: { bucketStart: baseTs } },
    { id: "b", type: "typed", position: { x: 0, y: 0 }, data: { bucketStart: "2026-06-20T01:00:00Z" } },
    { id: "c", type: "typed", position: { x: 0, y: 0 }, data: { bucketStart: "2026-06-20T02:00:00Z" } },
  ];
  it("places later timestamps at higher x", () => {
    const { nodes: out } = applyAuditTimelineLayout(nodes, [], {});
    const sorted = [...out].sort((a, b) => a.position.x - b.position.x);
    expect(sorted.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});

describe("classifyEdgeKind", () => {
  it("classifies present-tense edges as solid", () => {
    expect(classifyEdgeKind("depends_on")).toBe("solid");
    expect(classifyEdgeKind("injects_into")).toBe("solid");
    expect(classifyEdgeKind("imports")).toBe("solid");
  });
  it("classifies historical edges as dashed", () => {
    expect(classifyEdgeKind("supersedes")).toBe("dashed");
    expect(classifyEdgeKind("followed_by")).toBe("dashed");
  });
  it("classifies live followed_by as animated", () => {
    expect(classifyEdgeKind("followed_by", true)).toBe("animated");
  });
});

describe("FAMILY_TOKENS", () => {
  it("has all four families", () => {
    expect(Object.keys(FAMILY_TOKENS).sort()).toEqual(
      ["architecture", "audit", "dependency", "knowledge"],
    );
  });
});
