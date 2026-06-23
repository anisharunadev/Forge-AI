/**
 * Project Intelligence — list page (FORA-501, Plan 1 §3.4).
 *
 * The PM-facing typed-artifact browser. Server-fetches the typed mock
 * epic + story + brief + draft-prd sets, applies the RBAC gate, and
 * renders the list + the three stage tabs (Plan 1 §4).
 *
 * Per-tenant (SEED_TENANT_ID), persona-gated:
 *   * PM — full read-write chrome.
 *   * Eng Lead, CTO — read-only "audit" chrome.
 *
 * Reconciles with:
 *   * Plan 1 §3.4 — five primary typed artifacts.
 *   * Plan 1 §4 — three stage tabs (Dev / QA / DevOps).
 *   * Plan 4 §3.1 + §3.4 — typed-artifact renderers.
 *   * memory/architecture.md §7 — Handoff Contract envelope.
 *
 * Phase 0.5-05: redesigned with `PageHeader` from
 * `@/components/shell` + semantic tokens (no `forge-*` literal
 * color classes). The RBAC-denied empty state uses shadcn
 * `<Alert variant="destructive">` + `<StatusPill>` for the
 * "Access restricted" pill instead of bespoke `border-rose-*`
 * + `bg-rose-*` classes.
 */

import { cookies } from 'next/headers';
import { Lock } from 'lucide-react';

import {
  listDraftPrds,
  listEpics,
  listRequirementBriefs,
  listStories,
  listStoriesForEpic,
  SEED_TENANT_ID,
} from '@/lib/intelligence/data';
import {
  canAccessProjectIntelligence,
  escalationPersonaLabel,
  isAuditPersona,
  type ProjectIntelligencePersona,
} from '@/lib/intelligence/rbac';
import { SEED_TENANT_NAME, readPersonaFromCookieHeader } from '@/lib/auth';
import { EpicCard } from '@/components/intelligence/EpicCard';
import { StoryCard } from '@/components/intelligence/StoryCard';
import { RequirementBriefCard } from '@/components/intelligence/RequirementBriefCard';
import { StageTabs } from '@/components/intelligence/StageTabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PageHeader, EmptyState, SectionCard } from '@/components/shell';
import { StatusPill } from '@/components/shell';
import { DRILL_DOWN_STAGES, type DrillDownStage } from '@/lib/intelligence/types';

export const dynamic = 'force-dynamic';

const PERSONA_LABEL: Record<ProjectIntelligencePersona, string> = {
  pm: 'Product Manager',
  'eng-lead': 'Engineering Lead',
  cto: 'CTO',
};

function parseStage(value: string | undefined): DrillDownStage {
  if (value && (DRILL_DOWN_STAGES as ReadonlyArray<string>).includes(value)) {
    return value as DrillDownStage;
  }
  return 'dev';
}

