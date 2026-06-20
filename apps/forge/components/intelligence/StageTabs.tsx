/**
 * StageTabs — the three stage tabs that surface "Stories in Dev",
 * "Stories in QA", and "Stories in DevOps" on the Project
 * Intelligence center landing page (Plan 1 §4 cross-reference matrix).
 *
 * Tabs are server-rendered with query-string state (`?stage=dev|qa|devops`)
 * so the page is bookmarkable and the back button works. The active
 * tab is announced via `aria-selected` and the tablist keyboard
 * contract (Plan 3 §5).
 */

import Link from "next/link";
import type { DrillDownStage } from "../../lib/intelligence/types";
import { DRILL_DOWN_STAGES } from "../../lib/intelligence/types";
import { StoryCard } from "./StoryCard";
import type { Story } from "../../lib/intelligence/types";

export interface StageTabsProps {
  readonly stories: ReadonlyArray<Story>;
  readonly active: DrillDownStage;
  readonly isAudit?: boolean;
}

const TAB_LABEL: Record<DrillDownStage, string> = {
  dev: "Stories in Dev",
  qa: "Stories in QA",
  devops: "Stories in DevOps",
};

const TAB_CENTER: Record<DrillDownStage, string> = {
  dev: "Development Center",
  qa: "Testing Center",
  devops: "Deployment Center",
};

export function StageTabs({ stories, active, isAudit }: StageTabsProps) {
  const filtered = stories.filter((s) => s.status === active);

  return (
    <section
      aria-labelledby="stage-tabs-h"
      className="space-y-4"
      data-testid="stage-tabs"
      data-active-stage={active}
    >
      <div className="flex items-baseline justify-between">
        <h2 id="stage-tabs-h" className="text-lg font-semibold">
          Active stories by stage
        </h2>
        <p className="text-xs text-forge-300" data-testid="stage-tabs-count">
          {filtered.length} in {TAB_LABEL[active]}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Stage tabs"
        className="flex gap-2 border-b border-forge-700"
        data-testid="stage-tabs-list"
      >
        {DRILL_DOWN_STAGES.map((stage) => {
          const isActive = stage === active;
          return (
            <Link
              key={stage}
              role="tab"
              aria-selected={isActive}
              aria-controls={`stage-panel-${stage}`}
              href={`/project-intelligence?stage=${stage}`}
              className={
                isActive
                  ? "border-b-2 border-sky-400 px-3 py-2 text-sm font-semibold text-white"
                  : "px-3 py-2 text-sm text-forge-200 hover:text-white"
              }
              data-testid="stage-tab"
              data-stage={stage}
              data-active={String(isActive) as "true" | "false"}
            >
              {TAB_LABEL[stage]}
            </Link>
          );
        })}
      </div>

      <div
        id={`stage-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`stage-tab-${active}`}
        data-testid="stage-tab-panel"
        data-stage={active}
        className="space-y-3"
      >
        <p
          className="text-xs text-forge-300"
          data-testid="stage-tab-drill-hint"
        >
          Drill-down reaches {TAB_CENTER[active]}.
        </p>
        {filtered.length === 0 ? (
          <p
            className="card text-sm text-forge-200"
            data-testid="stage-tab-empty"
            data-empty-kind="no-stories"
          >
            No stories in {TAB_LABEL[active]} right now.
          </p>
        ) : (
          <ul
            className="grid gap-3 md:grid-cols-2"
            aria-label={TAB_LABEL[active]}
            data-testid="stage-tab-list"
            data-story-count={filtered.length}
          >
            {filtered.map((s) => (
              <StoryCard key={s.id} story={s} isAudit={isAudit} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}