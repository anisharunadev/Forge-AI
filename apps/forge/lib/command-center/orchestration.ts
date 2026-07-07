/**
 * Cross-module orchestration — the "conductor pattern" from step-34.
 *
 * Each GSD phase, when it runs, automatically triggers a downstream
 * Forge module. The mapping is the single source of truth so the
 * PhaseExecutionDrawer activity rail, the TicketMode analysis card, and
 * the FloatingPhaseWidget all show a coherent story.
 *
 * Mock today — every `trigger` appends an OrchestrationEvent after a
 * realistic delay. Real wiring (Step 32+) routes through the backend
 * orchestrator and Redis Pub/Sub → SSE; the public API stays stable.
 */

import type { ForgePhase } from '../forge-core/manifest';
import type { Ticket } from './sample-data';
import type { OrchestrationEvent, OrchestrationEventKind } from './store';

/* ---------------------------------------------------------------------------
 * Phase → module mapping. Each phase declares which Forge module it
 * triggers, with a target URL, an actor label, and a list of event
 * templates fired during the run.
 * ------------------------------------------------------------------------- */

export interface OrchestrationTrigger {
  readonly phase: ForgePhase;
  readonly targetModule: string;
  readonly targetHref: string;
  readonly actor: string;
  readonly events: ReadonlyArray<{
    readonly kind: OrchestrationEventKind;
    readonly body: string;
    readonly delayMs: number;
    readonly href?: string;
  }>;
}

export const PHASE_ORCHESTRATION: Record<ForgePhase, OrchestrationTrigger> = {
  discovery: {
    phase: 'discovery',
    targetModule: 'Ideation Center',
    targetHref: '/ideation',
    actor: 'ideation-agent',
    events: [
      { kind: 'agent-invoked', body: 'Ideation agent captured problem context', delayMs: 600 },
      { kind: 'reasoning', body: 'Surfaced 3 unknowns in the auth flow', delayMs: 1800 },
      { kind: 'spec-linked', body: 'Linked spike doc to ADR-005', delayMs: 3500, href: '/architecture' },
    ],
  },
  planning: {
    phase: 'planning',
    targetModule: 'Stories',
    targetHref: '/project-intelligence',
    actor: 'stories-agent',
    events: [
      { kind: 'agent-invoked', body: 'Stories agent decomposed spec into tasks', delayMs: 500 },
      { kind: 'reasoning', body: 'Estimated 7 sub-tasks · 3 dependencies', delayMs: 1500 },
      { kind: 'file-changed', body: 'SPEC-041 v0.3 — plan committed', delayMs: 3000, href: '/forge-command-center?mode=spec' },
    ],
  },
  execution: {
    phase: 'execution',
    targetModule: 'Claude Code Terminal',
    targetHref: '/forge-terminal',
    actor: 'claude-code',
    events: [
      { kind: 'agent-invoked', body: 'Claude Code session opened with full context', delayMs: 700, href: '/forge-terminal' },
      { kind: 'file-changed', body: 'src/auth/oauth.ts modified (+142/-18)', delayMs: 2400 },
      { kind: 'file-changed', body: 'src/auth/refresh.ts modified (+58/-22)', delayMs: 5200 },
      { kind: 'connector-call', body: 'GitHub: opened PR #1142', delayMs: 9800, href: 'https://github.com/acme/forge-core/pull/1142' },
      { kind: 'pr-opened', body: 'PR #1142 ready for review', delayMs: 11000, href: 'https://github.com/acme/forge-core/pull/1142' },
    ],
  },
  verification: {
    phase: 'verification',
    targetModule: 'Test Runner',
    targetHref: '/runs',
    actor: 'test-runner',
    events: [
      { kind: 'agent-invoked', body: 'Test Runner invoked for SPEC-041', delayMs: 400 },
      { kind: 'file-changed', body: 'Ran 84 tests · 82 passed · 2 skipped', delayMs: 2200 },
      { kind: 'reasoning', body: 'p99 token exchange: 178ms (NFR ≤ 200ms)', delayMs: 3200 },
    ],
  },
  deployment: {
    phase: 'deployment',
    targetModule: 'Deploy workflow',
    targetHref: '/workflow',
    actor: 'forge-deploy',
    events: [
      { kind: 'agent-invoked', body: 'Deploy workflow started (canary 5%)', delayMs: 800 },
      { kind: 'reasoning', body: 'Health check: 200 OK · p95 stable', delayMs: 3500 },
      { kind: 'ticket-status', body: 'ACME-123 → In Progress', delayMs: 5800, href: 'https://acme.atlassian.net/browse/ACME-123' },
      { kind: 'connector-call', body: 'Jira: comment posted on ACME-123', delayMs: 6500 },
    ],
  },
  audit: {
    phase: 'audit',
    targetModule: 'Audit',
    targetHref: '/audit',
    actor: 'code-reviewer',
    events: [
      { kind: 'agent-invoked', body: 'Code-Reviewer agent scanning diff', delayMs: 600 },
      { kind: 'reasoning', body: 'No standards violations detected', delayMs: 3200 },
      { kind: 'file-changed', body: 'Audit report appended to timeline', delayMs: 5400, href: '/audit' },
    ],
  },
  maintenance: {
    phase: 'maintenance',
    targetModule: 'Doc generator',
    targetHref: '/governance-center',
    actor: 'doc-generator',
    events: [
      { kind: 'agent-invoked', body: 'Doc generator invoked', delayMs: 800 },
      { kind: 'file-changed', body: 'Updated runbook + changelog', delayMs: 2400 },
    ],
  },
};