export default async function ProjectIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const persona: ProjectIntelligencePersona = readPersonaFromCookieHeader(
    cookieHeader,
  );

  if (!canAccessProjectIntelligence(persona)) {
    return (
      <div className="space-y-6" data-testid="project-intelligence">
        <PageHeader
          eyebrow="Center"
          title="Project Intelligence"
          description="PM-facing typed-artifact browser for every Epic, every Story, every active run, every open question."
        />

        <div
          data-testid="project-intelligence-empty-state"
          data-empty-kind="rbac-denied"
        >
          <Alert variant="destructive">
            <Lock className="h-4 w-4" aria-hidden="true" />
            <AlertTitle className="flex items-center gap-2">
              <StatusPill
                tone="danger"
                glyph="✕"
                label="Access restricted"
                size="sm"
                data-testid="project-intelligence-empty-pill"
              />
              <span>Project Intelligence is restricted to Product, Engineering Lead, and CTO personas.</span>
            </AlertTitle>
            <AlertDescription>
              The <span className="font-mono">{persona}</span> persona cannot view
              Project Intelligence. Ask the{' '}
              <span className="font-mono">
                {escalationPersonaLabel(persona).toLowerCase()}
              </span>{' '}
              to operate the center for tenant{' '}
              <span className="font-mono">{SEED_TENANT_ID}</span>.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const audit = isAuditPersona(persona);
  const params = await searchParams;
  const activeStage = parseStage(params.stage);

  const [epics, stories, briefs, drafts] = await Promise.all([
    listEpics(),
    listStories(),
    listRequirementBriefs(),
    listDraftPrds(),
  ]);

  return (
    <div className="space-y-8" data-testid="project-intelligence">
      <PageHeader
        eyebrow={audit ? 'Center · audit view' : 'Center'}
        title="Project Intelligence"
        description={`PM-facing typed-artifact browser for every Epic, every Story, every active run, every open question. ${PERSONA_LABEL[persona]} viewing tenant ${SEED_TENANT_ID} (${SEED_TENANT_NAME}).`}
      />

      <section
        aria-labelledby="epics-h"
        className="space-y-3"
        data-testid="project-intelligence-epics"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="epics-h" className="text-lg font-semibold text-foreground">
            Epics
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="project-intelligence-epic-count">
            {epics.length} epic{epics.length === 1 ? '' : 's'}
          </p>
        </div>
        <ul
          className="grid gap-3 md:grid-cols-2"
          aria-label="Epics"
          data-testid="project-intelligence-epic-list"
          data-epic-count={epics.length}
        >
          {epics.map((e) => (
            <EpicCard
              key={e.id}
              epic={e}
              storyCount={stories.filter((s) => s.epicId === e.id).length}
              isAudit={audit}
            />
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="briefs-h"
        className="space-y-3"
        data-testid="project-intelligence-briefs"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="briefs-h" className="text-lg font-semibold text-foreground">
            Requirement briefs
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="project-intelligence-brief-count">
            {briefs.length} brief{briefs.length === 1 ? '' : 's'} · schema v1.0
          </p>
        </div>
        <ul
          className="grid gap-3 md:grid-cols-2"
          aria-label="Requirement briefs"
          data-testid="project-intelligence-brief-list"
          data-brief-count={briefs.length}
        >
          {briefs.map((b) => (
            <li key={b.id}>
              <RequirementBriefCard brief={b} />
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="drafts-h"
        className="space-y-3"
        data-testid="project-intelligence-drafts"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="drafts-h" className="text-lg font-semibold text-foreground">
            Draft PRDs
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="project-intelligence-draft-count">
            {drafts.length} draft{drafts.length === 1 ? '' : 's'} · lint-passed
          </p>
        </div>
        {drafts.length === 0 ? (
          <EmptyState
            title="No draft PRDs yet"
            description="Drafts are produced by the architecture pipeline."
          />
        ) : (
          <ul
            className="grid gap-3 md:grid-cols-2"
            aria-label="Draft PRDs"
            data-testid="project-intelligence-draft-list"
            data-draft-count={drafts.length}
          >
            {drafts.map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-border bg-card p-4"
                data-testid="project-intelligence-draft-card"
                data-prd-id={d.id}
              >
                <h3 className="text-base font-semibold text-foreground">{d.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {d.sectionBodies ? Object.keys(d.sectionBodies).length : 0}{' '}
                  sections · lint-passed
                </p>
                <a
                  href={`/project-intelligence/drafts/${d.id}`}
                  className="mt-3 inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-accent"
                  data-testid="project-intelligence-draft-open"
                >
                  View Draft PRD →
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <StageTabs stories={stories} active={activeStage} isAudit={audit} />

      <section
        aria-labelledby="stories-h"
        className="space-y-3"
        data-testid="project-intelligence-stories"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="stories-h" className="text-lg font-semibold text-foreground">
            All stories
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="project-intelligence-story-count">
            {stories.length} stor{stories.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
        <ul
          className="grid gap-3 md:grid-cols-2"
          aria-label="Stories"
          data-testid="project-intelligence-story-list"
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