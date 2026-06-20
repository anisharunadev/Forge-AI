/**
 * RequirementBriefCard — typed-artifact card for a Requirement Brief
 * (FORA-501, Plan 1 §3.4, Plan 4 §3.1).
 *
 * Renders:
 *   * Schema-version badge (`schema_version: "1.0"`, FORA-501 AC #2).
 *   * Title + source.
 *   * Section count + open-question count.
 *   * "View brief" link to the detail page (full DraftPrd render).
 */

import Link from "next/link";
import type { RequirementBrief } from "../../lib/intelligence/types";

export interface RequirementBriefCardProps {
  readonly brief: RequirementBrief;
}

export function RequirementBriefCard({ brief }: RequirementBriefCardProps) {
  const openQuestionCount = brief.sections.reduce(
    (acc, s) => acc + (s.openQuestions?.length ?? 0),
    0,
  );

  return (
    <article
      className="card space-y-3"
      data-testid="requirement-brief"
      data-brief-id={brief.id}
      data-schema-version={brief.schema_version}
      aria-labelledby={`rb-${brief.id}-h`}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-forge-300">{brief.id}</p>
          <h3 className="text-lg font-semibold" id={`rb-${brief.id}-h`}>
            {brief.title}
          </h3>
          <p className="text-sm text-forge-200">{brief.source}</p>
        </div>
        <span
          className="inline-flex shrink-0 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-emerald-200"
          data-testid="requirement-brief-schema-version"
          data-version={brief.schema_version}
          aria-label={`Schema version ${brief.schema_version}`}
        >
          schema v{brief.schema_version}
        </span>
      </header>

      <dl
        className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
        aria-label="Brief summary"
      >
        <dt className="text-forge-300">Sections</dt>
        <dd
          className="font-mono text-forge-100"
          data-testid="requirement-brief-section-count"
        >
          {brief.sections.length}
        </dd>
        <dt className="text-forge-300">Open questions</dt>
        <dd
          className="font-mono text-forge-100"
          data-testid="requirement-brief-open-question-count"
        >
          {openQuestionCount}
        </dd>
        <dt className="text-forge-300">Updated</dt>
        <dd className="font-mono text-forge-100">{brief.updatedAt}</dd>
      </dl>

      <footer className="flex items-center justify-end gap-3 border-t border-forge-800 pt-3 text-xs">
        <Link
          href={`/project-intelligence/epics/${brief.epicId}#brief`}
          className="rounded-sm border border-forge-700 bg-forge-800 px-3 py-1 font-medium text-forge-50 hover:border-forge-500"
          data-testid="requirement-brief-open"
          aria-label={`Open ${brief.title}`}
        >
          View brief →
        </Link>
      </footer>
    </article>
  );
}