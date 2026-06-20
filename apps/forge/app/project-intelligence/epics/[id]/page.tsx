/**
 * Project Intelligence — Epic detail (FORA-501, Plan 1 §3.4).
 *
 * Drill-down target from the list page. Renders the epic card, its
 * requirement brief, its draft PRD, and the list of stories in the
 * epic. Every story card links to its own detail page.
 */

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getEpic,
  getRequirementBrief,
  getDraftPrd,
  listStoriesForEpic,
  SEED_TENANT_ID,
} from "@/lib/intelligence/mock-data";
import {
  canAccessProjectIntelligence,
  isAuditPersona,
  type ProjectIntelligencePersona,
} from "@/lib/intelligence/rbac";
import { readPersonaFromCookieHeader } from "@/lib/auth";
import { EpicCard } from "@/components/intelligence/EpicCard";
import { StoryCard } from "@/components/intelligence/StoryCard";
import { RequirementBriefCard } from "@/components/intelligence/RequirementBriefCard";
import { DraftPrdView } from "@/components/intelligence/DraftPrdView";

export const dynamic = "force-dynamic";

export default async function EpicDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const persona: ProjectIntelligencePersona = readPersonaFromCookieHeader(
    cookieHeader,
  );

  if (!canAccessProjectIntelligence(persona)) notFound();

  const { id } = await params;
  const epic = getEpic(id);
  if (!epic) notFound();
  const audit = isAuditPersona(persona);

  const brief = epic.requirementBriefId
    ? getRequirementBrief(epic.requirementBriefId)
    : null;
  const prd = epic.draftPrdId ? getDraftPrd(epic.draftPrdId) : null;
  const stories = listStoriesForEpic(epic.id);

  return (
    <div className="space-y-8" data-testid="epic-detail">
      <nav className="text-xs text-forge-300" aria-label="Breadcrumb">
        <a
          href="/project-intelligence"
          className="hover:text-forge-100"
          data-testid="epic-detail-back"
        >
          ← Project Intelligence
        </a>
      </nav>

      <EpicCard epic={epic} storyCount={stories.length} isAudit={audit} />

      {brief ? (
        <section
          id="brief"
          aria-labelledby="brief-h"
          className="space-y-3"
          data-testid="epic-detail-brief"
        >
          <h2 id="brief-h" className="text-lg font-semibold">
            Requirement brief
          </h2>
          <RequirementBriefCard brief={brief} />
        </section>
      ) : null}

      {prd ? (
        <section
          id="prd"
          aria-labelledby="prd-h"
          className="space-y-3"
          data-testid="epic-detail-prd"
        >
          <h2 id="prd-h" className="text-lg font-semibold">
            Draft PRD
          </h2>
          <DraftPrdView prd={prd} />
        </section>
      ) : null}

      <section
        aria-labelledby="epic-stories-h"
        className="space-y-3"
        data-testid="epic-detail-stories"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="epic-stories-h" className="text-lg font-semibold">
            Stories
          </h2>
          <p className="text-xs text-forge-300">
            tenant <span className="font-mono">{SEED_TENANT_ID}</span> ·{" "}
            {stories.length} stor{stories.length === 1 ? "y" : "ies"}
          </p>
        </div>
        <ul
          className="grid gap-3 md:grid-cols-2"
          aria-label="Stories in this epic"
          data-testid="epic-detail-story-list"
          data-story-count={stories.length}
        >
          {stories.map((s) => (
            <StoryCard key={s.id} story={s} isAudit={audit} />
          ))}
        </ul>
      </section>
    </div>
  );
}