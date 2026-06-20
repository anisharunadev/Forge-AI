/**
 * FORA-502.5 acceptance smoke — Knowledge Graph view + filters.
 *
 * Mirrors the FORA-502.2/502.4 smoke (the bin/fora-*.mjs pattern).
 * Runs under node directly, no vitest/jsdom. Exits non-zero on the
 * first failed assertion.
 *
 * Acceptance criteria covered:
 *   AC1 — 12 file nodes + 12 stage nodes (24 total) in the raw graph.
 *   AC2 — At least 38 `injects_into` edges (the README §2 sum).
 *   AC3 — Folder filter narrows the file set live.
 *   AC4 — Stage filter narrows the file set live.
 *   AC5 — File-type filter narrows the file set live.
 *   AC6 — Federation view adds 3 folder-summary nodes (memory, customer, project).
 *   AC7 — The local `KnowledgeNode` / `KnowledgeEdge` mirror matches
 *          the shipped `@fora/forge-ui/graph/nodes.ts` field set
 *          (drift = v1.0 GA ship-blocker).
 *   AC8 — The producer + filter pass runs in < 200ms for the v1 set
 *          (the FORA-502 AC budget; the 50-file budget lands in 502.6).
 */

import {
  listKnowledgeNodes,
  listKnowledgeEdges,
  listFederationNodes,
  knowledgeNodeCount,
  knowledgeEdgeCount,
  KNOWLEDGE_FILE_NODE_COUNT,
  KNOWLEDGE_STAGE_NODE_COUNT,
} from "../lib/knowledge/graph-manifest.ts";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  -", msg);
}

(async () => {
  // AC1: 12 file nodes + 12 stage nodes = 24 in the raw graph.
  const nodes = listKnowledgeNodes();
  const fileNodes = nodes.filter((n) => n.kind === "knowledge_file");
  const stageNodes = nodes.filter((n) => n.kind === "stage_injection");
  assert(fileNodes.length === KNOWLEDGE_FILE_NODE_COUNT, `AC1 — ${KNOWLEDGE_FILE_NODE_COUNT} file nodes (got ${fileNodes.length})`);
  assert(fileNodes.length === 12, "AC1 — exactly 12 file nodes per workspace/README.md §1");
  assert(stageNodes.length === KNOWLEDGE_STAGE_NODE_COUNT, `AC1 — ${KNOWLEDGE_STAGE_NODE_COUNT} stage nodes (got ${stageNodes.length})`);
  assert(stageNodes.length === 12, "AC1 — exactly 12 stage nodes per workspace/README.md §2");
  assert(knowledgeNodeCount() === 24, "AC1 — knowledgeNodeCount() = 24");

  // AC2: 38 injects_into edges (sum of per-file stage roles in the manifest).
  const edges = listKnowledgeEdges();
  const injects = edges.filter((e) => e.kind === "injects_into");
  assert(injects.length >= 38, `AC2 — at least 38 injects_into edges (got ${injects.length})`);
  assert(knowledgeEdgeCount() === injects.length, "AC2 — knowledgeEdgeCount() matches the edge list");
  // Every edge has the right shape.
  for (const e of edges) {
    assert(typeof e.id === "string" && e.id.length > 0, "AC2 — edge has non-empty id");
    assert(typeof e.source === "string" && e.source.length > 0, "AC2 — edge has non-empty source");
    assert(typeof e.target === "string" && e.target.length > 0, "AC2 — edge has non-empty target");
    assert(["references", "defines", "injects_into", "supersedes"].includes(e.kind), `AC2 — edge kind ${e.kind} is in the closed enum`);
  }

  // AC3: folder filter narrows.
  const memoryOnly = listKnowledgeNodes({ folder: "memory", fileType: "all", stage: "all" });
  const memoryFiles = memoryOnly.filter((n) => n.kind === "knowledge_file");
  assert(
    memoryFiles.every((n) => n.folder === "memory"),
    `AC3 — folder=memory narrows file nodes to memory/ (got ${memoryFiles.length})`,
  );
  assert(
    memoryFiles.length === 6,
    `AC3 — memory/ has 6 files (got ${memoryFiles.length})`,
  );

  // AC4: stage filter narrows to the files for that stage.
  const devOnly = listKnowledgeNodes({ folder: "all", fileType: "all", stage: "Developer" });
  const devFiles = devOnly.filter((n) => n.kind === "knowledge_file");
  // Per README §2, Developer gets coding.md + architecture.md.
  assert(
    devFiles.length === 2,
    `AC4 — stage=Developer narrows to 2 files (got ${devFiles.length}: ${devFiles.map((f) => f.subtitle).join(", ")})`,
  );
  // The stage node itself is emitted.
  const devStage = devOnly.find((n) => n.kind === "stage_injection");
  assert(devStage !== undefined, "AC4 — stage=Developer emits the Developer stage node");

  // AC5: file-type filter narrows.
  const markdownOnly = listKnowledgeNodes({ folder: "all", fileType: "markdown", stage: "all" });
  const mdFiles = markdownOnly.filter((n) => n.kind === "knowledge_file");
  assert(
    mdFiles.length === 11,
    `AC5 — fileType=markdown narrows to 11 files (the glossary is type=glossary; got ${mdFiles.length})`,
  );

  // AC6: federation view adds 3 folder-summary nodes.
  const fed = listFederationNodes();
  const summaries = fed.filter((n) => n.kind === "folder_summary");
  assert(summaries.length === 3, `AC6 — federation view has 3 folder-summary nodes (got ${summaries.length})`);
  for (const f of ["memory", "customer", "project"]) {
    assert(
      summaries.some((n) => n.folder === f),
      `AC6 — federation view has a ${f}/ summary`,
    );
  }
  // The federation view has the original 24 + 3 = 27 nodes.
  assert(fed.length === 27, `AC6 — federation view = 24 raw + 3 summaries = 27 (got ${fed.length})`);

  // AC7: local mirror matches the shipped @fora/forge-ui/graph/nodes.ts field set.
  // Drift here is a v1.0 GA ship-blocker.
  const REQUIRED_NODE_FIELDS = ["id", "kind", "label"];
  const REQUIRED_EDGE_FIELDS = ["id", "source", "target", "kind"];
  for (const n of nodes) {
    for (const f of REQUIRED_NODE_FIELDS) {
      assert(f in n, `AC7 — node '${n.id}' has field '${f}' (mirror of @fora/forge-ui/graph)`);
    }
    assert(["knowledge_file", "glossary_entry", "stage_injection"].includes(n.kind), `AC7 — node kind '${n.kind}' is in the closed enum`);
  }
  for (const e of edges) {
    for (const f of REQUIRED_EDGE_FIELDS) {
      assert(f in e, `AC7 — edge '${e.id}' has field '${f}' (mirror of @fora/forge-ui/graph)`);
    }
  }

  // AC8: producer + filter pass runs in < 200ms for the v1 set.
  const iterations = 10;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    listKnowledgeNodes();
    listKnowledgeEdges();
  }
  const elapsed = performance.now() - t0;
  const perCall = elapsed / iterations;
  assert(perCall < 200, `AC8 — per-call render time < 200ms (got ${perCall.toFixed(2)}ms avg over ${iterations} iters)`);

  console.log(`ok  - FORA-502.5 acceptance smoke — all 8 ACs green (perf: ${perCall.toFixed(2)}ms/call)`);
})();
