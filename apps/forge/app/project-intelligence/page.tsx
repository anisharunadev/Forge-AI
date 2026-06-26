/**
 * Project Intelligence — modernized landing surface (Step 20).
 *
 * Replaces the previous four-section stacked layout with:
 *   1. Sticky project context bar (selector + breadcrumbs + actions).
 *   2. Animated-gradient hero band with view toggle.
 *   3. KPI strip (4 tiles + sparklines).
 *   4. Two-column bento: left = typed artifacts (epics, briefs, drafts,
 *      active stories by stage); right = metrics (velocity, burndown,
 *      team load, recent activity).
 *
 * Per-tenant (SEED_TENANT_ID), persona-gated (RBAC unchanged).
 * Persona = "pm" gets full chrome; eng-lead / cto get audit read-only.
 *
 * URL params:
 *   ?view=all|mine|at-risk|recent
 *   ?project=<id>
 *   ?stage=dev|qa|devops
 */

import { cookies } from 'next/headers';
import {
  Lock,
  ShieldOff
} from 'lucide-react';

import {
  listDraftPrds,
  listEpics,
  listRequirementBriefs,
  listStories,
} from '@/lib/intelligence/data';
import {
  canAccessProjectIntelligence,
  isAuditPersona,
  type ProjectIntelligencePersona,
} from '@/lib/intelligence/rbac';
import {
  SEED_TENANT_NAME,
  readPersonaFromCookieHeader,
} from '@/lib/auth';

import {
  ProjectContextBar,
  HeroBand,
  KpiStrip,
  SectionEpics,
  SectionBriefs,
  SectionDrafts,
  SectionActiveStories,
  StoriesSnapshot,
  RightColumn,
  defaultVelocity,
  defaultBurndown,
  defaultTeamLoad,
  defaultActivity,
  FreshProjectEmpty,
} from '@/components/project-intelligence';
import { defaultKpiTiles } from '@/components/project-intelligence/kpi-defaults';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/shell';

import { ErrorState } from '@/components/error-state';

import type {
  HeroViewFilter,
  ProjectOption,
  HealthState,
} from '@/components/project-intelligence';
import type { Epic, Story } from '@/lib/intelligence/types';

export const dynamic = 'force-dynamic';

const PERSONA_LABEL: Record<ProjectIntelligencePersona, string> = {
  pm: 'Product Manager',
  'eng-lead': 'Engineering Lead',
  steward: 'Steward',
  cto: 'CTO',
};

const VIEW_FILTERS = ['all', 'mine', 'at-risk', 'recent'] as const;
type ViewFilter = (typeof VIEW_FILTERS)[number];

function parseView(value: string | undefined): ViewFilter {
  if (value && (VIEW_FILTERS as ReadonlyArray<string>).includes(value)) {
    return value as ViewFilter;
  }
  return 'all';
}

function deriveHealth(
  epics: ReadonlyArray<Epic>,
  stories: ReadonlyArray<Story>,
): HealthState {
  const atRisk = epics.filter((e) => e.status === 'at-risk').length;
  const blocked = epics.filter((e) => e.status === 'cancelled').length;
  const inFlightStories = stories.filter(
    (s) => s.status === 'dev' || s.status === 'qa' || s.status === 'security',
  ).length;
  if (blocked > 0) {
    return { status: 'down', label: `${blocked} blocked` };
  }
  if (atRisk > 0 || inFlightStories > 8) {
    return { status: 'degraded', label: `${atRisk} at risk` };
  }
  return { status: 'healthy', label: 'All green' };
}

function sparkline(seed: number, length: number): number[] {
  // Deterministic mock sparkline — same shape each render.
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const v = Math.sin((seed + i) * 1.3) * 0.5 + 0.5 + i * 0.04;
    out.push(Math.max(0, Math.min(1, v)) * 10);
  }
  return out;
}

function isFreshProject(
  epicsCount: number,
  briefsCount: number,
  draftsCount: number,
): boolean {
  return epicsCount === 0 && briefsCount === 0 && draftsCount === 0;
}

