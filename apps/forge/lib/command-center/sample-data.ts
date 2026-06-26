/**
 * Sample data for the Command Center rebuild.
 *
 * Every fixture here is a typed artifact (Rule 4). No free-form blobs.
 * Real data will flow through Connectors (Step 31) and the project
 * intelligence layer; the shape stays stable so the swap is trivial.
 */

import type { ForgePhase } from '../forge-core/manifest';

/* ---------------------------------------------------------------------------
 * Tickets
 * ------------------------------------------------------------------------- */

export type TicketSource = 'jira' | 'github' | 'linear' | 'manual';

export interface LinkedEntity {
  readonly kind: 'idea' | 'story' | 'adr' | 'file' | 'agent' | 'spec' | 'pr';
  readonly id: string;
  readonly label?: string;
}

export type TicketStatus =
  | 'backlog'
  | 'todo'
  | 'in-progress'
  | 'in-review'
  | 'done'
  | 'blocked';

export type TicketPriority = 'p0' | 'p1' | 'p2' | 'p3';

export interface Ticket {
  readonly id: string;
  readonly source: TicketSource;
  readonly title: string;
  readonly summary: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly assignee: string;
  readonly sourceUrl: string;
  readonly labels: ReadonlyArray<string>;
  readonly linked: ReadonlyArray<LinkedEntity>;
  readonly aiSuggestedPhases: ReadonlyArray<ForgePhase>;
  readonly estimatedComplexity: 'small' | 'medium' | 'large' | 'xl';
  readonly similarTicketAvgDays: number;
  readonly lastTouchedAt: string;
}

