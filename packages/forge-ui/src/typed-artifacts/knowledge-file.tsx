import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, KnowledgeFile, KnowledgeFolder } from "./types";

/**
 * Plan 2 §3.1 — folder drives the colour token:
 *   memory       → indigo (--brand-primary)
 *   customer     → amber  (--brand-warn)
 *   project      → emerald (--brand-success)
 *   engagements  → accent  (--brand-accent)
 *   reference    → neutral
 *
 * Colour is always paired with the folder label and an `aria-label`
 * (Plan 3 §5.1 — color is never the only signal, per WCAG 1.4.1).
 */
const FOLDER_TONE: Record<
  KnowledgeFolder,
  { tone: "primary" | "warn" | "success" | "accent" | "neutral"; label: string }
> = {
  memory: { tone: "primary", label: "memory" },
  customer: { tone: "warn", label: "customer" },
  project: { tone: "success", label: "project" },
  engagements: { tone: "accent", label: "engagement" },
  reference: { tone: "neutral", label: "reference" },
};

/**
 * The file-type badge — names how the File Viewer should render the
 * body. `glossary` files render as a structured dictionary; the
 * Knowledge Center treats them as a specialisation of `markdown`.
 */
const FILE_TYPE_LABEL: Record<KnowledgeFile["fileType"], string> = {
  markdown: "markdown",
  "json-schema": "json schema",
  "adr-registry": "adr registry",
  glossary: "glossary",
};

/**
 * KnowledgeFileRenderer — Plan 1 §3.3 typed-artifact surface.
 *
 * Variants:
 *   - `card`           — summary card (default). Path + folder + type + size.
 *   - `panel`          — full side-panel viewer. Adds the file body when
 *                        `artifact.content` is present, otherwise the
 *                        metadata table only.
 *   - `injection-list` — compact list-row used by the "what does each
 *                        agent see?" panel; renders the per-stage
 *                        injection roles inline.
 *
 * The renderer is read-only. v1.1 will add the "request glossary PR"
 * affordance behind RBAC (gated by the Governance Center token).
 *
 * Accessibility: every interactive element has an accessible name; the
 * body section uses `aria-labelledby` to point back to the title.
 */
export function KnowledgeFileRenderer({
  artifact,
  variant = "card",
  className,
}: BaseRendererProps<KnowledgeFile>): JSX.Element {
  const folder = FOLDER_TONE[artifact.folder];

  if (variant === "injection-list") {
    return <InjectionListRow artifact={artifact} {...(className !== undefined ? { className } : {})} />;
  }

  if (variant === "panel") {
    return (
      <article
        aria-labelledby={`kf-${artifact.id}-title`}
        className={cn(
          "w-full space-y-3 rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
          className,
        )}
        data-testid="knowledge-file-panel"
        data-folder={artifact.folder}
        data-file-type={artifact.fileType}
      >
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <h3
              id={`kf-${artifact.id}-title`}
              className="text-heading-3 font-semibold text-ink-default"
            >
              {artifact.title}
            </h3>
            <p className="text-caption text-ink-muted">
              <code className="font-mono text-body-sm">{artifact.path}</code>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={folder.tone} aria-label={`Folder: ${folder.label}`}>
              {folder.label}
            </Badge>
            <Badge tone="neutral" aria-label={`File type: ${FILE_TYPE_LABEL[artifact.fileType]}`}>
              {FILE_TYPE_LABEL[artifact.fileType]}
            </Badge>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-body-sm sm:grid-cols-4">
          <div>
            <dt className="text-ink-muted">Size</dt>
            <dd className="font-mono text-ink-default">{formatBytes(artifact.byteSize)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Version</dt>
            <dd className="font-mono text-ink-default" aria-label={`sha256 prefix ${artifact.versionHash}`}>
              {artifact.versionHash}
            </dd>
          </div>
          {artifact.updatedAt && (
            <div>
              <dt className="text-ink-muted">Updated</dt>
              <dd className="text-ink-default">{artifact.updatedAt}</dd>
            </div>
          )}
          <div>
            <dt className="text-ink-muted">Stages</dt>
            <dd className="text-ink-default">
              {artifact.injectionRoles.length === 0
                ? "—"
                : artifact.injectionRoles.map((r) => r.stage).join(", ")}
            </dd>
          </div>
        </dl>

        {artifact.content && (
          <section
            aria-labelledby={`kf-${artifact.id}-body`}
            className="rounded-md border border-surface-border bg-surface-raised p-3"
          >
            <h4 id={`kf-${artifact.id}-body`} className="sr-only">
              File body
            </h4>
            <pre className="whitespace-pre-wrap break-words font-mono text-body-sm text-ink-default">
              {artifact.content}
            </pre>
          </section>
        )}
      </article>
    );
  }

  // card (default)
  return (
    <article
      aria-labelledby={`kf-${artifact.id}-title`}
      className={cn(
        "max-w-prose space-y-2 rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        className,
      )}
      data-testid="knowledge-file-card"
      data-folder={artifact.folder}
      data-file-type={artifact.fileType}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3
          id={`kf-${artifact.id}-title`}
          className="text-heading-3 font-semibold text-ink-default"
        >
          {artifact.title}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={folder.tone} aria-label={`Folder: ${folder.label}`}>
            {folder.label}
          </Badge>
          <Badge tone="neutral" aria-label={`File type: ${FILE_TYPE_LABEL[artifact.fileType]}`}>
            {FILE_TYPE_LABEL[artifact.fileType]}
          </Badge>
        </div>
      </header>
      <p className="font-mono text-caption text-ink-muted">{artifact.path}</p>
      <p className="text-body-sm text-ink-muted">
        {formatBytes(artifact.byteSize)} · sha {artifact.versionHash} ·{" "}
        {artifact.injectionRoles.length} stage
        {artifact.injectionRoles.length === 1 ? "" : "s"}
      </p>
    </article>
  );
}

function InjectionListRow({
  artifact,
  className,
}: {
  artifact: KnowledgeFile;
  className?: string;
}): JSX.Element {
  return (
    <li
      data-testid="knowledge-file-injection-row"
      data-folder={artifact.folder}
      className={cn(
        "flex items-center justify-between gap-3 rounded-sm border border-surface-border bg-surface-raised px-3 py-2",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-body-sm text-ink-default">{artifact.path}</p>
        <p className="text-caption text-ink-muted">
          {artifact.injectionRoles.length === 0
            ? "no stage injection"
            : artifact.injectionRoles
                .map((r) => `${r.stage}: ${r.role}`)
                .join(" · ")}
        </p>
      </div>
      <Badge
        tone={FOLDER_TONE[artifact.folder].tone}
        aria-label={`Folder: ${FOLDER_TONE[artifact.folder].label}`}
      >
        {FOLDER_TONE[artifact.folder].label}
      </Badge>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
