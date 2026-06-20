/**
 * FORA-502.2 acceptance smoke — Knowledge Center read-only browser.
 *
 * Mirrors the FORA-578 connector-center-list smoke (the bin/fora-*.mjs
 * pattern). Runs under node directly, no vitest/jsdom needed. Exits
 * non-zero on the first failed assertion.
 *
 * Acceptance criteria covered:
 *   AC1 — All 12 v1 files are produced by the manifest.
 *   AC2 — Folder counts match README §1 (memory: 6, customer: 3, project: 3).
 *   AC3 — `getKnowledgeFile` resolves a known path and returns null on miss.
 *   AC4 — `listKnowledgeFilesByFolder` and `listKnowledgeFilesByType` filter
 *          correctly; the filter is a pure projection.
 *   AC5 — Every v1 file has a non-zero byteSize, a 12-char versionHash,
 *          a non-empty injectionRoles entry (or the glossary file),
 *          and a content body that is a non-empty string.
 *   AC6 — RBAC: every persona can browse; PM is the only first-time visitor.
 *   AC7 — File viewer data: the local `KnowledgeFile` mirror in
 *          `apps/forge/lib/knowledge/types.ts` matches the field shape
 *          shipped in `@fora/forge-ui/typed-artifacts` (FORA-502.1).
 *          Drift here is a v1.0 GA ship-blocker.
 */

import { listKnowledgeFiles, getKnowledgeFile, listKnowledgeFilesByFolder, listKnowledgeFilesByType, V1_FILE_COUNT, KNOWLEDGE_FOLDERS, KNOWLEDGE_FILE_TYPES, workspaceRoot } from "../lib/knowledge/manifest.ts";
import { canAccessKnowledgeCenter, isFirstTimeVisitor, knowledgeCenterPersonaLabel } from "../lib/knowledge/rbac.ts";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  -", msg);
}

(async () => {
  // AC1: 12 v1 files.
  const files = listKnowledgeFiles();
  assert(files.length === V1_FILE_COUNT, `AC1 — manifest emits ${V1_FILE_COUNT} v1 files (got ${files.length})`);
  assert(files.length === 12, "AC1 — exactly 12 v1 files per workspace/README.md §1");

  // AC2: per-folder counts.
  const expectedCounts = { memory: 6, customer: 3, project: 3 };
  for (const [folder, expected] of Object.entries(expectedCounts)) {
    const got = listKnowledgeFilesByFolder(folder).length;
    assert(got === expected, `AC2 — ${folder}/ has ${expected} files (got ${got})`);
  }
  // And no unexpected folders in the v1 set.
  const allFolders = new Set(files.map((f) => f.folder));
  for (const f of allFolders) {
    assert(KNOWLEDGE_FOLDERS.includes(f), `AC2 — only v1 folders emitted (${f} is in the pinned set)`);
  }

  // AC3: getKnowledgeFile + miss.
  const coding = getKnowledgeFile("memory/coding.md");
  assert(coding !== null, "AC3 — getKnowledgeFile resolves memory/coding.md");
  assert(coding?.path === "memory/coding.md", "AC3 — path round-trips");
  const miss = getKnowledgeFile("memory/does-not-exist.md");
  assert(miss === null, "AC3 — getKnowledgeFile returns null on miss");

  // AC4: filter projections.
  const memoryFiles = listKnowledgeFilesByFolder("memory");
  assert(memoryFiles.every((f) => f.folder === "memory"), "AC4 — listKnowledgeFilesByFolder projects correctly");
  const markdownFiles = listKnowledgeFilesByType("markdown");
  assert(markdownFiles.every((f) => f.fileType === "markdown"), "AC4 — listKnowledgeFilesByType projects correctly");
  const glossaryFiles = listKnowledgeFilesByType("glossary");
  assert(glossaryFiles.length === 1 && glossaryFiles[0].path === "customer/glossary.md", "AC4 — exactly one glossary file (customer/glossary.md)");

  // AC5: every file has body + hash + size + roles.
  for (const f of files) {
    assert(f.id.startsWith("kf-"), `AC5 — ${f.path} has a stable id`);
    assert(f.byteSize > 0, `AC5 — ${f.path} has byteSize > 0 (${f.byteSize} bytes)`);
    assert(/^[0-9a-f]{12}$/.test(f.versionHash), `AC5 — ${f.path} versionHash is sha256[:12] (${f.versionHash})`);
    assert(typeof f.content === "string" && f.content.length > 0, `AC5 — ${f.path} has a non-empty body`);
    if (f.fileType !== "glossary") {
      assert(f.injectionRoles.length > 0, `AC5 — ${f.path} has at least one injection role`);
    }
  }

  // AC6: RBAC.
  assert(canAccessKnowledgeCenter("pm") === true, "AC6 — PM can browse (no privileged read per Plan 1 §3.3)");
  assert(canAccessKnowledgeCenter("eng-lead") === true, "AC6 — Eng Lead can browse");
  assert(canAccessKnowledgeCenter("cto") === true, "AC6 — CTO can browse");
  assert(isFirstTimeVisitor("pm") === true, "AC6 — PM gets the first-time visitor primer");
  assert(isFirstTimeVisitor("eng-lead") === false, "AC6 — Eng Lead does not get the primer");
  assert(isFirstTimeVisitor("cto") === false, "AC6 — CTO does not get the primer");
  assert(knowledgeCenterPersonaLabel("pm") === "Product Manager", "AC6 — PM persona label is correct");

  // AC7: forge-app mirror matches @fora/forge-ui/typed-artifacts.
  // The shipped KnowledgeFile has these fields (FORA-502.1 commit 76ebb47e);
  // a drift here is a v1.0 GA ship-blocker.
  const REQUIRED_FIELDS = [
    "id",
    "path",
    "title",
    "folder",
    "fileType",
    "byteSize",
    "versionHash",
    "injectionRoles",
    "content",
  ];
  for (const f of files) {
    for (const field of REQUIRED_FIELDS) {
      assert(field in f, `AC7 — ${f.path} has field '${field}' (mirror of @fora/forge-ui/typed-artifacts)`);
    }
    // Per-stage role shape.
    for (const r of f.injectionRoles) {
      assert(typeof r.stage === "string" && r.stage.length > 0, `AC7 — ${f.path} role has non-empty stage`);
      assert(["primary", "secondary", "glossary"].includes(r.role), `AC7 — ${f.path} role is in the closed enum`);
    }
  }

  // AC8: workspace root is reachable; the producer reads the actual on-disk files.
  const root = workspaceRoot();
  assert(root.endsWith("/workspace"), `AC8 — workspaceRoot ends in /workspace (got ${root})`);
  // Cross-check at least one file's byteSize matches the on-disk stat.
  const codingPath = join(resolve(root), "memory/coding.md");
  const onDisk = readFileSync(codingPath, "utf-8");
  assert(onDisk.length > 0, "AC8 — on-disk memory/coding.md has content");
  assert(coding?.byteSize === Buffer.byteLength(onDisk, "utf-8"), "AC8 — byteSize matches on-disk stat");

  // AC9: KNOWLEDGE_FILE_TYPES is the closed set the filter bar exposes.
  assert(KNOWLEDGE_FILE_TYPES.length === 4, "AC9 — four file-type buckets");
  for (const t of KNOWLEDGE_FILE_TYPES) {
    assert(
      t === "markdown" || t === "json-schema" || t === "adr-registry" || t === "glossary",
      `AC9 — file type ${t} is in the closed enum`,
    );
  }

  console.log("ok  - FORA-502.2 acceptance smoke — all 9 ACs green");
})();
