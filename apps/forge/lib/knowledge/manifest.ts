/**
 * Knowledge Layer manifest producer (FORA-502.2).
 *
 * Reads the 12 v1 files from `workspace/` (per workspace/README.md §1)
 * and emits a typed `KnowledgeFile[]` per the local mirror in
 * `apps/forge/lib/knowledge/types.ts` (which mirrors the canonical
 * `@fora/forge-ui/typed-artifacts` shape shipped in FORA-502.1).
 *
 * Why a static read: the 12-file v1 layout is small, file-content
 * rarely changes between deploys, and the producer is the Handoff
 * Contract's `KnowledgeFile` schema (memory/architecture.md §7) in
 * disguise. The Forge knowledge-manifest.json producer (FORA-389)
 * owns the live / per-engagement case; this module is the in-repo
 * reference for the v1.0 GA seam.
 *
 * Content surface:
 *   * Folder  — memory | customer | project | engagements (placeholder)
 *   * File type — markdown | json-schema | adr-registry | glossary
 *   * Per-stage injection roles — denormalised from workspace/README.md §2
 *
 * Hashes are sha256[:12] of the file body at read time. The byteSize
 * is the raw byte length. The renderer never mutates these fields.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type {
  KnowledgeFile,
  KnowledgeFileType,
  KnowledgeFolder,
  KnowledgeInjectionRole,
} from "./types";

interface RawFileEntry {
  readonly path: string;
  readonly folder: KnowledgeFolder;
  readonly fileType: KnowledgeFileType;
  readonly injectionRoles: ReadonlyArray<KnowledgeInjectionRole>;
  readonly title?: string;
}

/** The 12 v1 files per workspace/README.md §1. v1.0 GA pins this set. */
const V1_FILES: ReadonlyArray<RawFileEntry> = [
  // memory/ — 6 files
  {
    path: "memory/coding.md",
    folder: "memory",
    fileType: "markdown",
    injectionRoles: [
      { stage: "Developer", role: "primary" },
      { stage: "QA", role: "secondary" },
      { stage: "Refactor", role: "primary" },
    ],
  },
  {
    path: "memory/security.md",
    folder: "memory",
    fileType: "markdown",
    injectionRoles: [
      { stage: "Architect", role: "primary" },
      { stage: "Security", role: "primary" },
      { stage: "Audit", role: "primary" },
      { stage: "Evaluation", role: "secondary" },
    ],
  },
  {
    path: "memory/architecture.md",
    folder: "memory",
    fileType: "markdown",
    injectionRoles: [
      { stage: "BA", role: "secondary" },
      { stage: "Architect", role: "primary" },
      { stage: "Developer", role: "primary" },
      { stage: "Refactor", role: "primary" },
      { stage: "Cost", role: "primary" },
      { stage: "Audit", role: "primary" },
    ],
  },
  {
    path: "memory/devops.md",
    folder: "memory",
    fileType: "markdown",
    injectionRoles: [
      { stage: "DevOps", role: "primary" },
      { stage: "Cost", role: "primary" },
    ],
  },
  {
    path: "memory/ideation.md",
    folder: "memory",
    fileType: "markdown",
    injectionRoles: [{ stage: "BA", role: "primary" }],
  },
  {
    path: "memory/qa.md",
    folder: "memory",
    fileType: "markdown",
    injectionRoles: [
      { stage: "QA", role: "primary" },
      { stage: "Evaluation", role: "primary" },
    ],
  },
  // customer/ — 3 files
  {
    path: "customer/standards.md",
    folder: "customer",
    fileType: "markdown",
    injectionRoles: [
      { stage: "Architect", role: "secondary" },
      { stage: "Security", role: "primary" },
      { stage: "Documentation", role: "primary" },
      { stage: "Audit", role: "secondary" },
    ],
  },
  {
    path: "customer/conventions.md",
    folder: "customer",
    fileType: "markdown",
    injectionRoles: [
      { stage: "BA", role: "secondary" },
      { stage: "Architect", role: "secondary" },
      { stage: "Developer", role: "secondary" },
      { stage: "QA", role: "secondary" },
      { stage: "Security", role: "secondary" },
      { stage: "DevOps", role: "secondary" },
      { stage: "Documentation", role: "primary" },
      { stage: "Refactor", role: "secondary" },
      { stage: "Cost", role: "secondary" },
      { stage: "Audit", role: "secondary" },
      { stage: "Evaluation", role: "secondary" },
    ],
  },
  {
    path: "customer/glossary.md",
    folder: "customer",
    fileType: "glossary",
    injectionRoles: [], // glossary is always-injected; surfaced via `glossaryFileIds` per stage
  },
  // project/ — 3 files
  {
    path: "project/PRD.md",
    folder: "project",
    fileType: "markdown",
    injectionRoles: [
      { stage: "BA", role: "primary" },
      { stage: "Documentation", role: "primary" },
    ],
  },
  {
    path: "project/roadmap.md",
    folder: "project",
    fileType: "markdown",
    injectionRoles: [
      { stage: "Cost", role: "secondary" },
      { stage: "Documentation", role: "primary" },
    ],
  },
  {
    path: "project/tech-stack.md",
    folder: "project",
    fileType: "markdown",
    injectionRoles: [
      { stage: "Architect", role: "secondary" },
      { stage: "Developer", role: "secondary" },
      { stage: "QA", role: "secondary" },
      { stage: "Security", role: "secondary" },
      { stage: "DevOps", role: "primary" },
      { stage: "Refactor", role: "secondary" },
      { stage: "Cost", role: "secondary" },
      { stage: "Audit", role: "secondary" },
      { stage: "Evaluation", role: "secondary" },
    ],
  },
];