export const SAMPLE_TICKETS: ReadonlyArray<Ticket> = [
  {
    id: 'ACME-123',
    source: 'jira',
    title: 'OAuth2 PKCE flow for mobile clients',
    summary:
      'Implement OAuth2 PKCE for the mobile SDK so we can deprecate the legacy password grant. Must include refresh-token rotation, idempotent /token calls, and offline-tolerant expiry handling.',
    status: 'in-progress',
    priority: 'p1',
    assignee: 'A. Reyes',
    sourceUrl: 'https://acme.atlassian.net/browse/ACME-123',
    labels: ['security', 'mobile', 'forge-core'],
    linked: [
      { kind: 'adr', id: 'ADR-005', label: 'Auth: OIDC migration' },
      { kind: 'spec', id: 'SPEC-041', label: 'Mobile auth refactor' },
      { kind: 'agent', id: 'code-reviewer' },
      { kind: 'agent', id: 'security-auditor' },
      { kind: 'file', id: 'src/auth/oauth.ts', label: 'auth/oauth.ts' },
      { kind: 'file', id: 'src/auth/refresh.ts', label: 'auth/refresh.ts' },
      { kind: 'file', id: 'tests/auth/pkce.test.ts', label: 'pkce.test.ts' },
    ],
    aiSuggestedPhases: ['discovery', 'planning', 'execution', 'verification', 'deployment'],
    estimatedComplexity: 'medium',
    similarTicketAvgDays: 1.8,
    lastTouchedAt: '2026-06-26T08:42:00Z',
  },
  {
    id: 'acme/forge-core#482',
    source: 'github',
    title: 'Rate-limit `/api/v1/runs` to 60 req/min/IP',
    summary:
      'Hard-cap per-IP rate on the runs endpoint to blunt runaway agent loops. Should return 429 with Retry-After and surface a Foundry alert when a tenant exceeds 10× the cap.',
    status: 'todo',
    priority: 'p2',
    assignee: 'M. Okafor',
    sourceUrl: 'https://github.com/acme/forge-core/issues/482',
    labels: ['platform', 'security'],
    linked: [
      { kind: 'adr', id: 'ADR-021', label: 'Edge rate limit policy' },
      { kind: 'file', id: 'src/api/runs/router.py', label: 'router.py' },
      { kind: 'agent', id: 'platform-sre' },
    ],
    aiSuggestedPhases: ['planning', 'execution', 'verification', 'deployment'],
    estimatedComplexity: 'small',
    similarTicketAvgDays: 0.9,
    lastTouchedAt: '2026-06-25T19:14:00Z',
  },
  {
    id: 'ENG-789',
    source: 'linear',
    title: 'Refactor knowledge graph node keying to ULIDs',
    summary:
      'Switch node IDs from auto-increment ints to ULIDs so we can shard by tenant without collisions. Backfill migration must be idempotent and reversible.',
    status: 'backlog',
    priority: 'p2',
    assignee: 'unassigned',
    sourceUrl: 'https://linear.app/acme/issue/ENG-789',
    labels: ['data', 'migration', 'forge-pi'],
    linked: [
      { kind: 'story', id: 'STORY-108', label: 'Multi-region knowledge graph' },
      { kind: 'file', id: 'forge-pi/graphs/nodes.py', label: 'nodes.py' },
      { kind: 'file', id: 'alembic/versions/2026_07_ulid.py' },
    ],
    aiSuggestedPhases: ['discovery', 'planning', 'execution', 'verification'],
    estimatedComplexity: 'large',
    similarTicketAvgDays: 3.4,
    lastTouchedAt: '2026-06-24T11:02:00Z',
  },
  {
    id: 'ACME-141',
    source: 'jira',
    title: 'Audit: stale run records older than 30 days',
    summary:
      'Cron job to detect and archive runs that have been "running" for >30d. Mirror to audit timeline so we can correlate stuck tenants with agent drift.',
    status: 'in-review',
    priority: 'p3',
    assignee: 'J. Park',
    sourceUrl: 'https://acme.atlassian.net/browse/ACME-141',
    labels: ['audit', 'forge-runs'],
    linked: [
      { kind: 'file', id: 'forge-runs/cleanup.py', label: 'cleanup.py' },
      { kind: 'agent', id: 'audit-milestone' },
    ],
    aiSuggestedPhases: ['audit', 'execution'],
    estimatedComplexity: 'small',
    similarTicketAvgDays: 0.6,
    lastTouchedAt: '2026-06-26T07:33:00Z',
  },
  {
    id: 'ACME-160',
    source: 'jira',
    title: 'Onboarding flow: persona detection',
    summary:
      'Detect developer persona during first-run and surface only the relevant modules. Toggle must respect user override.',
    status: 'blocked',
    priority: 'p2',
    assignee: 'T. Chen',
    sourceUrl: 'https://acme.atlassian.net/browse/ACME-160',
    labels: ['ux', 'persona'],
    linked: [
      { kind: 'spec', id: 'SPEC-052', label: 'Persona-driven shell' },
      { kind: 'file', id: 'src/persona/detect.ts' },
    ],
    aiSuggestedPhases: ['discovery', 'planning', 'execution', 'verification'],
    estimatedComplexity: 'medium',
    similarTicketAvgDays: 2.1,
    lastTouchedAt: '2026-06-23T15:48:00Z',
  },
];

export function ticketById(id: string): Ticket | undefined {
  return SAMPLE_TICKETS.find(
    (t) => t.id.toLowerCase() === id.toLowerCase(),
  );
}

/* ---------------------------------------------------------------------------
 * Specs
 * ------------------------------------------------------------------------- */

export type SpecStatus =
  | 'drafting'
  | 'planning'
  | 'executing'
  | 'completed'
  | 'archived';

