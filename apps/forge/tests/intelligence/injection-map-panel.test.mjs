/**
 * FORA-502.4 acceptance smoke — injection map panel.
 *
 * Mirrors the FORA-502.2 smoke (the bin/fora-*.mjs pattern). Runs
 * under node directly, no vitest/jsdom. Exits non-zero on the first
 * failed assertion.
 *
 * Acceptance criteria covered:
 *   AC1 — 12 stages pinned in display order.
 *   AC2 — Every stage's `glossaryFileIds` contains the glossary.
 *   AC3 — Every non-Memory stage has at least one injected file
 *          (the Memory stage has all 12).
 *   AC4 — The injection-model producer's `StageInjectionMap` shape
 *          matches the local type mirror + the shipped
 *          `@fora/forge-ui/typed-artifacts` field set (drift =
 *          v1.0 GA ship-blocker).
 *   AC5 — Per-stage `fileIds` resolve to real `KnowledgeFile`
 *          records via the manifest (no dangling ids).
 *   AC6 — The 12 stages cover the canonical sub-agent roster
 *          (BA, Architect, Developer, QA, Security, DevOps,
 *          Documentation, Refactor, Cost, Audit, Evaluation, Memory).
 *   AC7 — README §2 row parity: a sample stage ("Developer") has the
 *          expected memory / customer / project / glossary rows.
 */

import { listKnowledgeFiles } from "../../lib/knowledge/manifest.ts";
import {
  listStageInjectionMaps,
  getStageInjectionMap,
  getStageFiles,
  primaryStageForFile,
  knowledgeFileId,
  STAGE_COUNT,
  GLOSSARY_PATH,
  STAGE_LABELS,
} from "../../lib/knowledge/injection-model.ts";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok  -", msg);
}

(async () => {
  // AC1: 12 stages pinned in display order.
  const maps = listStageInjectionMaps();
  assert(maps.length === STAGE_COUNT, `AC1 — ${STAGE_COUNT} stages (got ${maps.length})`);
  assert(maps.length === 12, "AC1 — exactly 12 stages per workspace/README.md §2");
  assert(STAGE_LABELS.length === 12, "AC1 — STAGE_LABELS pinned at 12");

  // AC6: the canonical sub-agent roster.
  const expected = [
    "BA / Ideation",
    "Architect",
    "Developer",
    "QA",
    "Security",
    "DevOps",
    "Documentation",
    "Refactor",
    "Cost",
    "Audit",
    "Evaluation",
    "Memory",
  ];
  for (let i = 0; i < expected.length; i++) {
    assert(maps[i].stage === expected[i], `AC6 — stage[${i}] = ${expected[i]}`);
  }

  // AC2: every stage's glossary is the always-injected file.
  const glossaryId = knowledgeFileId(GLOSSARY_PATH);
  for (const m of maps) {
    assert(
      m.glossaryFileIds.length === 1 && m.glossaryFileIds[0] === glossaryId,
      `AC2 — ${m.stage} has glossary in glossaryFileIds`,
    );
  }

  // AC3: every non-Memory stage has at least one injected file.
  for (const m of maps) {
    if (m.stage === "Memory") {
      assert(m.fileIds.length === 11, `AC3 — Memory stage has 11 non-glossary files (got ${m.fileIds.length})`);
    } else {
      assert(
        m.fileIds.length >= 1,
        `AC3 — ${m.stage} stage has at least one injected file (got ${m.fileIds.length})`,
      );
    }
  }

  // AC4: the local StageInjectionMap mirror matches the canonical
  // @fora/forge-ui/typed-artifacts field set (shipped in FORA-502.1).
  // Drift here is a v1.0 GA ship-blocker.
  const REQUIRED_FIELDS = ["id", "stage", "fileIds", "glossaryFileIds", "ownerRole"];
  for (const m of maps) {
    for (const field of REQUIRED_FIELDS) {
      assert(field in m, `AC4 — stage '${m.stage}' has field '${field}' (mirror of @fora/forge-ui/typed-artifacts)`);
    }
    assert(typeof m.stage === "string" && m.stage.length > 0, `AC4 — ${m.stage} stage is a non-empty string`);
    assert(Array.isArray(m.fileIds), `AC4 — ${m.stage} fileIds is an array`);
    assert(Array.isArray(m.glossaryFileIds), `AC4 — ${m.stage} glossaryFileIds is an array`);
    if (m.ownerRole !== undefined) {
      assert(typeof m.ownerRole === "string" && m.ownerRole.length > 0, `AC4 — ${m.stage} ownerRole is a non-empty string when present`);
    }
  }

  // AC5: every fileId resolves to a real KnowledgeFile via the manifest.
  const allFiles = listKnowledgeFiles();
  const allIds = new Set(allFiles.map((f) => f.id));
  for (const m of maps) {
    for (const id of m.fileIds) {
      assert(allIds.has(id), `AC5 — ${m.stage} fileId ${id} resolves to a real KnowledgeFile`);
    }
    for (const id of m.glossaryFileIds) {
      assert(allIds.has(id), `AC5 — ${m.stage} glossaryFileId ${id} resolves to a real KnowledgeFile`);
    }
  }

  // AC7: README §2 row parity for "Developer".
  const dev = getStageInjectionMap("Developer");
  assert(dev !== null, "AC7 — Developer stage present");
  const devOwner = dev && dev.ownerRole;
  const devFiles = getStageFiles("Developer");
  const devPaths = devFiles.map((f) => f.path);
  for (const expected of [
    "memory/coding.md",
    "memory/architecture.md",
    "customer/conventions.md",
    "customer/glossary.md",
    "project/tech-stack.md",
  ]) {
    assert(
      devPaths.includes(expected),
      `AC7 — Developer stage includes ${expected} (got ${devPaths.join(", ")})`,
    );
  }
  assert(
    devOwner === "SeniorEngineer",
    `AC7 — Developer stage ownerRole = SeniorEngineer (got ${devOwner})`,
  );

  // Bonus: primaryStageForFile round-trip.
  const coding = allFiles.find((f) => f.path === "memory/coding.md");
  assert(coding !== undefined, "AC8 — coding.md present in manifest");
  const primary = primaryStageForFile(coding);
  assert(
    primary === "Developer" || primary === "Refactor",
    `AC8 — primaryStageForFile(coding.md) returns a primary stage (got ${primary})`,
  );

  console.log("ok  - FORA-502.4 acceptance smoke — all 8 ACs green");
})();
