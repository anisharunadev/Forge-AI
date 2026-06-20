/**
 * EpicCard — typed-artifact summary card for the Project Intelligence
 * list page (FORA-501, Plan 1 §3.4).
 *
 * Mirrors the typed-artifact render contract used by `ConnectorCard`
 * (FORA-578) so the card integrates with the rest of the forge
 * console's tailwind tokens.
 *
 * Renders:
 *   * Identifier + title.
 *   * Status badge.
 *   * Owner + sub-goal list.
 *   * Story count + success metric.
 *   * "Open" link to the per-epic detail page.
 */

import Link from "next/link";
import type { Epic } from "../../lib/intelligence/types";

const STATUS_LABEL: Record<Epic["status"], string> = {
  draft: "Draft",
  active: "Active",
  "at-risk": "At risk",
  done: "Done",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  Epic["status"],
  "neutral" | "primary" | "success" | "warn" | "danger"
> = {
  draft: "neutral",
  active: "primary",
  "at-risk": "warn",
  done: "success",
  cancelled: "danger",
};

export interface EpicCardProps {
  readonly epic: Epic;
  readonly storyCount: number;
  readonly isAudit?: boolean;
}

export function EpicCard({ epic, storyCount, isAudit }: EpicCardProps) {
  return (
    <li
      className="card space-y-3"
      data-testid="epic-row"
      data-epic-id={epic.id}
      data-epic-status={epic.status}
      data-audit={isAudit ? "true" : "false"}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-forge-300">{epic.identifier}</p>
          <h3 className="text-lg font-semibold" id={`epic-${epic.id}-h`}>
            {epic.title}
          </h3>
          <p className="text-sm text-forge-200">{epic.description}</p>
        </div>
        <span
          className={badgeTone(STATUS_TONE[epic.status])}
          data-testid="epic-status-badge"
          data-status={epic.status}
          aria-label={`Status: ${STATUS_LABEL[epic.status]}`}
        >
          {STATUS_LABEL[epic.status]}
        </span>
      </header>

      <dl
        className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
        aria-label="Epic summary"
      >
        <dt className="text-forge-300">Owner</dt>
        <dd
          className="font-mono text-forge-100"
          data-testid="epic-owner"
        >
          {epic.owner}
        </dd>
        <dt className="text-forge-300">Stories</dt>
        <dd
          className="font-mono text-forge-100"
          data-testid="epic-story-count"
        >
          {storyCount}
        </dd>
        <dt className="text-forge-300">Sub-goals</dt>
        <dd
          className="font-mono text-forge-100"
          data-testid="epic-subgoal-list"
        >
          {epic.subGoalList.length === 0 ? "—" : epic.subGoalList.join(", ")}
        </dd>
        <dt className="text-forge-300">Success metric</dt>
        <dd
          className="font-mono text-forge-100"
          data-testid="epic-success-metric"
        >
          {epic.successMetric}
        </dd>
      </dl>

      <footer className="flex items-center justify-between gap-3 border-t border-forge-800 pt-3 text-xs">
        <span className="text-forge-300" data-testid="epic-updated">
          updated {epic.updatedAt}
        </span>
        <Link
          href={`/project-intelligence/epics/${epic.id}`}
          className="rounded-sm border border-forge-700 bg-forge-800 px-3 py-1 font-medium text-forge-50 hover:border-forge-500"
          data-testid="epic-open"
          aria-label={`Open ${epic.identifier} epic`}
        >
          Open →
        </Link>
      </footer>
    </li>
  );
}

function badgeTone(tone: "neutral" | "primary" | "success" | "warn" | "danger"): string {
  const base =
    "inline-flex shrink-0 rounded-sm border px-2 py-0.5 text-xs font-medium uppercase tracking-wide";
  switch (tone) {
    case "neutral":
      return `${base} border-forge-700 bg-forge-800 text-forge-200`;
    case "primary":
      return `${base} border-sky-500/40 bg-sky-500/10 text-sky-200`;
    case "success":
      return `${base} border-emerald-500/40 bg-emerald-500/10 text-emerald-200`;
    case "warn":
      return `${base} border-amber-500/40 bg-amber-500/10 text-amber-200`;
    case "danger":
      return `${base} border-rose-500/40 bg-rose-500/10 text-rose-200`;
  }
}