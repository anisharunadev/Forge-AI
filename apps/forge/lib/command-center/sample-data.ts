// ponytail: still imported by tests/legacy — remove after Day 8 dead-code sweep
/**
 * Sample data for the Command Center rebuild.
 *
 * Every fixture here is a typed artifact (Rule 4). No free-form blobs.
 * Real data will flow through Connectors (Step 31) and the project
 * intelligence layer; the shape stays stable so the swap is trivial.
 *
 * Track K (Day 2): these arrays are now `@deprecated` — consumers should
 * use the equivalent TanStack Query hooks (`useLiveRuns`, `useTickets`,
 * `useSpecs`). The shapes below stay identical to keep TypeScript happy
 * in the few code-paths still consuming them.
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

/**
 * @deprecated Track K (Day 2): use the `useTickets` hook in
 * `lib/hooks/useForgeFixtures.ts` instead. The backend ticket endpoint
 * does not yet exist (Day 3+); the hook returns `[]` and renders an
 * explicit "Backend integration pending" empty state.
 */
// ponytail: emptied in Day 4 — ticketById still exists for the one caller in TicketMode.tsx but always returns undefined now
export const SAMPLE_TICKETS: ReadonlyArray<Ticket> = [];

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

/**
 * @deprecated Track K (Day 2): use the `useSpecs` hook in
 * `lib/hooks/useForgeFixtures.ts` instead. The backend specs endpoint
 * does not yet exist (Day 3+); the hook returns `[]` and renders an
 * explicit "Backend integration pending" empty state.
 */
// ponytail: emptied in Day 4 — specById had 0 callers, deleted with the body
export const SAMPLE_SPECS: ReadonlyArray<Spec> = [];

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

/**
 * @deprecated Track K (Day 2): use the `useLiveRuns` hook in
 * `lib/hooks/useRuns.ts` instead (backed by the real
 * `GET /api/v1/workflows/runs` endpoint — see `useWorkflowRunsIndex`).
 */
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

/**
 * @deprecated Track K (Day 2): My Work drawer renders an explicit
 * empty state for approvals; replace with `useIdeationApprovals()` once
 * the column-card behaviour is wired up.
 */
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

/**
 * @deprecated Track K (Day 2): My Work drawer renders an empty state;
 * replace with the audit-events adapter (`lib/architecture/adapters.ts`)
 * once activity is wired up.
 */
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

/**
 * @deprecated Track K (Day 2): Spec side panel renders an empty state;
 * AI suggestions come from the runtime orchestrator in a later step.
 */
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
