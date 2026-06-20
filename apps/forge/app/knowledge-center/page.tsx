/**
 * Knowledge Center — read-only Knowledge Layer browser (FORA-502.2).
 *
 * The PM / Eng Lead / CTO landing for the Knowledge Layer. Server
 * component; the URL is the source of truth (no client state).
 *
 * Reconciles with:
 *   * Plan 1 §3.3 #1-2, 5-6 — folder tree + file viewer + filters.
 *   * Plan 4 §6 — the `FileTree` primitive (mirrored locally as
 *     `KnowledgeFileTree`; see components/knowledge/KnowledgeFileTree.tsx
 *     for the why).
 *   * Plan 1 Q4 — the Knowledge Center is read-only in v1.0; no edit
 *     affordances are exposed. v1.1 will add the glossary-PR flow
 *     behind `evaluateBoardAccess` (FORA-507).
 *   * The "What does each agent see?" panel (FORA-602) lives on a
 *     sibling tab; this page is the *file browser*.
 *
 * URL state (search params, kept minimal):
 *   * `?file=<path>`   — the file the main column shows.
 *   * `?folder=<name>` — filter the left rail (memory | customer | project | all).
 *   * `?type=<type>`   — filter by file type (markdown | json-schema | adr-registry | glossary | all).
 *
 * Deep-link examples:
 *   /knowledge-center
 *   /knowledge-center?file=memory%2Fcoding.md
 *   /knowledge-center?folder=memory&type=markdown
 */

import { cookies } from "next/headers";
import { readPersonaFromCookieHeader } from "@/lib/auth";
import {
  isFirstTimeVisitor,
  knowledgeCenterPersonaLabel,
} from "@/lib/knowledge/rbac";
import {
  KNOWLEDGE_FOLDERS,
  KNOWLEDGE_FILE_TYPES,
  listKnowledgeFiles,
  getKnowledgeFile,
  workspaceRoot as _workspaceRoot,
} from "@/lib/knowledge/manifest";
import type { KnowledgeFile, KnowledgeFileType, KnowledgeFolder, GraphFilter } from "@/lib/knowledge/types";
import { KnowledgeFileView } from "@/components/knowledge/KnowledgeFileView";
import { KnowledgeFileTree } from "@/components/knowledge/KnowledgeFileTree";
import { InjectionMapPanel } from "@/components/knowledge/InjectionMapPanel";
import { KnowledgeGraphView } from "@/components/knowledge/KnowledgeGraphView";

export const dynamic = "force-dynamic";

type KnowledgeView = "files" | "map" | "graph";

interface KnowledgeCenterSearchParams {
  readonly file?: string;
  readonly folder?: string;
  readonly type?: string;
  readonly view?: string;
  readonly stage?: string;
  readonly federation?: string;
}

function isView(value: string | undefined): value is KnowledgeView {
  return value === "files" || value === "map" || value === "graph";
}

function parseSearchParams(
  raw: KnowledgeCenterSearchParams | undefined,
): KnowledgeCenterSearchParams {
  if (!raw) return {};
  return {
    file: typeof raw.file === "string" ? raw.file : Array.isArray(raw.file) ? raw.file[0] : undefined,
    folder: typeof raw.folder === "string" ? raw.folder : Array.isArray(raw.folder) ? raw.folder[0] : undefined,
    type: typeof raw.type === "string" ? raw.type : Array.isArray(raw.type) ? raw.type[0] : undefined,
    view: typeof raw.view === "string" ? raw.view : Array.isArray(raw.view) ? raw.view[0] : undefined,
    stage: typeof raw.stage === "string" ? raw.stage : Array.isArray(raw.stage) ? raw.stage[0] : undefined,
    federation: typeof raw.federation === "string" ? raw.federation : Array.isArray(raw.federation) ? raw.federation[0] : undefined,
  };
}

function isFolder(value: string | undefined): value is KnowledgeFolder {
  return (
    value === "memory" ||
    value === "customer" ||
    value === "project" ||
    value === "engagements" ||
    value === "reference"
  );
}

function isFileType(value: string | undefined): value is KnowledgeFileType {
  return (
    value === "markdown" ||
    value === "json-schema" ||
    value === "adr-registry" ||
    value === "glossary"
  );
}

