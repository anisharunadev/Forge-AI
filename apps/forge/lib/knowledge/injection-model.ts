/**
 * Injection model producer (FORA-502.4).
 *
 * Reads the workspace/README.md §2 injection table verbatim and emits
 * a typed `StageInjectionMap[]` per the local mirror in
 * `apps/forge/lib/knowledge/types.ts` (which mirrors the canonical
 * `@fora/forge-ui/typed-artifacts` shape shipped in FORA-502.1).
 *
 * The "what does each agent see?" panel renders one
 * `StageInjectionMap` per stage. v1.0 is read-only (Plan 1 §5.1);
 * the "swap file for stage" affordance is a v1.1 conversation
 * (Plan 1 §5.2).
 *
 * `knowledgeFileId(path)` resolves a path to the matching
 * `KnowledgeFile.id` (per `apps/forge/lib/knowledge/manifest.ts`),
 * keeping the fileId resolution in one place.
 *
 * The 12 stages are pinned in display order. The `co-owner` column
 * comes from README §8 — "A sub-agent owner (Developer, Security,
 * DevOps, etc.) is the co-owner of their stage's memory file."
 */

import { listKnowledgeFiles, getKnowledgeFile } from "./manifest.ts";
import type { KnowledgeFile, StageInjectionMap } from "./types.ts";

/** Resolve a workspace path (e.g. "memory/coding.md") to its `KnowledgeFile.id`. */
export function knowledgeFileId(path: string): string {
  return `kf-${path.replace(/[\\/]+/g, "-")}`;
}

/** Every README §2 row. The stage label is the canonical name from the table. */
interface RawRow {
  readonly stage: string;
  readonly ownerRole?: string;
  /** Each row's per-file paths, grouped by sub-agent convention. */
  readonly paths: ReadonlyArray<string>;
  /** Stage-specific extras (templates, runbooks, etc.) — informational, not a file. */
  readonly extra: string;
}

const ROWS: ReadonlyArray<RawRow> = [
  {
    stage: "BA / Ideation",
    ownerRole: "ProductManager",
    paths: [
      "memory/ideation.md",
      "memory/architecture.md",
      "customer/conventions.md",
      "customer/glossary.md",
      "project/PRD.md",
    ],
    extra: "PRD template",
  },
  {
    stage: "Architect",
    ownerRole: "Architect",
    paths: [
      "memory/architecture.md",
      "memory/security.md",
      "customer/standards.md",
      "customer/conventions.md",
      "customer/glossary.md",
      "project/PRD.md",
      "project/tech-stack.md",
    ],
    extra: "ADR template",
  },
  {
    stage: "Developer",
    ownerRole: "SeniorEngineer",
    paths: [
      "memory/coding.md",
      "memory/architecture.md",
      "customer/conventions.md",
      "customer/glossary.md",
      "project/tech-stack.md",
    ],
    extra: "PR template",
  },
  {
    stage: "QA",
    ownerRole: "QA",
    paths: [
      "memory/coding.md",
      "memory/qa.md",
      "customer/conventions.md",
      "customer/glossary.md",
      "project/tech-stack.md",
    ],
    extra: "eval set",
  },
  {
    stage: "Security",
    ownerRole: "SecurityEngineer",
    paths: [
      "memory/security.md",
      "memory/architecture.md",
      "customer/standards.md",
      "customer/glossary.md",
      "project/tech-stack.md",
    ],
    extra: "threat model",
  },
  {
    stage: "DevOps",
    ownerRole: "DevOps",
    paths: [
      "memory/devops.md",
      "memory/coding.md",
      "customer/conventions.md",
      "customer/glossary.md",
      "project/tech-stack.md",
    ],
    extra: "deploy runbook",
  },
  {
    stage: "Documentation",
    ownerRole: "Documentation",
    paths: [
      "customer/standards.md",
      "customer/conventions.md",
      "customer/glossary.md",
      "project/PRD.md",
      "project/roadmap.md",
    ],
    extra: "doc template",
  },
  {
    stage: "Refactor",
    ownerRole: "SeniorEngineer",
    paths: [
      "memory/coding.md",
      "memory/architecture.md",
      "customer/conventions.md",
      "customer/glossary.md",
      "project/tech-stack.md",
    ],
    extra: "refactor checklist",
  },
  {
    stage: "Cost",
    ownerRole: "Cost",
    paths: [
      "memory/devops.md",
      "memory/architecture.md",
      "customer/conventions.md",
      "customer/glossary.md",
      "project/tech-stack.md",
      "project/roadmap.md",
    ],
    extra: "FinOps review template",
  },
  {
    stage: "Audit",
    ownerRole: "SecurityEngineer",
    paths: [
      "memory/security.md",
      "memory/architecture.md",
      "customer/standards.md",
      "customer/glossary.md",
      "project/tech-stack.md",
    ],
    extra: "audit sample script",
  },
  {
    stage: "Evaluation",
    ownerRole: "QA",
    paths: [
      "memory/coding.md",
      "memory/security.md",
      "customer/standards.md",
      "customer/glossary.md",
      "project/tech-stack.md",
    ],
    extra: "eval set",
  },
  {
    stage: "Memory",
    ownerRole: "CTO",
    // README §2 row says "all six" memory + "all three" customer + "all three" project.
    paths: [
      "memory/coding.md",
      "memory/security.md",
      "memory/architecture.md",
      "memory/devops.md",
      "memory/ideation.md",
      "memory/qa.md",
      "customer/standards.md",
      "customer/conventions.md",
      "customer/glossary.md",
      "project/PRD.md",
      "project/roadmap.md",
      "project/tech-stack.md",
    ],
    extra: "Knowledge Layer spec (workspace/README.md)",
  },
];

