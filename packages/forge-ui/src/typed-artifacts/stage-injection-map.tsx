import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, KnowledgeFile, StageInjectionMap } from "./types";

/**
 * StageInjectionMapRenderer — Plan 1 §3.3 typed-artifact surface.
 *
 * Renders one row of the workspace/README.md §2 injection model:
 * which Knowledge Layer files a given sub-agent stage receives.
 *
 * Variants:
 *   - `panel`   (default) — full side-panel view: the stage label,
 *                         the file list (with `KnowledgeFileRenderer`
 *                         `injection-list` rows), the always-injected
 *                         glossary row, and the co-owner sub-agent
 *                         role.
 *   - `list`              — compact list-row used by the
 *                         "what does each agent see?" panel tab list.
 *
 * v1.0 is read-only. The "swap file for stage" affordance is a v1.1
 * conversation (Plan 1 §5.2 — v1.0 is read-only, v1.1 is the writer
 * surface).
 */
export interface StageInjectionMapRendererProps
  extends BaseRendererProps<StageInjectionMap> {
  /**
   * The KnowledgeFile records referenced by `fileIds` and
   * `glossaryFileIds`. The renderer composes the file rows from
   * these so the panel can render without a follow-up fetch.
   */
  readonly files: ReadonlyArray<KnowledgeFile>;
}

export function StageInjectionMapRenderer({
  artifact,
  variant = "panel",
  files,
  className,
}: StageInjectionMapRendererProps): JSX.Element {
  const fileById = new Map(files.map((f) => [f.id, f]));
  const fileRows = artifact.fileIds
    .map((id) => fileById.get(id))
    .filter((f): f is KnowledgeFile => Boolean(f));
  const glossaryRows = artifact.glossaryFileIds
    .map((id) => fileById.get(id))
    .filter((f): f is KnowledgeFile => Boolean(f));

  if (variant === "row") {
    return (
      <li
        data-testid="stage-injection-row"
        data-stage={artifact.stage}
        className={cn(
          "flex items-center justify-between gap-3 rounded-sm border border-surface-border bg-surface-raised px-3 py-2",
          className,
        )}
      >
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-ink-default">{artifact.stage}</p>
          <p className="text-caption text-ink-muted">
            {fileRows.length} file{fileRows.length === 1 ? "" : "s"}
            {glossaryRows.length > 0 && ` · +glossary`}
            {artifact.ownerRole && ` · owner: ${artifact.ownerRole}`}
          </p>
        </div>
        <Badge tone="primary" aria-label={`${fileRows.length} file${fileRows.length === 1 ? "" : "s"} injected`}>
          {fileRows.length + glossaryRows.length}
        </Badge>
      </li>
    );
  }

  return (
    <article
      aria-labelledby={`sim-${artifact.id}-stage`}
      className={cn(
        "w-full space-y-3 rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        className,
      )}
      data-testid="stage-injection-panel"
      data-stage={artifact.stage}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h3
            id={`sim-${artifact.id}-stage`}
            className="text-heading-3 font-semibold text-ink-default"
          >
            {artifact.stage}
          </h3>
          {artifact.ownerRole && (
            <p className="text-caption text-ink-muted">Co-owner: {artifact.ownerRole}</p>
          )}
        </div>
        <Badge tone="primary" aria-label={`${fileRows.length} files injected`}>
          {fileRows.length + glossaryRows.length} files
        </Badge>
      </header>

      {fileRows.length > 0 && (
        <section aria-labelledby={`sim-${artifact.id}-files`} className="space-y-2">
          <h4
            id={`sim-${artifact.id}-files`}
            className="text-caption font-medium uppercase tracking-wide text-ink-muted"
          >
            Injected files
          </h4>
          <ul className="space-y-1.5">
            {fileRows.map((f) => (
              <KnowledgeFileRow key={f.id} file={f} />
            ))}
          </ul>
        </section>
      )}

      {glossaryRows.length > 0 && (
        <section aria-labelledby={`sim-${artifact.id}-glossary`} className="space-y-2">
          <h4
            id={`sim-${artifact.id}-glossary`}
            className="text-caption font-medium uppercase tracking-wide text-ink-muted"
          >
            Always-injected glossary
          </h4>
          <ul className="space-y-1.5">
            {glossaryRows.map((f) => (
              <KnowledgeFileRow key={f.id} file={f} />
            ))}
          </ul>
        </section>
      )}

      {fileRows.length === 0 && glossaryRows.length === 0 && (
        <p className="text-body-sm text-ink-muted">
          No files are injected for this stage. Per workspace/README.md §2, every
          stage should at minimum receive the glossary.
        </p>
      )}
    </article>
  );
}

function KnowledgeFileRow({ file }: { file: KnowledgeFile }): JSX.Element {
  return (
    <li
      data-testid="stage-injection-file-row"
      data-folder={file.folder}
      className="flex items-center justify-between gap-3 rounded-sm border border-surface-border bg-surface-raised px-3 py-2"
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-body-sm text-ink-default">{file.path}</p>
        <p className="text-caption text-ink-muted">{file.title}</p>
      </div>
    </li>
  );
}