export default async function ProjectIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{
    stage?: string;
    view?: string;
    project?: string;
    error?: string;
  }>;
}) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const persona: ProjectIntelligencePersona =
    readPersonaFromCookieHeader(cookieHeader);

  // RBAC gate (unchanged from prior step).
  if (!canAccessProjectIntelligence(persona)) {
    return (
      <div className="space-y-6" data-testid="project-intelligence">
        <ProjectContextBar
          tenantName={SEED_TENANT_NAME}
          tenantSlug="acme-corp"
          project={{
            id: 'project-forge-demo',
            name: 'Forge Platform',
            initials: 'FP',
            region: 'us-east-1',
          }}
          projects={[
            {
              id: 'project-forge-demo',
              name: 'Forge Platform',
              initials: 'FP',
              region: 'us-east-1',
            },
          ]}
          lastSyncLabel="—"
          health={{ status: 'healthy', label: 'Unknown' }}
          breadcrumbs={[
            { label: 'Acme Corp', href: '/dashboard' },
            { label: 'Forge Platform', href: '/project-intelligence' },
            { label: 'Project Intelligence' },
          ]}
        />
        <div
          data-testid="project-intelligence-rbac-denied"
          data-empty-kind="rbac-denied"
          className="mx-auto max-w-2xl pt-12"
        >
          <Alert variant="destructive">
            <Lock className="h-4 w-4" aria-hidden="true" />
            <AlertTitle className="flex items-center gap-2">
              <StatusPill tone="danger" glyph="✕" label="Access restricted" size="sm" />
              <span>Project Intelligence is restricted.</span>
            </AlertTitle>
            <AlertDescription>
              The <span className="font-mono">{persona}</span> persona cannot
              view Project Intelligence. Ask your product manager to operate the
              center for this tenant.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const view = parseView(params.view);
  const audit = isAuditPersona(persona);

  // Fetch typed artifacts (RBAC passed).
  const [epics, stories, briefs, drafts] = await Promise.all([
    listEpics(),
    listStories(),
    listRequirementBriefs(),
    listDraftPrds(),
  ]);

  // Network / 404 error shortcut — `/project-intelligence?error=404`
  // surfaces the 404 branch so reviewers can see it without an outage.
  const errorCode = params.error;
  if (errorCode === '404') {
    return (
      <div className="space-y-6" data-testid="project-intelligence">
        <ProjectContextBar
          tenantName={SEED_TENANT_NAME}
          tenantSlug="acme-corp"
          project={{
            id: 'project-forge-demo',
            name: 'Forge Platform',
            initials: 'FP',
            region: 'us-east-1',
          }}
          projects={[
            {
              id: 'project-forge-demo',
              name: 'Forge Platform',
              initials: 'FP',
              region: 'us-east-1',
            },
          ]}
          lastSyncLabel="—"
          health={{ status: 'down', label: 'Not found' }}
          breadcrumbs={[
            { label: 'Acme Corp', href: '/dashboard' },
            { label: 'Forge Platform', href: '/project-intelligence' },
            { label: 'Project Intelligence' },
          ]}
        />
        <ErrorState
          title="Project not found"
          description="The project you're looking for doesn't exist or has been archived. Head back to the project list to pick another one."
          backLabel="Back to projects"
          backHref="/dashboard"
          testId="project-intelligence-404"
        />
      </div>
    );
  }
  if (errorCode === '403') {
    return (
      <div className="space-y-6" data-testid="project-intelligence">
        <ProjectContextBar
          tenantName={SEED_TENANT_NAME}
          tenantSlug="acme-corp"
          project={{
            id: 'project-forge-demo',
            name: 'Forge Platform',
            initials: 'FP',
            region: 'us-east-1',
          }}
          projects={[
            {
              id: 'project-forge-demo',
              name: 'Forge Platform',
              initials: 'FP',
              region: 'us-east-1',
            },
          ]}
          lastSyncLabel="—"
          health={{ status: 'down', label: 'No access' }}
          breadcrumbs={[
            { label: 'Acme Corp', href: '/dashboard' },
            { label: 'Forge Platform', href: '/project-intelligence' },
            { label: 'Project Intelligence' },
          ]}
        />
        <div
          className="mx-auto max-w-2xl pt-12"
          data-testid="project-intelligence-403"
        >
          <Alert>
            <ShieldOff className="h-4 w-4" aria-hidden="true" />
            <AlertTitle className="flex items-center gap-2">
              <StatusPill tone="warn" glyph="◑" label="No access" size="sm" />
              <span>You don't have access to this project.</span>
            </AlertTitle>
            <AlertDescription>
              Ask a project admin to grant you access, or request it directly.
            </AlertDescription>
            <div className="mt-3">
              <Button type="button" size="sm" data-testid="project-request-access">
                Request access
              </Button>
            </div>
          </Alert>
        </div>
      </div>
    );
  }
  if (errorCode === 'network') {
    return (
      <div className="space-y-6" data-testid="project-intelligence">
        <ProjectContextBar
          tenantName={SEED_TENANT_NAME}
          tenantSlug="acme-corp"
          project={{
            id: 'project-forge-demo',
            name: 'Forge Platform',
            initials: 'FP',
            region: 'us-east-1',
          }}
          projects={[
            {
              id: 'project-forge-demo',
              name: 'Forge Platform',
              initials: 'FP',
              region: 'us-east-1',
            },
          ]}
          lastSyncLabel="—"
          health={{ status: 'degraded', label: 'Offline' }}
          breadcrumbs={[
            { label: 'Acme Corp', href: '/dashboard' },
            { label: 'Forge Platform', href: '/project-intelligence' },
            { label: 'Project Intelligence' },
          ]}
        />
        <ErrorState
          title="Couldn't reach the orchestrator"
          description="We can't load this project's typed artifacts right now. Check your connection and try again — your filters are preserved."
          retryLabel="Retry"
          onRetry={() => {
            // Server component — caller is responsible for wiring router.refresh().
          }}
          backLabel="Back to dashboard"
          backHref="/dashboard"
          testId="project-intelligence-network"
        />
      </div>
    );
  }

  // === Project option list (Combobox) ===
  const projects: ReadonlyArray<ProjectOption> = [
    {
      id: 'project-forge-demo',
      name: 'Forge Platform',
      initials: 'FP',
      region: 'us-east-1',
    },
    {
      id: 'project-mobile-app',
      name: 'Forge Mobile',
      initials: 'FM',
      region: 'eu-west-1',
    },
    {
      id: 'project-knowledge-base',
      name: 'Knowledge Base',
      initials: 'KB',
      region: 'us-west-2',
    },
  ];
  const currentProject: ProjectOption = {
    id: 'project-forge-demo',
    name: 'Forge Platform',
    initials: 'FP',
    region: 'us-east-1',
  };

  // === Derived data ===
  const storyCountByEpic: Record<string, number> = Object.fromEntries(
    epics.map((e) => [
      e.id,
      stories.filter((s) => s.epicId === e.id).length,
    ]),
  );
  const assigneesByEpic: Record<string, ReadonlyArray<string>> = Object.fromEntries(
    epics.map((e) => [
      e.id,
      Array.from(
        new Set(
          stories
            .filter((s) => s.epicId === e.id)
            .map((s) => s.owner),
        ),
      ).slice(0, 6),
    ]),
  );

  // === KPI tile data ===
  const totalEpics = epics.length;
  const openStories = stories.filter(
    (s) =>
      s.status === 'dev' ||
      s.status === 'qa' ||
      s.status === 'security' ||
      s.status === 'devops' ||
      s.status === 'ideation',
  ).length;
  const storiesInDev = stories.filter((s) => s.status === 'dev').length;
  const inFlightAgents = new Set(
    stories.filter((s) => s.status === 'dev').map((s) => s.owner),
  ).size;
  const velocity = 23;

  const kpis = defaultKpiTiles({
    totalEpics,
    epicDelta: '+2 this week',
    epicTrend: 'up',
    epicSpark: sparkline(1, 12),
    openStories,
    openStoriesDelta: `${openStories - 3} last week`,
    openStoriesTrend: openStories > 3 ? 'up' : 'flat',
    openStoriesSpark: sparkline(2, 12),
    storiesInDev,
    storiesInDevAgents: inFlightAgents,
    storiesInDevSpark: sparkline(3, 12),
    velocity: `${velocity}`,
    velocityDelta: '+4 vs last',
    velocityTrend: 'up',
    velocitySpark: sparkline(4, 12),
  });

  const health = deriveHealth(epics, stories);

  // === Fresh project empty state (entire project has nothing) ===
  if (isFreshProject(epics.length, briefs.length, drafts.length)) {
    return (
      <div className="space-y-6 pb-12" data-testid="project-intelligence">
        <ProjectContextBar
          tenantName={SEED_TENANT_NAME}
          tenantSlug="acme-corp"
          project={currentProject}
          projects={projects}
          lastSyncLabel="just now"
          health={health}
          breadcrumbs={[
            { label: 'Acme Corp', href: '/dashboard' },
            { label: 'Forge Platform', href: '/project-intelligence' },
            { label: 'Project Intelligence' },
          ]}
        />
        <div className="mx-auto max-w-[1600px] px-4 md:px-6">
          <HeroBand
            eyebrow={audit ? 'Center · audit view' : 'Center'}
            title="Project Intelligence"
            description={`PM-facing typed-artifact browser for every Epic, every Story, every active run, every open question. ${PERSONA_LABEL[persona]} viewing tenant acme-corp (${SEED_TENANT_NAME}).`}
            activeView={view as HeroViewFilter}
          />
          <div className="mt-6">
            <FreshProjectEmpty />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12" data-testid="project-intelligence">
      <ProjectContextBar
        tenantName={SEED_TENANT_NAME}
        tenantSlug="acme-corp"
        project={currentProject}
        projects={projects}
        lastSyncLabel="2m ago"
        health={health}
        breadcrumbs={[
          { label: 'Acme Corp', href: '/dashboard' },
          { label: 'Forge Platform', href: '/project-intelligence' },
          { label: 'Project Intelligence' },
        ]}
      />

      <div className="mx-auto max-w-[1600px] px-4 md:px-6">
        <HeroBand
          eyebrow={audit ? 'Center · audit view' : 'Center'}
          title="Project Intelligence"
          description={`PM-facing typed-artifact browser for every Epic, every Story, every active run, every open question. ${PERSONA_LABEL[persona]} viewing tenant acme-corp (${SEED_TENANT_NAME}).`}
          activeView={view as HeroViewFilter}
        />

        <div className="mt-6">
          <KpiStrip tiles={kpis} />
        </div>

        <div className="mt-6 flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-6">
            <SectionEpics
              epics={epics}
              storyCountByEpic={storyCountByEpic}
              assigneesByEpic={assigneesByEpic}
            />

            <SectionBriefs briefs={briefs} epics={epics} />

            <SectionDrafts drafts={drafts} briefs={briefs} />

            <SectionActiveStories stories={stories} />
          </div>

          <RightColumn
            velocity={defaultVelocity()}
            burndown={defaultBurndown()}
            teamLoad={defaultTeamLoad()}
            activity={defaultActivity()}
          />
        </div>

        {/* Stories snapshot — deep link from Project Intelligence to the
            Stories center. Surfaces live coding sessions + recent active
            stories so a PM can see in-flight work without leaving the page
            (Step 38 Fixes 2 & 6). */}
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <StoriesSnapshot stories={stories} className="lg:col-span-2" />
          <div className="rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
              Integrations
            </h2>
            <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
              Connected sources feeding this project.
            </p>
            <ul className="mt-3 flex flex-col gap-1.5 text-xs text-[var(--fg-secondary)]">
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]"
                />
                GitHub · main branch
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)]"
                />
                Jira · ACME project
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-amber)]"
                />
                Zendesk · 3 tickets
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--fg-muted)]"
                />
                Notion · not connected
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