function applyFilters(
  files: ReadonlyArray<KnowledgeFile>,
  folder: KnowledgeFolder | "all",
  type: KnowledgeFileType | "all",
): ReadonlyArray<KnowledgeFile> {
  return files.filter((f) => {
    if (folder !== "all" && f.folder !== folder) return false;
    if (type !== "all" && f.fileType !== type) return false;
    return true;
  });
}

function filterQueryString(
  file: string | undefined,
  folder: KnowledgeFolder | "all",
  type: KnowledgeFileType | "all",
  view: KnowledgeView = "files",
  stage: string | undefined = undefined,
  federation: boolean = false,
): string {
  const params = new URLSearchParams();
  if (view !== "files") params.set("view", view);
  if (file) params.set("file", file);
  if (folder !== "all") params.set("folder", folder);
  if (type !== "all") params.set("type", type);
  if (stage) params.set("stage", stage);
  if (federation) params.set("federation", "1");
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default async function KnowledgeCenterPage({
  searchParams,
}: {
  searchParams?: Promise<KnowledgeCenterSearchParams> | KnowledgeCenterSearchParams;
}) {
  // Next.js 15 may wrap searchParams in a Promise; the FORA-381
  // smoke caught this. Await defensively.
  const params: KnowledgeCenterSearchParams = parseSearchParams(
    searchParams ? await Promise.resolve(searchParams) : undefined,
  );

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const persona = readPersonaFromCookieHeader(cookieHeader);

  const files = listKnowledgeFiles();
  const folderFilter: KnowledgeFolder | "all" = isFolder(params.folder) ? params.folder : "all";
  const typeFilter: KnowledgeFileType | "all" = isFileType(params.type) ? params.type : "all";
  const view: KnowledgeView = isView(params.view) ? params.view : "files";
  const stageFilter = params.stage;
  const federation = params.federation === "1";
  const filtered = applyFilters(files, folderFilter, typeFilter);

  const selectedFile = params.file ? getKnowledgeFile(params.file) : null;
  const showFirstTime = isFirstTimeVisitor(persona);

  return (
    <div className="space-y-6" data-testid="knowledge-center">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-forge-300">Center</p>
        <h1 className="text-2xl font-semibold text-forge-50">Knowledge Center</h1>
        <p className="text-sm text-forge-200">
          Read-only browser over the {files.length} v1 Knowledge Layer files.{" "}
          {knowledgeCenterPersonaLabel(persona)} can audit what every agent reads
          (Plan 1 §3.3 — no privileged read).
        </p>
      </header>

      {showFirstTime && (
        <aside
          aria-label="Knowledge Center primer"
          className="rounded-md border border-indigo-500/40 bg-indigo-500/5 p-3 text-sm text-forge-100"
          data-testid="knowledge-center-primer"
          data-primer-kind="pm"
        >
          <p className="font-medium text-indigo-100">What is this?</p>
          <p className="mt-1 text-forge-200">
            Every sub-agent at Forge AI wakes up with a slice of these files. The
            left rail is the folder tree; the main column is the file. The
            <span className="font-mono"> type</span> filter narrows by file
            shape. The &ldquo;What does each agent see?&rdquo; tab shows the
            per-stage injection map.
          </p>
        </aside>
      )}

      <nav
        aria-label="Knowledge Center views"
        className="flex gap-1 border-b border-forge-700/40"
        data-testid="knowledge-center-tabs"
        data-active-view={view}
      >
        <a
          href={`/knowledge-center${filterQueryString(undefined, folderFilter, typeFilter, "files", stageFilter, federation)}`}
          data-testid="tab-files"
          data-active={view === "files"}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
            view === "files"
              ? "border-forge-300 text-forge-50"
              : "border-transparent text-forge-300 hover:text-forge-100"
          }`}
        >
          Files
        </a>
        <a
          href={`/knowledge-center${filterQueryString(undefined, folderFilter, typeFilter, "map", stageFilter, federation)}`}
          data-testid="tab-map"
          data-active={view === "map"}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
            view === "map"
              ? "border-forge-300 text-forge-50"
              : "border-transparent text-forge-300 hover:text-forge-100"
          }`}
        >
          What does each agent see?
        </a>
        <a
          href={`/knowledge-center${filterQueryString(undefined, folderFilter, typeFilter, "graph", stageFilter, federation)}`}
          data-testid="tab-graph"
          data-active={view === "graph"}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
            view === "graph"
              ? "border-forge-300 text-forge-50"
              : "border-transparent text-forge-300 hover:text-forge-100"
          }`}
        >
          Graph
        </a>
      </nav>

      <section
        aria-labelledby="filters-h"
        className="space-y-2"
        data-testid="knowledge-center-filters"
      >
        <h2 id="filters-h" className="text-xs uppercase tracking-wider text-forge-300">
          Filters
        </h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <FilterPill
            label="all folders"
            href={`/knowledge-center${filterQueryString(params.file, "all", typeFilter)}`}
            active={folderFilter === "all"}
            testid="filter-folder-all"
          />
          {KNOWLEDGE_FOLDERS.map((f) => (
            <FilterPill
              key={f}
              label={f}
              href={`/knowledge-center${filterQueryString(params.file, f, typeFilter)}`}
              active={folderFilter === f}
              testid={`filter-folder-${f}`}
            />
          ))}
          <span className="mx-1 text-forge-500" aria-hidden="true">
            ·
          </span>
          <FilterPill
            label="all types"
            href={`/knowledge-center${filterQueryString(params.file, folderFilter, "all")}`}
            active={typeFilter === "all"}
            testid="filter-type-all"
          />
          {KNOWLEDGE_FILE_TYPES.map((t) => (
            <FilterPill
              key={t}
              label={t}
              href={`/knowledge-center${filterQueryString(params.file, folderFilter, t)}`}
              active={typeFilter === t}
              testid={`filter-type-${t}`}
            />
          ))}
        </div>
        <p className="text-xs text-forge-400" data-testid="knowledge-center-result-count">
          Showing {filtered.length} of {files.length} files
          {folderFilter !== "all" ? ` in ${folderFilter}/` : ""}
          {typeFilter !== "all" ? ` (type: ${typeFilter})` : ""}.
        </p>
      </section>

      {view === "map" ? (
        <InjectionMapPanel />
      ) : view === "graph" ? (
        <KnowledgeGraphView
          filter={{
            folder: folderFilter,
            fileType: typeFilter,
            stage: stageFilter ?? "all",
          }}
          federation={federation}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
          <aside
            aria-label="File tree"
            className="rounded-md border border-forge-700/40 bg-forge-900/40 p-3"
            data-testid="knowledge-center-tree-rail"
          >
            <h2 className="mb-2 text-xs uppercase tracking-wider text-forge-300">Folders</h2>
            <KnowledgeFileTree
              files={files}
              selectedPath={selectedFile?.path}
              activeFolder={folderFilter}
              activeFileType={typeFilter}
            />
          </aside>

          <main
            className="space-y-4"
            data-testid="knowledge-center-main"
            data-selected-path={selectedFile?.path ?? ""}
          >
            {selectedFile ? (
              <KnowledgeFileView file={selectedFile} />
            ) : (
              <div
                className="card text-sm text-forge-300"
                data-testid="knowledge-center-empty"
                data-empty-kind="no-selection"
              >
                <p className="font-medium text-forge-100">Pick a file from the left rail.</p>
                <p className="mt-1 text-forge-300">
                  The Knowledge Center is the typed-artifact browser for the Knowledge
                  Layer. The list view (left) and graph view (coming in
                  FORA-601) both surface the same 12 v1 files.
                </p>
                <p className="mt-2 text-xs text-forge-400">
                  Workspace root: <span className="font-mono">{_workspaceRoot()}</span>
                </p>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  label,
  href,
  active,
  testid,
}: {
  label: string;
  href: string;
  active: boolean;
  testid: string;
}) {
  return (
    <a
      href={href}
      data-testid={testid}
      data-active={active}
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${
        active
          ? "border-forge-300 bg-forge-700/40 text-forge-50"
          : "border-forge-700/40 bg-forge-800/40 text-forge-200 hover:border-forge-500"
      }`}
    >
      {label}
    </a>
  );
}
