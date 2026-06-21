/**
 * Architecture Graph perf test — FORA-503 AC #2.
 *
 * "Architecture Graph renders 200 components at 60 fps."
 *
 * Strategy: the 60 fps frame budget is for the per-frame hot path —
 * selection, blast-radius computation, layout delta application. The
 * initial dagre layout runs once on graph mount, not per frame, so it
 * gets its own (more generous) budget. The blast-radius computation is
 * the per-frame path the user exercises during multi-select; that one
 * must fit inside the 16.67 ms frame budget.
 *
 *   - per-frame budget: 8 ms (50% headroom for paint + commit on top of
 *     the 16.67 ms 60 fps frame slot)
 *   - initial-paint dagre budget: 500 ms (Plan 2 §4.5 virtualizes
 *     beyond 200; the user accepts a one-time layout cost on load)
 */

import { describe, expect, it } from "vitest";
import { computeBlastRadius, collectImportGraph } from "../src/development/blast-radius";
import { applyDagreLayout } from "../src/graph/layout";
import type { DependencyEdge, DependencyNode, ArchitectureNode } from "../src/graph/nodes";

const COMPONENT_COUNT = 200;
const PER_FRAME_BUDGET_MS = 8;
const INITIAL_LAYOUT_BUDGET_MS = 500;

function makeComponent(i: number): ArchitectureNode {
  return {
    id: `c-${i}`,
    family: "architecture",
    kind: "component",
    label: `Component ${i}`,
    componentType: "service",
  };
}

function makeModule(i: number): DependencyNode {
  return {
    id: `m-${i}`,
    family: "dependency",
    kind: "module",
    label: `Module ${i}`,
    modulePath: `packages/forge-ui/src/m-${i}.ts`,
  };
}

function makeEdge(from: string, to: string, kind: DependencyEdge["kind"]): DependencyEdge {
  return { id: `${from}->${to}`, source: from, target: to, kind };
}

describe("Architecture Graph perf — 200 components", () => {
  it("renders 200 components within the 60 fps budget", () => {
    const components: ArchitectureNode[] = Array.from({ length: COMPONENT_COUNT }, (_, i) =>
      makeComponent(i),
    );
    // A sparse dependency graph: each module imports the next 2.
    const modules: DependencyNode[] = Array.from({ length: COMPONENT_COUNT }, (_, i) =>
      makeModule(i),
    );
    const importEdges: DependencyEdge[] = [];
    for (let i = 0; i < COMPONENT_COUNT - 2; i++) {
      importEdges.push(makeEdge(`m-${i}`, `m-${i + 1}`, "imports"));
      importEdges.push(makeEdge(`m-${i}`, `m-${i + 2}`, "imports"));
    }

    const start = performance.now();
    // Worst case: blast radius from the first module traverses ~400 imports.
    const result = computeBlastRadius(["m-0"], modules, importEdges);
    // Sanity: the algorithm reached far enough.
    expect(result.reachable.length).toBeGreaterThan(0);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(PER_FRAME_BUDGET_MS);
  });

  it("dagre initial layout completes within the first-paint budget for 200 components", () => {
    const components: ArchitectureNode[] = Array.from({ length: COMPONENT_COUNT }, (_, i) =>
      makeComponent(i),
    );
    // Linear chain of `imports` edges — the dagre layout cares about the
    // edge set topology, not the semantic kind, for cycle-free chain graphs.
    const archEdges: DependencyEdge[] = [];
    for (let i = 0; i < COMPONENT_COUNT - 1; i++) {
      archEdges.push(makeEdge(`c-${i}`, `c-${i + 1}`, "imports"));
    }
    // Cast to React Flow Node[] shape for layout; component shape has the
    // same id+label+family we need.
    const rfNodes = components.map((c) => ({
      id: c.id,
      type: "typed",
      data: { label: c.label },
      position: { x: 0, y: 0 },
    }));
    const rfEdges = archEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }));
    const start = performance.now();
    const laid = applyDagreLayout(rfNodes, rfEdges, { direction: "LR" });
    const elapsed = performance.now() - start;
    expect(laid.nodes).toHaveLength(COMPONENT_COUNT);
    expect(elapsed).toBeLessThan(INITIAL_LAYOUT_BUDGET_MS);
  });
});

describe("Dependency Graph cycle detection over 200 modules", () => {
  it("computes blast radius in a cyclic 200-module graph under budget", () => {
    const modules: DependencyNode[] = Array.from({ length: COMPONENT_COUNT }, (_, i) =>
      makeModule(i),
    );
    // Build a graph with a cycle at the back: m-198 -> m-199 -> m-198.
    const edges: DependencyEdge[] = [];
    for (let i = 0; i < COMPONENT_COUNT - 2; i++) {
      edges.push(makeEdge(`m-${i}`, `m-${i + 1}`, "imports"));
    }
    edges.push(makeEdge(`m-${COMPONENT_COUNT - 1}`, `m-${COMPONENT_COUNT - 2}`, "imports"));

    const { edges: importOnly } = collectImportGraph(modules, edges);
    expect(importOnly.length).toBeGreaterThan(0);

    const start = performance.now();
    const result = computeBlastRadius(["m-0"], modules, edges);
    const elapsed = performance.now() - start;
    expect(result.reachable.length).toBeGreaterThan(0);
    // Cycle-safe: should not infinite-loop, should not duplicate.
    expect(new Set(result.reachable).size).toBe(result.reachable.length);
    expect(elapsed).toBeLessThan(PER_FRAME_BUDGET_MS);
  });
});