/** The glossary file path — always-injected per README §2. */
export const GLOSSARY_PATH = "customer/glossary.md";

/** The pinned set of stage labels in display order. */
export const STAGE_LABELS: ReadonlyArray<string> = ROWS.map((r) => r.stage);

/**
 * The 12-stage injection model as a typed `StageInjectionMap[]`. The
 * `fileIds` field is the per-stage file list; the `glossaryFileIds`
 * field is the always-injected glossary (one entry per stage). The
 * renderer composes both into the "what does each agent see?" panel.
 */
export function listStageInjectionMaps(): ReadonlyArray<StageInjectionMap> {
  const glossaryId = knowledgeFileId(GLOSSARY_PATH);
  return ROWS.map((row, idx) => {
    const fileIds: string[] = [];
    for (const path of row.paths) {
      // Skip the glossary — it lives in `glossaryFileIds`.
      if (path === GLOSSARY_PATH) continue;
      fileIds.push(knowledgeFileId(path));
    }
    return {
      id: `sim-${idx + 1}-${row.stage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      stage: row.stage,
      fileIds,
      glossaryFileIds: [glossaryId],
      ...(row.ownerRole ? { ownerRole: row.ownerRole } : {}),
    };
  });
}

/** One stage by label (e.g. "Developer"). Returns null on miss. */
export function getStageInjectionMap(stage: string): StageInjectionMap | null {
  return listStageInjectionMaps().find((m) => m.stage === stage) ?? null;
}

/** Resolve a `StageInjectionMap` to its full `KnowledgeFile[]` (stage + glossary). */
export function getStageFiles(stage: string): ReadonlyArray<KnowledgeFile> {
  const map = getStageInjectionMap(stage);
  if (!map) return [];
  const all = listKnowledgeFiles();
  const out: KnowledgeFile[] = [];
  for (const id of [...map.fileIds, ...map.glossaryFileIds]) {
    const f = all.find((kf) => kf.id === id);
    if (f) out.push(f);
  }
  return out;
}

/** The stage label that owns a given `KnowledgeFile` (i.e. the file's first injection role). */
export function primaryStageForFile(file: KnowledgeFile): string | null {
  const role = file.injectionRoles.find((r) => r.role === "primary");
  return role?.stage ?? null;
}

/** Smoke seam. */
export const STAGE_COUNT = ROWS.length;
