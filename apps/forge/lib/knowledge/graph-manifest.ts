/**
 * Knowledge Graph manifest producer (FORA-502.5).
 *
 * Reads the 12 v1 files + the 12-stage injection model and emits a
 * typed `KnowledgeNode[]` + `KnowledgeEdge[]` per the local mirror in
 * `apps/forge/lib/knowledge/types.ts` (which mirrors the shipped
 * `the v2.0 knowledge graph types` types from FORA-393-F2).
 *
 * The producer is the consumer-side seam for the Knowledge Graph
 * canvas (Plan 2 §3.1). v1.0 emits a static 12-file + 12-stage
 * graph; the per-engagement extension case (12 + N files) lands in
 * v1.1 when the manifest producer (FORA-389) ships the live
 * cross-ref index.
 *
 * Edge kinds (per Plan 2 §3.1):
 *   * `injects_into` — file → stage (one edge per injection role row)
 *   * `references`   — file → file (denormalised from the README §10
 *                        "Related" sections; v1.0 emits zero — the
 *                        README §2 cross-refs ship in v1.1)
 *   * `defines`      — glossary → file (v1.0 emits zero — glossary
 *                        entries ship in v1.1 per the glossary PR
 *                        affordance)
 *   * `supersedes`   — file → file (v1.0 emits zero — ADR-style
 *                        supersession is a v1.1 conversation)
 *
 * Folder summary nodes (Plan 2 §3.1 "federation view") are emitted
 * on demand by the view layer, not here — the producer emits the
 * raw graph; the view computes the federation rollup.
 */

import { listKnowledgeFiles } from "./manifest.ts";
import { listStageInjectionMaps } from "./injection-model.ts";
import type {
  GraphFilter,
  KnowledgeEdge,
  KnowledgeNode,
  KnowledgeFile,
  GraphFolder,
} from "./types.ts";

const FOLDERS: ReadonlyArray<GraphFolder> = ["memory", "customer", "project"];

function filterPassesFile(f: KnowledgeFile, filter: GraphFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.folder && filter.folder !== "all" && f.folder !== filter.folder) return false;
  if (filter.fileType && filter.fileType !== "all" && f.fileType !== filter.fileType) return false;
  if (filter.stage && filter.stage !== "all") {
    const role = f.injectionRoles.find((r) => r.stage === filter.stage);
    if (!role) return false;
  }
  return true;
}

function fileToNode(f: KnowledgeFile): KnowledgeNode {
  return {
    id: f.id,
    kind: "knowledge_file",
    label: f.title,
    subtitle: f.path,
    folder: f.folder,
    fileId: f.id,
    usageCount: f.injectionRoles.length,
  };
}

function stageToNode(stage: string, idx: number): KnowledgeNode {
  return {
    id: `stage-${idx + 1}-${stage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    kind: "stage_injection",
    label: stage,
    stage,
  };
}

/** The raw 12-file + 12-stage node set, no filter. */
export function listKnowledgeNodes(filter?: GraphFilter): ReadonlyArray<KnowledgeNode> {
  const allFiles = listKnowledgeFiles();
  const files = allFiles.filter((f) => filterPassesFile(f, filter));
  const fileNodes = files.map(fileToNode);
  let stages: ReadonlyArray<KnowledgeNode> = [];
  if (!filter?.stage || filter.stage === "all") {
    stages = listStageInjectionMaps().map((m, idx) => stageToNode(m.stage, idx));
  } else {
    // Single-stage view: only emit the requested stage + the visible files.
    const idx = listStageInjectionMaps().findIndex((m) => m.stage === filter.stage);
    if (idx >= 0) {
      const m = listStageInjectionMaps()[idx]!;
      stages = [stageToNode(m.stage, idx)];
    }
  }
  return [...stages, ...fileNodes];
}

/** The 12-stage + 12-file + 3-folder-summary node set used by the federation view. */
export function listFederationNodes(): ReadonlyArray<KnowledgeNode> {
  const all = listKnowledgeNodes();
  const folders = new Set<GraphFolder>();
  for (const n of all) {
    if (n.kind === "knowledge_file" && n.folder && FOLDERS.includes(n.folder)) {
      folders.add(n.folder);
    }
  }
  const folderNodes: KnowledgeNode[] = [];
  for (const f of folders) {
    const count = all.filter((n) => n.kind === "knowledge_file" && n.folder === f).length;
    folderNodes.push({
      id: `folder-summary-${f}`,
      kind: "folder_summary",
      label: `${f}/`,
      subtitle: `${count} file${count === 1 ? "" : "s"}`,
      folder: f,
    });
  }
  return [...all, ...folderNodes];
}

/** Edges: one `injects_into` per (file, stage) injection-role row, filtered. */
export function listKnowledgeEdges(filter?: GraphFilter): ReadonlyArray<KnowledgeEdge> {
  const files = listKnowledgeFiles().filter((f) => filterPassesFile(f, filter));
  const stages = listStageInjectionMaps();
  const stagesByName = new Map(stages.map((s, idx) => [s.stage, `stage-${idx + 1}-${s.stage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`]));
  const edges: KnowledgeEdge[] = [];
  for (const f of files) {
    for (const r of f.injectionRoles) {
      const stageNodeId = stagesByName.get(r.stage);
      if (!stageNodeId) continue;
      if (filter?.stage && filter.stage !== "all" && filter.stage !== r.stage) continue;
      edges.push({
        id: `edge-${f.id}-${stageNodeId}`,
        source: f.id,
        target: stageNodeId,
        kind: "injects_into",
        annotation: `${f.path} → ${r.stage} (${r.role})`,
      });
    }
  }
  return edges;
}

/** Total node count (12 files + 12 stages = 24 for v1.0). */
export function knowledgeNodeCount(filter?: GraphFilter): number {
  return listKnowledgeNodes(filter).length;
}

/** Total edge count. */
export function knowledgeEdgeCount(filter?: GraphFilter): number {
  return listKnowledgeEdges(filter).length;
}

/** Smoke seam. */
export const KNOWLEDGE_FILE_NODE_COUNT = 12;
export const KNOWLEDGE_STAGE_NODE_COUNT = 12;
export const KNOWLEDGE_INJECTS_INTO_EDGES_PER_FILE: number = (() => {
  // Used to assert the edge count from the manifest.
  // The sum is 38 (per workspace/README.md §2 + the always-injected
  // glossary handled separately by the view layer).
  return 38;
})();
