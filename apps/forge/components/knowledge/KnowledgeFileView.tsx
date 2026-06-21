/**
 * KnowledgeFileView — the forge-console mirror of the
 * `KnowledgeFileRenderer` `panel` variant shipped in
 * `the v2.0 typed-artifact system` (FORA-502.1).
 *
 * Uses the forge app's tailwind tokens (`forge-*`, `text-forge-300`,
 * `border-forge-700/40`) so the file viewer matches the rest of the
 * Knowledge Center. The two renderers (this one + the shipped
 * KnowledgeFileRenderer) MUST stay in lockstep; a drift is a v1.0 GA
 * ship-blocker.
 *
 * Reconciles with:
 *   * Plan 1 §3.3 #2 — file viewer (markdown + JSON Schema + ADR).
 *   * Plan 4 §3.1 — typed-artifact renderer contract.
 *   * The `KnowledgeFile` typed-artifact in
 *     `apps/forge/lib/knowledge/types.ts` (mirror of
 *     `the v2.0 typed-artifact system`).
 */
import type { KnowledgeFile } from "@/lib/knowledge/types";

const FOLDER_TONE: Record<
  KnowledgeFile["folder"],
  { pillClass: string; label: string }
> = {
  memory: { pillClass: "bg-indigo-500/15 text-indigo-200 border border-indigo-500/30", label: "memory" },
  customer: { pillClass: "bg-amber-500/15 text-amber-200 border border-amber-500/30", label: "customer" },
  project: { pillClass: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30", label: "project" },
  engagements: { pillClass: "bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/30", label: "engagement" },
  reference: { pillClass: "bg-slate-500/15 text-slate-200 border border-slate-500/30", label: "reference" },
};

const FILE_TYPE_LABEL: Record<KnowledgeFile["fileType"], string> = {
  markdown: "markdown",
  "json-schema": "json schema",
  "adr-registry": "adr registry",
  glossary: "glossary",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export interface KnowledgeFileViewProps {
  readonly file: KnowledgeFile;
}

export function KnowledgeFileView({ file }: KnowledgeFileViewProps) {
  const folder = FOLDER_TONE[file.folder];
  return (
    <article
      aria-labelledby={`kf-${file.id}-title`}
      className="card space-y-4"
      data-testid="knowledge-file-view"
      data-folder={file.folder}
      data-file-type={file.fileType}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id={`kf-${file.id}-title`} className="text-2xl font-semibold text-forge-50">
            {file.title}
          </h2>
          <p className="font-mono text-xs text-forge-300">{file.path}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${folder.pillClass}`}
            aria-label={`Folder: ${folder.label}`}
            data-testid="knowledge-file-folder-pill"
          >
            {folder.label}
          </span>
          <span
            className="inline-flex items-center rounded-sm border border-forge-700/40 bg-forge-800/40 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-forge-200"
            aria-label={`File type: ${FILE_TYPE_LABEL[file.fileType]}`}
            data-testid="knowledge-file-type-pill"
          >
            {FILE_TYPE_LABEL[file.fileType]}
          </span>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wider text-forge-300">Size</dt>
          <dd className="font-mono text-forge-50" data-testid="knowledge-file-size">
            {formatBytes(file.byteSize)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-forge-300">Version</dt>
          <dd
            className="font-mono text-forge-50"
            aria-label={`sha256 prefix ${file.versionHash}`}
            data-testid="knowledge-file-hash"
          >
            {file.versionHash}
          </dd>
        </div>
        {file.updatedAt && (
          <div>
            <dt className="text-xs uppercase tracking-wider text-forge-300">Updated</dt>
            <dd className="text-forge-50">{file.updatedAt}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs uppercase tracking-wider text-forge-300">Stages</dt>
          <dd className="text-forge-50" data-testid="knowledge-file-stages">
            {file.injectionRoles.length === 0
              ? "glossary (always-injected)"
              : file.injectionRoles
                  .map((r) => `${r.stage}: ${r.role}`)
                  .join(", ")}
          </dd>
        </div>
      </dl>

      {file.content && (
        <section
          aria-labelledby={`kf-${file.id}-body`}
          className="rounded-md border border-forge-700/40 bg-forge-900/40 p-3"
          data-testid="knowledge-file-body"
        >
          <h3 id={`kf-${file.id}-body`} className="sr-only">
            File body
          </h3>
          <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-forge-100">
            {file.content}
          </pre>
        </section>
      )}
    </article>
  );
}
