/**
 * StoryCard — typed-artifact card for a Story in the Project
 * Intelligence center (FORA-501, Plan 1 §3.4 + Plan 4 §3.4).
 *
 * Renders:
 *   * Identifier + title.
 *   * Status badge (backlog / dev / qa / security / devops / done).
 *   * Priority badge.
 *   * Owner.
 *   * BlockedBy + blocks (via `BlockedByList`).
 *   * Risk (if any).
 *   * "Open" link to the per-story detail page (handoff contracts).
 *   * "Open in center" link that drills into the right stage center
 *     (Development / Testing / Deployment — Plan 1 §4).
 */

import Link from "next/link";
import type { Story, DrillDownStage } from "../../lib/intelligence/types";
import { BlockedByList } from "./BlockedByList";

const STATUS_LABEL: Record<Story["status"], string> = {
  backlog: "Backlog",
  ideation: "Ideation",
  dev: "In Dev",
  qa: "In QA",
  security: "In Security",
  devops: "In DevOps",
  done: "Done",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<
  Story["status"],
  "neutral" | "primary" | "success" | "warn" | "danger"
> = {
  backlog: "neutral",
  ideation: "neutral",
  dev: "primary",
  qa: "primary",
  security: "warn",
  devops: "primary",
  done: "success",
  cancelled: "danger",
};

const PRIORITY_TONE: Record<
  Story["priority"],
  "neutral" | "primary" | "warn" | "danger"
> = {
  critical: "danger",
  high: "warn",
  medium: "primary",
  low: "neutral",
};

/** Map a Story to its drill-down target stage center (Plan 1 §4). */
function drillDownFor(story: Story): DrillDownStage | null {
  switch (story.status) {
    case "dev":
      return "dev";
    case "qa":
      return "qa";
    case "security":
    case "devops":
      return "devops";
    default:
      return null;
  }
}

function drillDownHref(story: Story): string | null {
  const stage = drillDownFor(story);
  if (!stage) return null;
  switch (stage) {
    case "dev":
      return `/development-center?story=${story.identifier}`;
    case "qa":
      return `/testing-center?story=${story.identifier}`;
    case "devops":
      return `/deployment-center?story=${story.identifier}`;
  }
}

function drillDownLabel(stage: DrillDownStage): string {
  switch (stage) {
    case "dev":
      return "Open in Development Center";
    case "qa":
      return "Open in Testing Center";
    case "devops":
      return "Open in Deployment Center";
  }
}

export interface StoryCardProps {
  readonly story: Story;
  readonly isAudit?: boolean;
}

export function StoryCard({ story, isAudit }: StoryCardProps) {
  const drillHref = drillDownHref(story);
  const drillLabel = drillDownFor(story)
    ? drillDownLabel(drillDownFor(story)!)
    : null;

  return (
    <li
      className="card space-y-3"
      data-testid="story-row"
      data-story-id={story.id}
      data-story-status={story.status}
      data-story-priority={story.priority}
      data-audit={isAudit ? "true" : "false"}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-forge-300">
            {story.identifier}
          </p>
          <h3 className="text-base font-semibold" id={`story-${story.id}-h`}>
            {story.title}
          </h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={badgeTone(STATUS_TONE[story.status])}
            data-testid="story-status-badge"
            data-status={story.status}
            aria-label={`Status: ${STATUS_LABEL[story.status]}`}
          >
            {STATUS_LABEL[story.status]}
          </span>
          <span
            className={badgeTone(PRIORITY_TONE[story.priority])}
            data-testid="story-priority-badge"
            data-priority={story.priority}
            aria-label={`Priority: ${story.priority}`}
          >
            {story.priority}
          </span>
        </div>
      </header>

      <BlockedByList
        blockedBy={story.blockedBy}
        blocks={story.blocks}
        variant="inline"
      />

      {story.risk && (
        <p
          className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
          data-testid="story-risk"
        >
          <span className="font-semibold">Risk:</span> {story.risk}
        </p>
      )}

      <footer className="flex items-center justify-between gap-3 border-t border-forge-800 pt-3 text-xs">
        <span className="text-forge-300">
          Owner: <span className="font-mono text-forge-100">{story.owner}</span>
        </span>
        <div className="flex items-center gap-2">
          {drillHref && drillLabel ? (
            <Link
              href={drillHref}
              className="rounded-sm border border-forge-700 bg-forge-800 px-3 py-1 font-medium text-forge-50 hover:border-forge-500"
              data-testid="story-drill-down"
              data-drill-target={drillDownFor(story)}
              aria-label={`${drillLabel} for ${story.identifier}`}
            >
              {drillLabel} →
            </Link>
          ) : null}
          <Link
            href={`/stories/${story.id}`}
            className="rounded-sm border border-forge-700 bg-forge-800 px-3 py-1 font-medium text-forge-50 hover:border-forge-500"
            data-testid="story-open"
            aria-label={`Open ${story.identifier} story`}
          >
            Open →
          </Link>
        </div>
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