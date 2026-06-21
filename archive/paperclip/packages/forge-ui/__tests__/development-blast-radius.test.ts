/**
 * Unit tests for the pure blast-radius computation — Plan 2 §3.3.
 *
 * No DOM, no provider. Verifies the algorithm respects:
 *   - only `imports` edges (not `imports_external`, `owns`, `tested_by`)
 *   - cycle safety (visited set)
 *   - empty / single / multi-source cases
 *   - pure determinism (same input → same output)
 */

import { describe, expect, it } from "vitest";
import {
  collectImportGraph,
  computeBlastRadius,
} from "../src/development/blast-radius";
import type { DependencyEdge, DependencyNode } from "../src/graph/nodes";

function moduleNode(id: string): DependencyNode {
  return { id, family: "dependency", kind: "module", label: id, modulePath: id };
}
function importEdge(from: string, to: string): DependencyEdge {
  return { id: `${from}->${to}`, source: from, target: to, kind: "imports" };
}

describe("computeBlastRadius", () => {
  it("returns empty result for empty sources", () => {
    const r = computeBlastRadius([], [], []);
    expect(r.sources).toEqual([]);
    expect(r.reachable).toEqual([]);
    expect(r.traversedEdges).toEqual([]);
  });

  it("ignores non-`imports` edges", () => {
    const nodes = [moduleNode("a"), moduleNode("b")];
    const edges: DependencyEdge[] = [
      { id: "owns", source: "alice", target: "a", kind: "owns" },
      { id: "tests", source: "t1", target: "a", kind: "tested_by" },
      { id: "ext", source: "a", target: "lodash", kind: "imports_external" },
    ];
    const r = computeBlastRadius(["a"], nodes, edges);
    expect(r.reachable).toEqual([]);
    expect(r.traversedEdges).toEqual([]);
  });

  it("traverses transitive imports", () => {
    const nodes = [moduleNode("a"), moduleNode("b"), moduleNode("c")];
    const edges = [importEdge("a", "b"), importEdge("b", "c")];
    const r = computeBlastRadius(["a"], nodes, edges);
    expect(r.sources).toEqual(["a"]);
    expect([...r.reachable].sort()).toEqual(["b", "c"]);
    expect(r.traversedEdges).toHaveLength(2);
  });

  it("is cycle-safe", () => {
    const nodes = [moduleNode("a"), moduleNode("b"), moduleNode("c")];
    const edges = [importEdge("a", "b"), importEdge("b", "c"), importEdge("c", "a")];
    const r = computeBlastRadius(["a"], nodes, edges);
    expect(r.sources).toEqual(["a"]);
    expect([...r.reachable].sort()).toEqual(["b", "c"]);
    // 3 traversal attempts, but visited prevents infinite recursion.
    expect(r.traversedEdges).toHaveLength(3);
  });

  it("dedupes multi-source overlap", () => {
    const nodes = [moduleNode("a"), moduleNode("b"), moduleNode("c")];
    const edges = [importEdge("a", "c"), importEdge("b", "c")];
    const r = computeBlastRadius(["a", "b"], nodes, edges);
    expect([...r.sources].sort()).toEqual(["a", "b"]);
    expect(r.reachable).toEqual(["c"]);
  });

  it("is pure / deterministic", () => {
    const nodes = [moduleNode("a"), moduleNode("b")];
    const edges = [importEdge("a", "b")];
    const r1 = computeBlastRadius(["a"], nodes, edges);
    const r2 = computeBlastRadius(["a"], nodes, edges);
    expect(r1).toEqual(r2);
  });
});

describe("collectImportGraph", () => {
  it("returns only `imports` edges between modules", () => {
    const nodes: DependencyNode[] = [
      moduleNode("a"),
      moduleNode("b"),
      { id: "lodash", family: "dependency", kind: "package", label: "lodash" },
    ];
    const edges: DependencyEdge[] = [
      importEdge("a", "b"),
      { id: "ext", source: "a", target: "lodash", kind: "imports_external" },
      { id: "owns", source: "alice", target: "a", kind: "owns" },
    ];
    const { edges: filtered } = collectImportGraph(nodes, edges);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("a->b");
  });
});