/* ---------------------------------------------------------------------------
 * Mock phase execution timing — Step-34 spec calls out specific durations
 * so the panel feels realistic.
 * ------------------------------------------------------------------------- */
export const PHASE_EXECUTION_MS: Record<ForgePhase, number> = {
  discovery: 8_000,
  planning: 5_000,
  execution: 15_000,
  verification: 4_000,
  deployment: 8_000,
  audit: 6_000,
  maintenance: 3_000,
};

/* ---------------------------------------------------------------------------
 * Per-phase workspace labels — drives the PhaseExecutionDrawer body.
 * ------------------------------------------------------------------------- */
export const PHASE_WORKSPACE_LABEL: Record<ForgePhase, string> = {
  discovery: 'Research question',
  planning: 'Acceptance criteria',
  execution: 'Implementation notes',
  verification: 'Verification scope',
  deployment: 'Deployment plan',
  audit: 'Audit checklist',
  maintenance: 'Maintenance notes',
};

/* ---------------------------------------------------------------------------
 * Helper: schedule orchestration events for a phase. Returns a cleanup
 * function that cancels all pending timers (call on phase cancel/unmount).
 * ------------------------------------------------------------------------- */
export function scheduleOrchestration(
  phase: ForgePhase,
  ticket: Ticket | undefined,
  pushEvent: (e: Omit<OrchestrationEvent, 'id' | 'at'>) => void,
): () => void {
  const trigger = PHASE_ORCHESTRATION[phase];
  const handles: ReturnType<typeof setTimeout>[] = [];
  for (const e of trigger.events) {
    handles.push(
      setTimeout(() => {
        pushEvent({
          phase,
          kind: e.kind,
          body: e.body,
          actor: trigger.actor,
          ticketId: ticket?.id,
          href: e.href,
        });
      }, e.delayMs),
    );
  }
  return () => handles.forEach((h) => clearTimeout(h));
}

/* ---------------------------------------------------------------------------
 * Ponytail (Day 4): deleted the "Forge it ⚡" mock ticket fetcher
 * (`matchTicketByDraft` + `TICKET_FETCH_STEPS` + `TicketFetchStep`) — 0
 * callers, and it would have thrown on empty SAMPLE_TICKETS anyway.
 * PhaseExecutionDrawer already passes the resolved Ticket into
 * `scheduleOrchestration` directly.
 * ------------------------------------------------------------------------- */
