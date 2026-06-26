/**
 * Seed data for the modernized Organization Knowledge page (Step 29).
 *
 * Stable, mock-only data: 6 templates, 5 standards, 4 policies, 3 runbooks,
 * 5 best practices, plus projects, KPI rows, and graph edges for the
 * Obsidian-style Graph tab. All IDs are deterministic so deep-linking and
 * backlink resolution work consistently across renders.
 *
 * This data is intentionally local — the production data layer lives at
 * `/v1/org-knowledge/*` (see lib/org-knowledge/data.ts). The seed is used
 * for the F-004/F-005 new tabs and the Overview KPIs that the API does
 * not yet expose.
 */

import type {
  Policy,
  Standard,
  Template,
} from '@/lib/org-knowledge/data';

export type RunbookStepKind = 'manual' | 'command' | 'check';

export interface RunbookStep {
  id: string;
  title: string;
  description: string;
  kind: RunbookStepKind;
  command?: string;
  expectedOutput?: string;
}

export interface Runbook {
  id: string;
  title: string;
  summary: string;
  steps: RunbookStep[];
  status: 'draft' | 'tested' | 'production' | 'outdated';
  successRate: number;
  lastRunAt: string;
  lastRunStatus: 'success' | 'failure' | 'cancelled';
}

export interface BestPractice {
  id: string;
  title: string;
  summary: string;
  category: 'code-quality' | 'testing' | 'security' | 'performance' | 'collaboration' | 'documentation';
  author: string;
  readingMinutes: number;
  read: boolean;
  featured: boolean;
}

export interface ProjectRef {
  id: string;
  name: string;
  artifactsCount: number;
  compliance: number; // 0..100
  lastAudit: string;
}

export interface OverviewKpi {
  id: 'total' | 'recent' | 'adoption' | 'approval' | 'compliance';
  label: string;
  value: string;
  delta?: string;
  iconKey: 'book' | 'sparkles' | 'users' | 'clock' | 'shield';
  tone: 'indigo' | 'emerald' | 'cyan' | 'amber' | 'violet';
}

export interface ActivityEvent {
  id: string;
  when: string;
  actor: string;
  action: 'created' | 'updated' | 'approved' | 'archived' | 'published';
  ref: { id: string; label: string };
  summary?: string;
}

