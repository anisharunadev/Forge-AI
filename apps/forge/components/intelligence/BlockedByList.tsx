/**
 * BlockedByList — the blockedBy + blocks visualization for the
 * Project Intelligence center (FORA-501 §5). Mirrors the Paperclip
 * issue shape: every task has a `blockedBy` array and a `blocks`
 * array; this component renders both side-by-side so a PM can see at
 * a glance "X is blocked by Y" and "X blocks Z".
 *
 * The component is keyboard- and screen-reader-navigable per Plan 3 §5.
 *
 * The `resolveIdentifier` prop lets callers turn an internal id into
 * a human-readable identifier (e.g. `FORA-501.list`). The mock-data
 * loader exposes the same resolution; pages should pass the loader
 * resolver so the chips show the identifier, not the raw id.
 */

import Link from "next/link";
import type { ProjectIntelligenceId } from "../../lib/intelligence/types";

export interface BlockedByListProps {
  readonly blockedBy: ReadonlyArray<ProjectIntelligenceId>;
  readonly blocks: ReadonlyArray<ProjectIntelligenceId>;
  /**
   * `inline` — single line per side, used inside cards.
   * `panel` — full side panel surface, used on detail pages.
   */
  readonly variant?: "inline" | "panel";
  /**
   * Resolves an internal id to a human-readable identifier for the
   * chip label. Defaults to identity (renders the raw id).
   */
  readonly resolveIdentifier?: (id: ProjectIntelligenceId) => string;
}

export function BlockedByList({
  blockedBy,
  blocks,
  variant = "inline",
  resolveIdentifier,
}: BlockedByListProps) {
  const resolve = resolveIdentifier ?? ((id: string) => id);

  return (
    <div
      data-testid="blocked-by-list"
      data-blocked-count={blockedBy.length}
      data-blocks-count={blocks.length}
      className={
        variant === "panel"
          ? "grid gap-3 sm:grid-cols-2"
          : "flex flex-col gap-1"
      }
    >
      <div
        className="flex flex-wrap items-center gap-2 text-xs"
        aria-label="Blocked by"
      >
        <span className="text-forge-300">Blocked by:</span>
        {blockedBy.length === 0 ? (
          <span
            className="rounded-sm border border-forge-700 bg-forge-800 px-2 py-0.5 font-mono text-forge-300"
            data-testid="blocked-by-empty"
          >
            none
          </span>
        ) : (
          blockedBy.map((id) => (
            <Link
              key={`bb-${id}`}
              href={`/project-intelligence/stories/${id}`}
              className="rounded-sm border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-mono text-rose-200 hover:border-rose-500/70"
              data-testid="blocked-by-chip"
              data-blocked-id={id}
              aria-label={`Blocked by ${resolve(id)}`}
            >
              {resolve(id)}
            </Link>
          ))
        )}
      </div>
      <div
        className="flex flex-wrap items-center gap-2 text-xs"
        aria-label="Blocks"
      >
        <span className="text-forge-300">Blocks:</span>
        {blocks.length === 0 ? (
          <span
            className="rounded-sm border border-forge-700 bg-forge-800 px-2 py-0.5 font-mono text-forge-300"
            data-testid="blocks-empty"
          >
            none
          </span>
        ) : (
          blocks.map((id) => (
            <Link
              key={`bx-${id}`}
              href={`/project-intelligence/stories/${id}`}
              className="rounded-sm border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-mono text-sky-200 hover:border-sky-500/70"
              data-testid="blocks-chip"
              data-block-id={id}
              aria-label={`Blocks ${resolve(id)}`}
            >
              {resolve(id)}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}