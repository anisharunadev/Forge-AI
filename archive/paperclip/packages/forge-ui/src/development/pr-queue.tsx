/**
 * PrQueue — Plan 1 §3.7 acceptance criterion #3.
 *
 * PR queue using the `PrReviewRecord` shape (distinct from `Patch` /
 * `TaskArtifact`). The compact-list-row variant per Plan 4 §3.4 carries
 * the row metadata: PR number, title, state, review state, file stats,
 * story id. Selecting a row emits a `onOpenPr` event with the record.
 */

import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { PrReviewRecord } from "./development";

const STATE_TONE: Record<PrReviewRecord["state"], "primary" | "success" | "danger" | "neutral"> = {
  open: "primary",
  merged: "success",
  closed: "danger",
  draft: "neutral",
};

const REVIEW_TONE: Record<PrReviewRecord["reviewState"], "primary" | "success" | "warn" | "danger"> = {
  pending: "warn",
  approved: "success",
  "changes-requested": "danger",
  commented: "primary",
};

export interface PrQueueProps {
  readonly records: ReadonlyArray<PrReviewRecord>;
  readonly onOpenPr?: (record: PrReviewRecord) => void;
  readonly className?: string;
}

export function PrQueue({ records, onOpenPr, className }: PrQueueProps): JSX.Element {
  if (records.length === 0) {
    return (
      <div
        role="status"
        data-testid="pr-queue-empty"
        className={cn(
          "rounded-md border border-surface-border bg-surface-raised px-4 py-6 text-center text-body-sm text-ink-muted",
          className,
        )}
      >
        No open PRs. The review queue is clear.
      </div>
    );
  }
  return (
    <ul
      aria-label="PR queue"
      data-testid="pr-queue"
      className={cn("divide-y divide-surface-border rounded-md border border-surface-border bg-surface", className)}
    >
      {records.map((r) => (
        <li
          key={r.id}
          data-testid={`pr-queue-row-${r.prNumber}`}
          className="flex items-center justify-between gap-3 px-3 py-2"
        >
          <button
            type="button"
            onClick={() => onOpenPr?.(r)}
            aria-label={`Open PR ${r.prNumber}: ${r.title}`}
            className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <p className="truncate text-body-sm font-medium text-ink-default">
              <span className="font-mono text-ink-muted mr-2">PR-{r.prNumber}</span>
              {r.title}
            </p>
            <p className="text-caption text-ink-subtle">
              {r.author.displayName}
              {r.storyId && <> · {r.storyId}</>}
              {" · "}
              <span className="font-mono text-brand-success">+{r.linesAdded}</span>
              {" "}
              <span className="font-mono text-brand-danger">−{r.linesDeleted}</span>
              {" · "}
              {r.filesChanged} files
            </p>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={STATE_TONE[r.state]}>{r.state}</Badge>
            <Badge tone={REVIEW_TONE[r.reviewState]}>{r.reviewState}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