/** The Knowledge Layer root, resolved from the forge app's cwd at module load. */
function resolveWorkspaceRoot(): string {
  // apps/forge/lib/knowledge/manifest.ts → apps/forge/lib/knowledge → up 3 to repo root
  return resolve(process.cwd(), "..", "..", "workspace");
}

function sha256Prefix12(buf: string): string {
  return createHash("sha256").update(buf, "utf-8").digest("hex").slice(0, 12);
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function toKnowledgeFile(entry: RawFileEntry, workspaceRoot: string): KnowledgeFile {
  const abs = join(workspaceRoot, entry.path);
  let body: string;
  let byteSize: number;
  let mtimeIso: string | undefined;
  try {
    body = readFileSync(abs, "utf-8");
    const stat = statSync(abs);
    byteSize = stat.size;
    mtimeIso = stat.mtime.toISOString();
  } catch {
    // File missing on disk (e.g. per-engagement extension the producer
    // hasn't materialised). Surface an empty body so the renderer still
    // renders the card; byteSize=0 + versionHash=zeros signal the miss.
    body = "";
    byteSize = 0;
    mtimeIso = undefined;
  }
  return {
    id: `kf-${entry.path.replace(/[\\/]+/g, "-")}`,
    path: entry.path,
    title: entry.title ?? basename(entry.path),
    folder: entry.folder,
    fileType: entry.fileType,
    byteSize,
    versionHash: body ? sha256Prefix12(body) : "000000000000",
    injectionRoles: entry.injectionRoles,
    content: body,
    updatedAt: mtimeIso,
  };
}

let cached: ReadonlyArray<KnowledgeFile> | null = null;
let cachedRoot: string | null = null;

/** All v1 files (cached per workspaceRoot). */
export function listKnowledgeFiles(): ReadonlyArray<KnowledgeFile> {
  const root = resolveWorkspaceRoot();
  if (cached && cachedRoot === root) return cached;
  cached = V1_FILES.map((e) => toKnowledgeFile(e, root));
  cachedRoot = root;
  return cached;
}

/** One file by `path` (e.g. "memory/coding.md"). Returns null on miss. */
export function getKnowledgeFile(path: string): KnowledgeFile | null {
  return listKnowledgeFiles().find((f) => f.path === path) ?? null;
}

/** All files under a folder. */
export function listKnowledgeFilesByFolder(folder: KnowledgeFolder): ReadonlyArray<KnowledgeFile> {
  return listKnowledgeFiles().filter((f) => f.folder === folder);
}

/** All files of a given type. */
export function listKnowledgeFilesByType(type: KnowledgeFileType): ReadonlyArray<KnowledgeFile> {
  return listKnowledgeFiles().filter((f) => f.fileType === type);
}

/** Folder roots in display order (v1 pins these three; engagements is v1.1+). */
export const KNOWLEDGE_FOLDERS: ReadonlyArray<KnowledgeFolder> = [
  "memory",
  "customer",
  "project",
];

/** File-type buckets the filter bar exposes (Plan 1 §3.3 #5). */
export const KNOWLEDGE_FILE_TYPES: ReadonlyArray<KnowledgeFileType> = [
  "markdown",
  "json-schema",
  "adr-registry",
  "glossary",
];

/** Smoke-test seam. */
export const V1_FILE_COUNT = V1_FILES.length;
export function workspaceRoot(): string {
  return resolveWorkspaceRoot().split(sep).join("/");
}