export interface SpecPhaseRun {
  readonly phase: ForgePhase;
  readonly status: 'pending' | 'in-progress' | 'completed' | 'skipped';
  readonly durationSec?: number;
  readonly artifacts: number;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface SpecRequirement {
  readonly id: string;
  readonly text: string;
  readonly kind: 'functional' | 'non-functional';
  readonly done: boolean;
}

export interface SpecHistoryEntry {
  readonly version: string;
  readonly at: string;
  readonly author: string;
  readonly summary: string;
}

export interface Spec {
  readonly id: string;
  readonly title: string;
  readonly problem: string;
  readonly goals: ReadonlyArray<string>;
  readonly status: SpecStatus;
  readonly progress: number; // 0-100
  readonly phases: ReadonlyArray<SpecPhaseRun>;
  readonly requirements: ReadonlyArray<SpecRequirement>;
  readonly linkedAdrs: ReadonlyArray<string>;
  readonly relatedSpecs: ReadonlyArray<string>;
  readonly history: ReadonlyArray<SpecHistoryEntry>;
  readonly source: 'idea' | 'ticket' | 'template' | 'blank';
  readonly updatedAt: string;
}

export const SAMPLE_SPECS: ReadonlyArray<Spec> = [
  {
    id: 'SPEC-041',
    title: 'Mobile auth refactor (PKCE + rotation)',
    problem:
      'Legacy password grant is unsafe on mobile. We need PKCE with refresh-token rotation, idempotent retries, and offline-tolerant expiry handling.',
    goals: [
      'Eliminate password grant from mobile clients',
      'Refresh tokens rotate on every use with 60s skew',
      'Zero-downtime migration path for existing tokens',
    ],
    status: 'executing',
    progress: 64,
    source: 'ticket',
    updatedAt: '2026-06-26T08:42:00Z',
    phases: [
      { phase: 'discovery', status: 'completed', durationSec: 1240, artifacts: 2, finishedAt: '2026-06-24T10:00:00Z' },
      { phase: 'planning', status: 'completed', durationSec: 1880, artifacts: 1, finishedAt: '2026-06-24T16:00:00Z' },
      { phase: 'execution', status: 'in-progress', durationSec: 5400, artifacts: 7, startedAt: '2026-06-25T09:00:00Z' },
      { phase: 'verification', status: 'pending', artifacts: 0 },
      { phase: 'deployment', status: 'pending', artifacts: 0 },
      { phase: 'audit', status: 'pending', artifacts: 0 },
    ],
    requirements: [
      { id: 'FR-1', text: 'PKCE flow for all mobile clients', kind: 'functional', done: true },
      { id: 'FR-2', text: 'Refresh-token rotation on every use', kind: 'functional', done: true },
      { id: 'FR-3', text: 'Idempotent /token endpoint', kind: 'functional', done: false },
      { id: 'NFR-1', text: 'p99 token exchange < 200ms', kind: 'non-functional', done: false },
      { id: 'NFR-2', text: 'Offline token expiry tolerance ≥ 12h', kind: 'non-functional', done: false },
    ],
    linkedAdrs: ['ADR-005', 'ADR-009'],
    relatedSpecs: ['SPEC-028'],
    history: [
      { version: '0.4', at: '2026-06-25T09:00:00Z', author: 'forge-execute-phase', summary: 'Started execution phase; auth/oauth.ts scaffolded.' },
      { version: '0.3', at: '2026-06-24T16:00:00Z', author: 'forge-plan-phase', summary: 'Plan committed: 7 sub-tasks, 3 dependencies.' },
      { version: '0.2', at: '2026-06-24T10:00:00Z', author: 'forge-spike', summary: 'Spike doc accepted. PKCE + rotation chosen.' },
      { version: '0.1', at: '2026-06-23T17:14:00Z', author: 'A. Reyes', summary: 'Draft from ACME-123.' },
    ],
  },
  {
    id: 'SPEC-052',
    title: 'Persona-driven shell',
    problem:
      'First-run users see every module regardless of role, which dilutes the value of persona-aware defaults. We need to detect persona during onboarding and reshape the shell.',
    goals: [
      'Detect persona within first 60s',
      'Reshape sidebar + command center by persona',
      'Always preserve user override',
    ],
    status: 'planning',
    progress: 22,
    source: 'idea',
    updatedAt: '2026-06-24T13:00:00Z',
    phases: [
      { phase: 'discovery', status: 'completed', durationSec: 920, artifacts: 1, finishedAt: '2026-06-22T11:00:00Z' },
      { phase: 'planning', status: 'in-progress', durationSec: 600, artifacts: 1, startedAt: '2026-06-24T12:00:00Z' },
      { phase: 'execution', status: 'pending', artifacts: 0 },
      { phase: 'verification', status: 'pending', artifacts: 0 },
      { phase: 'deployment', status: 'pending', artifacts: 0 },
    ],
    requirements: [
      { id: 'FR-1', text: 'Persona detection in onboarding', kind: 'functional', done: true },
      { id: 'FR-2', text: 'Override persisted across sessions', kind: 'functional', done: false },
      { id: 'NFR-1', text: 'Detection p95 < 200ms', kind: 'non-functional', done: false },
    ],
    linkedAdrs: ['ADR-014'],
    relatedSpecs: [],
    history: [
      { version: '0.2', at: '2026-06-24T12:00:00Z', author: 'forge-plan-phase', summary: 'Plan in progress.' },
      { version: '0.1', at: '2026-06-22T11:00:00Z', author: 'T. Chen', summary: 'Draft from IDEA-118.' },
    ],
  },
  {
    id: 'SPEC-061',
    title: 'Runs cleanup cron (stale-record audit)',
    problem:
      'Run rows occasionally stay in "running" past their TTL when an agent crashes mid-flight. We need a daily audit that detects and archives these.',
    goals: [
      'Detect runs older than 30d still flagged "running"',
      'Archive with audit trail + tenant correlation',
      'Re-runnable from the audit timeline',
    ],
    status: 'completed',
    progress: 100,
    source: 'ticket',
    updatedAt: '2026-06-20T09:00:00Z',
    phases: [
      { phase: 'planning', status: 'completed', durationSec: 320, artifacts: 1, finishedAt: '2026-06-19T09:00:00Z' },
      { phase: 'execution', status: 'completed', durationSec: 980, artifacts: 3, finishedAt: '2026-06-19T15:00:00Z' },
      { phase: 'verification', status: 'completed', durationSec: 220, artifacts: 1, finishedAt: '2026-06-19T18:00:00Z' },
      { phase: 'deployment', status: 'completed', durationSec: 240, artifacts: 1, finishedAt: '2026-06-20T09:00:00Z' },
    ],
    requirements: [
      { id: 'FR-1', text: 'Cron runs at 03:00 UTC', kind: 'functional', done: true },
      { id: 'FR-2', text: 'Stale records archived with reason', kind: 'functional', done: true },
    ],
    linkedAdrs: [],
    relatedSpecs: [],
    history: [
      { version: '1.0', at: '2026-06-20T09:00:00Z', author: 'forge-deploy', summary: 'Shipped to prod.' },
    ],
  },
];

export function specById(id: string): Spec | undefined {
  return SAMPLE_SPECS.find((s) => s.id === id);
}

/* ---------------------------------------------------------------------------
 * Runs + Approvals + Recent Artifacts (for My Work drawer)
 * ------------------------------------------------------------------------- */

export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled';

export interface LiveRun {
  readonly id: string;
  readonly skillId: string;
  readonly ticketId?: string;
  readonly specId?: string;
  readonly status: RunStatus;
  readonly progress: number; // 0-100
  readonly startedAgo: string;
  readonly duration: string;
  readonly actor: string;
}

export const SAMPLE_LIVE_RUNS: ReadonlyArray<LiveRun> = [
  {
    id: 'run-9181',
    skillId: 'forge-execute-phase',
    ticketId: 'ACME-123',
    specId: 'SPEC-041',
    status: 'running',
    progress: 72,
    startedAgo: '3m ago',
    duration: '8m 12s',
    actor: 'A. Reyes',
  },
  {
    id: 'run-9179',
    skillId: 'forge-add-tests',
    ticketId: 'ACME-123',
    status: 'running',
    progress: 38,
    startedAgo: '1m ago',
    duration: '2m 04s',
    actor: 'A. Reyes',
  },
  {
    id: 'run-9174',
    skillId: 'forge-plan-phase',
    specId: 'SPEC-052',
    status: 'success',
    progress: 100,
    startedAgo: '12m ago',
    duration: '5m 28s',
    actor: 'T. Chen',
  },
  {
    id: 'run-9170',
    skillId: 'forge-verify-phase',
    ticketId: 'ACME-141',
    status: 'queued',
    progress: 0,
    startedAgo: 'queued',
    duration: '—',
    actor: 'J. Park',
  },
];

export interface ApprovalItem {
  readonly id: string;
  readonly kind: 'spec-execution' | 'deployment' | 'adr' | 'audit';
  readonly title: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly blocking: boolean;
}

export const SAMPLE_APPROVALS: ReadonlyArray<ApprovalItem> = [
  {
    id: 'apr-1',
    kind: 'spec-execution',
    title: 'Start execution for SPEC-041',
    requestedBy: 'forge-plan-phase',
    requestedAt: '2026-06-25T09:00:00Z',
    blocking: true,
  },
  {
    id: 'apr-2',
    kind: 'deployment',
    title: 'Deploy SPEC-061 cron to prod',
    requestedBy: 'forge-deploy',
    requestedAt: '2026-06-20T08:45:00Z',
    blocking: false,
  },
];

export interface RecentArtifact {
  readonly id: string;
  readonly kind: 'pr' | 'adr' | 'doc' | 'spec' | 'decision';
  readonly title: string;
  readonly subtitle: string;
  readonly at: string;
}

export const SAMPLE_RECENT_ARTIFACTS: ReadonlyArray<RecentArtifact> = [
  {
    id: 'art-1',
    kind: 'pr',
    title: 'feat(auth): PKCE flow + refresh rotation',
    subtitle: 'PR #1142 · 4 files · ready for review',
    at: '2026-06-26T08:10:00Z',
  },
  {
    id: 'art-2',
    kind: 'adr',
    title: 'ADR-005: Auth — OIDC migration',
    subtitle: 'Accepted · 3 options considered',
    at: '2026-06-24T10:00:00Z',
  },
  {
    id: 'art-3',
    kind: 'spec',
    title: 'SPEC-052 v0.2 — Plan committed',
    subtitle: '7 sub-tasks · 3 dependencies',
    at: '2026-06-24T13:00:00Z',
  },
];

/* ---------------------------------------------------------------------------
 * AI Suggestions (the "wow under the wow")
 * ------------------------------------------------------------------------- */

export interface AISuggestion {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly primary: { readonly label: string; readonly skillId?: string };
  readonly secondary?: { readonly label: string };
  readonly confidence: number; // 0-1
}

export const SAMPLE_AI_SUGGESTIONS: ReadonlyArray<AISuggestion> = [
  {
    id: 'sug-1',
    title: 'You typically start with forge-spike',
    body: '4 of your last 5 medium-complexity tickets started with a 15-minute spike. Estimated time saved: 2h.',
    primary: { label: 'Start spike', skillId: 'forge-spike' },
    secondary: { label: 'Skip and plan' },
    confidence: 0.86,
  },
  {
    id: 'sug-2',
    title: 'Reference ADR-005 for API design',
    body: 'This ticket touches auth — ADR-005 (OIDC migration) is the canonical reference and lists three patterns you should follow.',
    primary: { label: 'Open ADR-005' },
    confidence: 0.94,
  },
  {
    id: 'sug-3',
    title: 'Add an NFR for token-exchange latency',
    body: 'No p99 target captured yet. Historical baseline is 180ms; we recommend setting NFR ≤ 200ms.',
    primary: { label: 'Add NFR' },
    confidence: 0.78,
  },
  {
    id: 'sug-4',
    title: 'Three teammates on related tickets',
    body: 'A. Reyes (ACME-123), M. Okafor (ACME-141), T. Chen (ACME-160) are all working in src/auth. Coordinate?',
    primary: { label: 'Open in Runs' },
    secondary: { label: 'Dismiss' },
    confidence: 0.71,
  },
];
