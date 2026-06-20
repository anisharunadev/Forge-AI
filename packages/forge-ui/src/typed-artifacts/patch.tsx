import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { BaseRendererProps, Patch } from "./types";

const PR_REVIEW_TONE: Record<
  NonNullable<NonNullable<Patch["linkedPrs"]>[number]["reviewState"]>,
  "neutral" | "primary" | "success" | "warn" | "danger"
> = {
  pending: "neutral",
  approved: "success",
  "changes-requested": "danger",
  commented: "primary",
};

const PR_STATE_TONE: Record<NonNullable<Patch["linkedPrs"]>[number]["state"], "neutral" | "primary" | "success" | "danger"> = {
  open: "primary",
  merged: "success",
  closed: "danger",
  draft: "neutral",
};

/**
 * PatchRenderer — Plan 4 §3.5. Variants: summary | diff | panel | pr-link.
 * Renders a code change set with additions/deletions, file-level diff hunks,
 * the linked PR review state, and the test files the patch exercises.
 */
export function PatchRenderer({
  artifact,
  variant = "summary",
  className,
}: BaseRendererProps<Patch>) {
  if (variant === "pr-link") {
    return (
      <ul aria-label={`PRs for ${artifact.title}`} className={cn("flex flex-wrap gap-2", className)}>
        {(artifact.linkedPrs ?? []).map((pr) => (
          <li key={pr.id}>
            <a
              href={pr.url}
              className="inline-flex items-center gap-2 rounded-sm border border-surface-border bg-surface-raised px-2 py-1 text-body-sm text-ink-default hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Badge tone={PR_STATE_TONE[pr.state]}>{pr.state}</Badge>
              <span className="font-mono">PR-{pr.id}</span>
              {pr.reviewState && <Badge tone={PR_REVIEW_TONE[pr.reviewState]}>{pr.reviewState}</Badge>}
            </a>
          </li>
        ))}
        {(artifact.linkedPrs ?? []).length === 0 && (
          <li className="text-body-sm text-ink-subtle">No linked PRs.</li>
        )}
      </ul>
    );
  }

  return (
    <article
      aria-labelledby={`patch-${artifact.id}-title`}
      className={cn(
        "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 id={`patch-${artifact.id}-title`} className="text-heading-3 font-semibold text-ink-default">
          {artifact.title}
        </h3>
        <div className="flex shrink-0 items-center gap-2 text-caption font-mono">
          <span className="text-brand-success" aria-label={`${artifact.additions} additions`}>
            +{artifact.additions}
          </span>
          <span className="text-brand-danger" aria-label={`${artifact.deletions} deletions`}>
            −{artifact.deletions}
          </span>
          <Badge tone="neutral">{artifact.filesChanged} files</Badge>
        </div>
      </header>

      {artifact.summary && variant !== "diff" && (
        <p className="mt-2 text-body-sm text-ink-muted">{artifact.summary}</p>
      )}

      {variant !== "summary" && artifact.files && (
        <ul aria-label="Diff" className="mt-4 space-y-3">
          {artifact.files.map((f) => (
            <li key={f.path} className="rounded-md border border-surface-border bg-surface-raised">
              <p className="border-b border-surface-border px-3 py-2 font-mono text-body-sm text-ink-default">
                {f.path}{" "}
                <span className="ml-2 text-caption">
                  <span className="text-brand-success">+{f.additions}</span>{" "}
                  <span className="text-brand-danger">−{f.deletions}</span>
                </span>
              </p>
              {(f.hunks ?? []).length > 0 && (
                <pre className="overflow-x-auto px-3 py-2 font-mono text-caption text-ink-default" aria-label={`Hunks for ${f.path}`}>
                  {f.hunks!.map((h, i) => (
                    <span
                      key={i}
                      className={cn(
                        "block whitespace-pre",
                        h.kind === "addition" && "bg-brand-success/10 text-brand-success",
                        h.kind === "deletion" && "bg-brand-danger/10 text-brand-danger",
                      )}
                    >
                      {h.kind === "addition" ? "+ " : h.kind === "deletion" ? "- " : "  "}
                      {h.text}
                    </span>
                  ))}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}

      {artifact.testFilesExercised && artifact.testFilesExercised.length > 0 && (
        <section className="mt-3" aria-label="Tests exercised by this patch">
          <h4 className="text-body-sm font-medium text-ink-muted">Tests exercised</h4>
          <ul className="mt-1 flex flex-wrap gap-1 font-mono text-caption">
            {artifact.testFilesExercised.map((t) => (
              <li key={t} className="rounded-sm border border-surface-border bg-surface-raised px-2 py-0.5">
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(artifact.linkedPrs ?? []).length > 0 && (
        <section className="mt-3" aria-label="Linked pull requests">
          <h4 className="text-body-sm font-medium text-ink-muted">Pull requests</h4>
          <ul className="mt-1 flex flex-wrap gap-2">
            {artifact.linkedPrs!.map((pr) => (
              <li key={pr.id}>
                <a
                  href={pr.url}
                  className="inline-flex items-center gap-1 rounded-sm border border-surface-border bg-surface-raised px-2 py-1 text-body-sm hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Badge tone={PR_STATE_TONE[pr.state]}>{pr.state}</Badge>
                  <span className="font-mono">PR-{pr.id}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