export interface KnowledgeGap {
  id: string;
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ArtifactEdge {
  from: string;
  to: string;
  kind: 'references' | 'supersedes' | 'depends-on' | 'related-to';
}

export interface RecommendedItem {
  id: string;
  title: string;
  reason: string;
  refId: string;
  tone: 'info' | 'warning' | 'positive';
}

export interface TemplateUsage {
  id: string;
  name: string;
  uses: number;
  type: 'prd' | 'adr' | 'bug' | 'runbook' | 'rfc' | 'spec' | 'custom';
}

// ---------------------------------------------------------------------------
// Reference lists
// ---------------------------------------------------------------------------

export const PROJECTS: ReadonlyArray<ProjectRef> = [
  { id: 'proj-forge-platform', name: 'Forge Platform', artifactsCount: 47, compliance: 96, lastAudit: '2026-06-21' },
  { id: 'proj-acme-corp', name: 'Acme Corp Onboarding', artifactsCount: 31, compliance: 88, lastAudit: '2026-06-19' },
  { id: 'proj-payment-service', name: 'Payment Service', artifactsCount: 22, compliance: 72, lastAudit: '2026-06-15' },
  { id: 'proj-data-pipeline', name: 'Data Pipeline v3', artifactsCount: 18, compliance: 91, lastAudit: '2026-06-22' },
  { id: 'proj-mobile-app', name: 'Mobile App Redesign', artifactsCount: 14, compliance: 64, lastAudit: '2026-06-10' },
];

export const KPIS: ReadonlyArray<OverviewKpi> = [
  { id: 'total', label: 'Total artifacts', value: '124', delta: '+8 this week', iconKey: 'book', tone: 'indigo' },
  { id: 'recent', label: 'Recently published', value: '14', delta: 'last 7d', iconKey: 'sparkles', tone: 'emerald' },
  { id: 'adoption', label: 'Adoption rate', value: '82%', delta: '+4 vs last month', iconKey: 'users', tone: 'cyan' },
  { id: 'approval', label: 'Avg approval time', value: '3.2h', delta: '−1.1h', iconKey: 'clock', tone: 'amber' },
  { id: 'compliance', label: 'Compliance score', value: '94%', delta: '+2 since Q1', iconKey: 'shield', tone: 'violet' },
];

export const ACTIVITY: ReadonlyArray<ActivityEvent> = [
  { id: 'e1', when: '2026-06-25T16:42:00Z', actor: 'Priya Anand', action: 'published', ref: { id: 'F-001-005', label: 'API versioning policy' } },
  { id: 'e2', when: '2026-06-25T15:18:00Z', actor: 'Diego Martin', action: 'updated', ref: { id: 'F-002-003', label: 'ADR template' }, summary: '+18 / −4 lines' },
  { id: 'e3', when: '2026-06-25T13:04:00Z', actor: 'Aisha Khan', action: 'approved', ref: { id: 'F-003-002', label: 'Secret rotation policy' } },
  { id: 'e4', when: '2026-06-25T11:55:00Z', actor: 'Tom Berger', action: 'created', ref: { id: 'F-004-001', label: 'Payment service outage runbook' } },
  { id: 'e5', when: '2026-06-25T09:30:00Z', actor: 'Mei Lin', action: 'updated', ref: { id: 'F-001-002', label: 'Incident severity ladder' }, summary: '+6 / −1 lines' },
  { id: 'e6', when: '2026-06-24T19:11:00Z', actor: 'Jonas Holm', action: 'archived', ref: { id: 'F-002-007', label: 'Legacy PRD v1 template' } },
  { id: 'e7', when: '2026-06-24T17:02:00Z', actor: 'Priya Anand', action: 'updated', ref: { id: 'F-005-003', label: 'Effective code review checklist' } },
  { id: 'e8', when: '2026-06-24T14:45:00Z', actor: 'Aisha Khan', action: 'published', ref: { id: 'F-003-004', label: 'Data classification policy' } },
  { id: 'e9', when: '2026-06-24T12:30:00Z', actor: 'Diego Martin', action: 'created', ref: { id: 'F-005-005', label: 'Async standup guidelines' } },
  { id: 'e10', when: '2026-06-24T10:08:00Z', actor: 'Tom Berger', action: 'updated', ref: { id: 'F-004-002', label: 'Database failover runbook' }, summary: '+22 / −9 lines' },
];

export const QUICK_ACCESS: ReadonlyArray<{ id: string; label: string; views: number }> = [
  { id: 'F-001-001', label: 'Service ownership standard', views: 412 },
  { id: 'F-002-001', label: 'PRD template v3', views: 387 },
  { id: 'F-003-001', label: 'PII handling policy', views: 304 },
  { id: 'F-005-001', label: 'Effective code reviews', views: 287 },
  { id: 'F-001-005', label: 'API versioning policy', views: 241 },
];

export const RECOMMENDED: ReadonlyArray<RecommendedItem> = [
  {
    id: 'rec-1',
    title: 'API versioning policy',
    reason: "Engineering Lead at Forge Platform — last updated 47d ago. You're shipping a v2 endpoint in two sprints.",
    refId: 'F-001-005',
    tone: 'info',
  },
  {
    id: 'rec-2',
    title: 'PRD template v2',
    reason: 'Hot topic: 5 projects still using v2. Migrate before Q3 to unlock AI-assisted PRDs.',
    refId: 'F-002-006',
    tone: 'warning',
  },
  {
    id: 'rec-3',
    title: 'Secret rotation runbook',
    reason: 'Aisha approved the new secret rotation policy — read the linked runbook before next on-call.',
    refId: 'F-004-001',
    tone: 'positive',
  },
];

export const TEMPLATE_USAGE: ReadonlyArray<TemplateUsage> = [
  { id: 'F-002-001', name: 'PRD template v3', uses: 47, type: 'prd' },
  { id: 'F-002-002', name: 'ADR template', uses: 38, type: 'adr' },
  { id: 'F-002-003', name: 'Bug report template', uses: 33, type: 'bug' },
  { id: 'F-002-004', name: 'Runbook template', uses: 22, type: 'runbook' },
  { id: 'F-002-005', name: 'RFC template', uses: 19, type: 'rfc' },
  { id: 'F-002-006', name: 'Technical spec template', uses: 14, type: 'spec' },
  { id: 'F-002-007', name: 'Custom: security review', uses: 11, type: 'custom' },
  { id: 'F-002-008', name: 'Custom: customer RFC', uses: 7, type: 'custom' },
];

export const KNOWLEDGE_GAPS: ReadonlyArray<KnowledgeGap> = [
  {
    id: 'gap-1',
    title: 'No ADR exists for "Database migration strategy"',
    detail: 'Forge Platform has shipped 14 schema changes this quarter without an overarching decision record.',
    severity: 'high',
  },
  {
    id: 'gap-2',
    title: 'Bug report template not used in 3 projects',
    detail: 'Mobile App Redesign, Data Pipeline v3, and Payment Service have not adopted the standardized bug report.',
    severity: 'medium',
  },
  {
    id: 'gap-3',
    title: 'Runbook for "Payment service outage" is missing',
    detail: 'Payment Service has 22 incidents on record but no tested runbook. Critical for on-call.',
    severity: 'high',
  },
  {
    id: 'gap-4',
    title: 'Best practice: "Observability golden signals" not documented',
    detail: 'Standards reference the three golden signals but no curated practice exists yet.',
    severity: 'low',
  },
];

// ---------------------------------------------------------------------------
// Runbooks (F-004)
// ---------------------------------------------------------------------------

export const RUNBOOKS: ReadonlyArray<Runbook> = [
  {
    id: 'F-004-001',
    title: 'Payment service outage',
    summary: 'Restore payment processing during a regional or full outage. Covers upstream rate-limit bypass, queue draining, and degraded-mode flags.',
    status: 'production',
    successRate: 0.96,
    lastRunAt: '2026-06-23T08:12:00Z',
    lastRunStatus: 'success',
    steps: [
      { id: 's1', title: 'Acknowledge incident', description: 'Page on-call lead and confirm scope via the #payments-war-room channel.', kind: 'manual' },
      { id: 's2', title: 'Check upstream provider status', description: 'Run this to determine whether the outage is internal or upstream.', kind: 'command', command: 'curl -s https://status.payments.example.com/health | jq ".status"', expectedOutput: '"operational"' },
      { id: 's3', title: 'Enable degraded mode flag', description: 'Switch the global feature flag so retries use the cached circuit-breaker.', kind: 'command', command: 'forge flag set payments.degraded_mode true --scope global', expectedOutput: 'flag updated' },
      { id: 's4', title: 'Drain in-flight queue', description: 'Wait until the queue backlog is below 50 messages before continuing.', kind: 'check' },
      { id: 's5', title: 'Confirm recovery', description: 'Verify error rate returns to baseline (<0.1%) for 5 minutes.', kind: 'manual' },
    ],
  },
  {
    id: 'F-004-002',
    title: 'Database failover',
    summary: 'Promote the standby replica and re-point all writers. Includes rollback procedure if the new primary lags behind.',
    status: 'tested',
    successRate: 0.92,
    lastRunAt: '2026-06-19T03:40:00Z',
    lastRunStatus: 'success',
    steps: [
      { id: 's1', title: 'Confirm replication lag < 1s', description: 'Check before promoting to minimise data loss.', kind: 'command', command: 'forge db lag --primary primary.db --replica standby.db', expectedOutput: 'lag=0.4s' },
      { id: 's2', title: 'Pause writers', description: 'Quiesce the application tier to prevent split-brain writes.', kind: 'command', command: 'forge app pause --tier api --reason failover' },
      { id: 's3', title: 'Promote replica', description: 'Execute the managed failover playbook.', kind: 'command', command: 'forge db promote --replica standby.db' },
      { id: 's4', title: 'Verify writes resume', description: 'Insert a sentinel row and confirm reads reflect it.', kind: 'check' },
    ],
  },
  {
    id: 'F-004-003',
    title: 'Tenant data export request',
    summary: 'Generate a GDPR-compliant export bundle for a tenant and ship it via signed S3 URL.',
    status: 'draft',
    successRate: 0.0,
    lastRunAt: '',
    lastRunStatus: 'cancelled',
    steps: [
      { id: 's1', title: 'Validate tenant ownership', description: 'Confirm the requester is a workspace admin or has the export role.', kind: 'manual' },
      { id: 's2', title: 'Queue export job', description: 'Enqueue a job that streams every tenant-owned record into a parquet bundle.', kind: 'command', command: 'forge export enqueue --tenant $TENANT_ID' },
      { id: 's3', title: 'Generate signed URL', description: 'Once the job completes, mint a 24-hour signed S3 URL.', kind: 'command', command: 'forge export sign --job $JOB_ID --ttl 24h' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Best Practices (F-005)
// ---------------------------------------------------------------------------

export const BEST_PRACTICES: ReadonlyArray<BestPractice> = [
  {
    id: 'F-005-001',
    title: 'Effective code review checklists',
    summary: 'A pragmatic checklist that catches 80% of regressions without slowing the team down. Includes the "two-question" prompt for reviewers.',
    category: 'code-quality',
    author: 'Priya Anand',
    readingMinutes: 6,
    read: true,
    featured: true,
  },
  {
    id: 'F-005-002',
    title: 'Testing pyramids that actually work',
    summary: 'Why most teams over-invest in E2E tests and under-invest in unit tests. Concrete ratios that scale with team size.',
    category: 'testing',
    author: 'Diego Martin',
    readingMinutes: 9,
    read: true,
    featured: true,
  },
  {
    id: 'F-005-003',
    title: 'Async standups that respect timezones',
    summary: 'A written-first standup format that unblocks distributed teams without forcing a synchronous meeting.',
    category: 'collaboration',
    author: 'Aisha Khan',
    readingMinutes: 4,
    read: false,
    featured: false,
  },
  {
    id: 'F-005-004',
    title: 'Securing LLM tool calls',
    summary: 'A pattern for sandboxing tool execution when agents can call arbitrary code. Covers schema validation and audit hooks.',
    category: 'security',
    author: 'Mei Lin',
    readingMinutes: 11,
    read: false,
    featured: false,
  },
  {
    id: 'F-005-005',
    title: 'Documenting decisions you can revert',
    summary: 'A writing style for ADRs that makes reversibility cheap. Includes the "exit criterion" pattern.',
    category: 'documentation',
    author: 'Tom Berger',
    readingMinutes: 7,
    read: false,
    featured: false,
  },
];

// ---------------------------------------------------------------------------
// Graph edges (Obsidian-style connections between F-001..F-005)
// ---------------------------------------------------------------------------

export const GRAPH_EDGES: ReadonlyArray<ArtifactEdge> = [
  { from: 'F-001-005', to: 'F-002-002', kind: 'related-to' },
  { from: 'F-001-001', to: 'F-002-001', kind: 'references' },
  { from: 'F-003-001', to: 'F-001-001', kind: 'depends-on' },
  { from: 'F-003-002', to: 'F-004-001', kind: 'references' },
  { from: 'F-002-004', to: 'F-004-002', kind: 'supersedes' },
  { from: 'F-001-005', to: 'F-002-006', kind: 'related-to' },
  { from: 'F-002-002', to: 'F-005-005', kind: 'references' },
  { from: 'F-005-001', to: 'F-001-002', kind: 'related-to' },
  { from: 'F-005-002', to: 'F-002-003', kind: 'related-to' },
  { from: 'F-004-001', to: 'F-003-002', kind: 'depends-on' },
];

// ---------------------------------------------------------------------------
// Drift / adoption incentives
// ---------------------------------------------------------------------------

export const DRIFT_ALERTS: ReadonlyArray<{ id: string; title: string; affectedProjects: number; artifactId: string }> = [
  { id: 'drift-1', title: '3 projects using outdated "Auth policy v2"', affectedProjects: 3, artifactId: 'F-003-003' },
  { id: 'drift-2', title: '2 projects still on "PRD template v2" — migrate to v3', affectedProjects: 2, artifactId: 'F-002-001' },
];

export const ADOPTION_BADGES: ReadonlyArray<{ icon: string; label: string }> = [
  { icon: 'trophy', label: 'Your team adopted 8/10 standards this quarter — 80% adoption rate' },
  { icon: 'medal', label: 'Top contributor this month: Priya (24 contributions)' },
  { icon: 'sparkles', label: 'New project "Acme Corp Onboarding" auto-applied 12/15 recommended standards' },
];

// ---------------------------------------------------------------------------
// Re-exports of the typed artifact shapes (so the page can import from one place)
// ---------------------------------------------------------------------------

export type { Policy, Standard, Template };

/** Empty fallback used when the API returns nothing — keeps the UI alive. */
export const EMPTY_STANDARDS: ReadonlyArray<Standard> = [];
export const EMPTY_TEMPLATES: ReadonlyArray<Template> = [];
export const EMPTY_POLICIES: ReadonlyArray<Policy> = [];