/**
 * computeBlastRadius — pure DFS over a module import graph.
 *
 * Plan 2 §3.3: "Blast radius mode: select a module, show all reachable
 * modules (transitive `imports`)."
 *
 * Pure function. No IO, no provider coupling. Edges are typed
 * `imports | imports_external | owns | tested_by`; only `imports` is
 * traversed (external packages are *targets*, not transitively reached —
 * they are leaves in the import graph). Owners and test edges are
 * metadata and ignored.
 *
 * Cycle-safe: the visited set prevents infinite recursion on the
 * dependency cycles the analyzer surfaces in `cycle-explainer`.
 */

import type { BlastRadiusResult } from "./development";
import type { DependencyEdge, DependencyNode } from "../graph/nodes";

const TRAVERSED_KIND: DependencyEdge["kind"] = "imports";

export function computeBlastRadius(
  sources: ReadonlyArray<string>,
  nodes: ReadonlyArray<DependencyNode>,
  edges: ReadonlyArray<DependencyEdge>,
): BlastRadiusResult {
  const sourceSet = new Set(sources);
  if (sourceSet.size === 0) {
    return { sources: [], reachable: [], traversedEdges: [] };
  }

  // Adjacency: source -> [target] for `imports` edges.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== TRAVERSED_KIND) continue;
    const list = adj.get(e.source);
    if (list) {
      list.push(e.target);
    } else {
      adj.set(e.source, [e.target]);
    }
  }

  const visited = new Set<string>(sources);
  const reached: string[] = [];
  const traversed: { from: string; to: string }[] = [];
  const stack: string[] = [...sources];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    const nexts = adj.get(cur) ?? [];
    for (const next of nexts) {
      traversed.push({ from: cur, to: next });
      if (visited.has(next)) continue;
      visited.add(next);
      reached.push(next);
      stack.push(next);
    }
  }

  return {
    sources: [...sourceSet],
    reachable: reached,
    traversedEdges: traversed,
  };
}

/** Pick the import graph from a (modules, packages, owners, edges) set. */
export function collectImportGraph(
  nodes: ReadonlyArray<DependencyNode>,
  edges: ReadonlyArray<DependencyEdge>,
): { modules: ReadonlyArray<DependencyNode>; edges: ReadonlyArray<DependencyEdge> } {
  const moduleIds = new Set(
    nodes.filter((n) => n.kind === "module").map((n) => n.id),
  );
  const importEdges = edges.filter(
    (e) => e.kind === "imports" && moduleIds.has(e.source) && moduleIds.has(e.target),
  );
  return { modules: nodes, edges: importEdges };
}
