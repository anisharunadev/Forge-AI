/**
 * Project Intelligence — Story detail (FORA-501, Plan 1 §3.4).
 *
 * Drill-down target from the list page and from the StageTabs card.
 * Renders the story card, the BlockedByList panel, every handoff
 * contract bound to the story, and the drill-down CTA into the right
 * stage center (Development / Testing / Deployment).
 */

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getHandoffContract,
  getStory,
  listHandoffContracts,
  listEpics,
  listStories,
  resolveIdentifier,
  SEED_TENANT_ID,
} from "@/lib/intelligence/data";
import {
  canAccessProjectIntelligence,
  isAuditPersona,
  type ProjectIntelligencePersona,
} from "@/lib/intelligence/rbac";
import { readPersonaFromCookieHeader } from "@/lib/auth";
import { StoryCard } from "@/components/intelligence/StoryCard";
import { BlockedByList } from "@/components/intelligence/BlockedByList";
import { HandoffContractViewer } from "@/components/intelligence/HandoffContractViewer";
import { StoryQaAgentButton } from "@/components/step45/StoryQaAgentButton";

export const dynamic = "force-dynamic";

export default async function StoryDetailPage({
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
  const story = await getStory(id);
  if (!story) notFound();
  const audit = isAuditPersona(persona);

  const [resolvedContracts, allContracts, epics, stories] = await Promise.all([
    Promise.all(
      story.handoffContractIds.map((hid) => getHandoffContract(hid)),
    ),
    listHandoffContracts(),
    listEpics(),
    listStories(),
  ]);

  const handoffContracts = resolvedContracts.filter(
    (h): h is NonNullable<typeof h> => h !== null,
  );

  const resolve = (id: string) => resolveIdentifier(id, epics, stories);

  return (
    <div className="space-y-8" data-testid="story-detail">
      <nav className="text-xs text-forge-300" aria-label="Breadcrumb">
        <a
          href="/project-intelligence"
          className="hover:text-forge-100"
          data-testid="story-detail-back"
        >
          ← Project Intelligence
        </a>
      </nav>

      <StoryCard story={story} isAudit={audit} />

      {/* Step 45 — QA Agent entry point (PR linked). */}
      <StoryQaAgentButton storyId={story.id} />

      <section
        aria-labelledby="story-blocked-h"
        className="space-y-3"
        data-testid="story-detail-blocked"
      >
        <h2 id="story-blocked-h" className="text-lg font-semibold">
          Blockers
        </h2>
        <BlockedByList
          blockedBy={story.blockedBy}
          blocks={story.blocks}
          variant="panel"
          resolveIdentifier={resolve}
        />
      </section>

      <section
        aria-labelledby="story-handoffs-h"
        className="space-y-3"
        data-testid="story-detail-handoffs"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="story-handoffs-h" className="text-lg font-semibold">
            Handoff contracts
          </h2>
          <p className="text-xs text-forge-300" data-testid="story-detail-handoff-count">
            {handoffContracts.length} contract
            {handoffContracts.length === 1 ? "" : "s"} · {allContracts.length} total
            across all stories
          </p>
        </div>
        {handoffContracts.length === 0 ? (
          <p
            className="card text-sm text-forge-200"
            data-testid="story-detail-handoff-empty"
          >
            No handoff contracts bound to this story yet.
          </p>
        ) : (
          <ul
            className="grid gap-3 md:grid-cols-2"
            aria-label="Handoff contracts"
            data-testid="story-detail-handoff-list"
            data-contract-count={handoffContracts.length}
          >
            {handoffContracts.map((h) => (
              <li key={h.id}>
                <HandoffContractViewer contract={h} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer
        className="text-xs text-forge-300"
        data-testid="story-detail-tenant"
      >
        tenant <span className="font-mono">{SEED_TENANT_ID}</span>
      </footer>
    </div>
  );
}