/**
 * AdrList — Plan 1 §3.7 acceptance criterion #1.
 *
 * ADR list reads from `workspace/project/adr-registry.md` (registry entries
 * are passed in as props; the registry is parsed upstream). Two variants:
 *
 *   - `compact` — single-line row, used in the right-rail of the composer
 *   - `detail` — full panel with context / decision / consequences chain
 *
 * Each row carries a "Show in graph" affordance (Plan 1 §3.7 #9) wired
 * through the `onNavigate` callback.
 */

import type { JSX } from "react";
import { useMemo } from "react";
import { Badge } from "../primitives/badge";
import { cn } from "../tokens/cn";
import type { AdrRegistryEntry, AdrListVariant, GraphTarget } from "./development";
import { ShowInGraph } from "./show-in-graph";

const STATUS_TONE: Record<AdrRegistryEntry["status"], "primary" | "success" | "warn" | "neutral"> = {
  proposed: "primary",
  accepted: "success",
  superseded: "warn",
  deprecated: "neutral",
};

export interface AdrListProps {
  readonly entries: ReadonlyArray<AdrRegistryEntry>;
  readonly variant?: AdrListVariant;
  readonly onNavigate?: (target: GraphTarget) => void;
  /** Cap the rendered list. `undefined` = no cap. */
  readonly maxRows?: number;
  readonly className?: string;
}

export function AdrList({
  entries,
  variant = "compact",
  onNavigate,
  maxRows,
  className,
}: AdrListProps): JSX.Element {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.number < b.number ? 1 : a.number > b.number ? -1 : 0)),
    [entries],
  );
  const visible = typeof maxRows === "number" ? sorted.slice(0, maxRows) : sorted;

  if (visible.length === 0) {
    return (
      <div
        role="status"
        data-testid="adr-list-empty"
        className={cn(
          "rounded-md border border-surface-border bg-surface-raised px-4 py-6 text-center text-body-sm text-ink-muted",
          className,
        )}
      >
        No ADRs match the current filter.
      </div>
    );
  }

  return (
    <ul
      aria-label={`ADR list (${variant})`}
      data-testid={`adr-list-${variant}`}
      className={cn("space-y-2", className)}
    >
      {visible.map((entry) =>
        variant === "compact" ? (
          <li key={entry.number}>
            <CompactRow entry={entry} {...(onNavigate ? { onNavigate } : {})} />
          </li>
        ) : (
          <li key={entry.number}>
            <DetailRow entry={entry} {...(onNavigate ? { onNavigate } : {})} />
          </li>
        ),
      )}
      {typeof maxRows === "number" && sorted.length > maxRows && (
        <li className="text-caption text-ink-subtle">
          Showing {maxRows} of {sorted.length}.
        </li>
      )}
    </ul>
  );
}

function CompactRow({
  entry,
  onNavigate,
}: {
  entry: AdrRegistryEntry;
  onNavigate?: (target: GraphTarget) => void;
}): JSX.Element {
  return (
    <div
      data-testid={`adr-compact-${entry.number}`}
      className="flex items-center justify-between gap-3 rounded-md border border-surface-border bg-surface px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-medium text-ink-default">
          <span className="font-mono text-ink-muted mr-2">ADR-{entry.number}</span>
          {entry.title}
        </p>
        <p className="text-caption text-ink-subtle">
          {entry.architectureArea} · {entry.date}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={STATUS_TONE[entry.status]}>{entry.status}</Badge>
        {onNavigate && (
          <ShowInGraph
            target={{ canvas: "architecture", nodeId: `adr-${entry.number}` }}
            onNavigate={onNavigate}
            label="Show"
          />
        )}
      </div>
    </div>
  );
}

function DetailRow({
  entry,
  onNavigate,
}: {
  entry: AdrRegistryEntry;
  onNavigate?: (target: GraphTarget) => void;
}): JSX.Element {
  return (
    <article
      aria-labelledby={`adr-detail-${entry.number}-title`}
      data-testid={`adr-detail-${entry.number}`}
      className="rounded-md border border-surface-border bg-surface p-4 shadow-elev-1"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3
            id={`adr-detail-${entry.number}-title`}
            className="text-heading-3 font-semibold text-ink-default"
          >
            <span className="font-mono text-body-sm text-ink-muted mr-2">
              ADR-{entry.number}
            </span>
            {entry.title}
          </h3>
          <p className="text-caption text-ink-subtle">
            {entry.architectureArea} · decided {entry.date}
            {entry.supersedes && <> · supersedes ADR-{entry.supersedes}</>}
            {entry.supersededBy && <> · superseded by ADR-{entry.supersededBy}</>}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={STATUS_TONE[entry.status]}>{entry.status}</Badge>
          {onNavigate && (
            <ShowInGraph
              target={{ canvas: "architecture", nodeId: `adr-${entry.number}` }}
              onNavigate={onNavigate}
            />
          )}
        </div>
      </header>

      {entry.tags && entry.tags.length > 0 && (
        <ul aria-label="tags" className="mt-3 flex flex-wrap gap-1">
          {entry.tags.map((t) => (
            <li key={t}>
              <Badge tone="neutral">{t}</Badge>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
