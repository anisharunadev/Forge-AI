/**
 * useForgeFixtures — Inline fixture data for governance surfaces that
 * do not yet have a real backend endpoint (Rule 8 — Configurable
 * Everything + step-59 Zone 9 cleanup).
 *
 * These shapes mirror the typed artifacts historically defined in
 * `lib/governance/data.ts`. They are intentionally local to the
 * components that consume them (RBAC roles, board confirmation
 * history) so we can keep the existing visual contracts without
 * pulling in a now-stale mock layer.
 *
 * Once `/v1/governance/rbac-roles` and
 * `/v1/governance/board-confirmations` ship on the backend, these
 * constants should be removed and the components wired to TanStack
 * Query hooks (mirroring `useGuardrails` / `useStandards`).
 */

import type { Ticket, Spec } from '@/lib/command-center/sample-data';

// ---------------------------------------------------------------------------
// Typed shapes (mirrors the historical lib/governance/data.ts exports)
// ---------------------------------------------------------------------------

export type ApprovalKind =
  | 'request_confirmation'
  | 'request_checkbox_confirmation'
  | 'ask_user_questions'
  | 'suggest_tasks';

export type ApprovalState =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'superseded';

export interface ApprovalRequest {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly title: string;
  readonly prompt: string;
  readonly state: ApprovalState;
  readonly createdAt: string;
  readonly decider?: { readonly displayName: string; readonly id: string };
  readonly decidedAt?: string;
  readonly reason?: string;
  readonly options?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description?: string;
  }>;
  readonly idempotencyKey?: string;
}

export interface RbacRole {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions: ReadonlyArray<{
    readonly resource: string;
    readonly actions: ReadonlyArray<string>;
  }>;
  readonly memberCount: number;
  readonly system: boolean;
  readonly updatedAt: string;
}

export interface BoardConfirmation {
  readonly id: string;
  readonly subject: { readonly identifier: string; readonly id: string };
  readonly planRev: string;
  readonly outcome: 'accepted' | 'declined' | 'pending';
  readonly decider?: { readonly displayName: string; readonly id: string };
  readonly decidedAt?: string;
  readonly reason?: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
}

export type RbacToken =
  | { readonly kind: 'board'; readonly displayName: string; readonly id: string }
  | { readonly kind: 'agent'; readonly displayName: string; readonly id: string; readonly role: string }
  | { readonly kind: 'user'; readonly displayName: string; readonly id: string };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Pending approval requests (legacy mock shape). */
export const FIXTURE_PENDING_APPROVALS: ReadonlyArray<ApprovalRequest> = [
  {
    id: 'apr-001',
    kind: 'request_confirmation',
    title: 'Confirm tenant onboarding runbook',
    prompt:
      'Apply the acme-corp onboarding runbook to seed connectors, models, and default policies.',
    state: 'pending',
    createdAt: '2026-06-28 09:14',
  },
  {
    id: 'apr-002',
    kind: 'ask_user_questions',
    title: 'Clarify data residency requirement',
    prompt:
      'Choose EU-only or US-only data residency for the new regional LiteLLM key.',
    state: 'pending',
    createdAt: '2026-06-28 10:02',
  },
];

/** RBAC roles viewer (legacy mock shape). */
export const FIXTURE_RBAC_ROLES: ReadonlyArray<RbacRole> = [
  {
    id: 'role-owner',
    name: 'Owner',
    description: 'Full administrative access including billing and tenant deletion.',
    permissions: [
      { resource: 'tenant', actions: ['read', 'write', 'delete'] },
      { resource: 'members', actions: ['read', 'write', 'invite'] },
      { resource: 'keys', actions: ['read', 'write', 'rotate', 'revoke'] },
      { resource: 'policies', actions: ['read', 'write', 'archive'] },
    ],
    memberCount: 2,
    system: true,
    updatedAt: '2026-06-20',
  },
  {
    id: 'role-admin',
    name: 'Admin',
    description: 'Manage members, policies, and integrations. Cannot delete tenant.',
    permissions: [
      { resource: 'members', actions: ['read', 'write', 'invite'] },
      { resource: 'keys', actions: ['read', 'write', 'rotate'] },
      { resource: 'policies', actions: ['read', 'write'] },
    ],
    memberCount: 4,
    system: true,
    updatedAt: '2026-06-20',
  },
  {
    id: 'role-editor',
    name: 'Editor',
    description: 'Author policies, standards, and stories. Read-only on billing.',
    permissions: [
      { resource: 'policies', actions: ['read', 'write'] },
      { resource: 'stories', actions: ['read', 'write'] },
    ],
    memberCount: 7,
    system: true,
    updatedAt: '2026-06-20',
  },
  {
    id: 'role-viewer',
    name: 'Viewer',
    description: 'Read-only access across the Governance Center.',
    permissions: [{ resource: 'policies', actions: ['read'] }],
    memberCount: 12,
    system: true,
    updatedAt: '2026-06-20',
  },
  {
    id: 'role-custom-sec',
    name: 'Custom · Security',
    description: 'Security team custom role for audit + standards authoring.',
    permissions: [
      { resource: 'audit', actions: ['read'] },
      { resource: 'standards', actions: ['read', 'write'] },
    ],
    memberCount: 3,
    system: false,
    updatedAt: '2026-06-22',
  },
];

/** Board confirmation history (legacy mock shape). */
export const FIXTURE_BOARD_CONFIRMATIONS: ReadonlyArray<BoardConfirmation> = [
  {
    id: 'bc-001',
    subject: { id: 'plan-2026-q2', identifier: 'plan-2026-q2 · rollout' },
    planRev: 'rev-12',
    outcome: 'accepted',
    decider: { displayName: 'Jane CTO', id: 'u-cto' },
    decidedAt: '2026-06-27 16:42',
    idempotencyKey: 'idem-bc-001',
    prompt: 'Accept plan-2026-q2 rollout for acme-corp.',
  },
  {
    id: 'bc-002',
    subject: { id: 'adr-042', identifier: 'adr-042 · LLM gateway migration' },
    planRev: 'rev-08',
    outcome: 'accepted',
    decider: { displayName: 'Eng Lead', id: 'u-englead' },
    decidedAt: '2026-06-26 11:05',
    idempotencyKey: 'idem-bc-002',
    prompt: 'Accept ADR-042 LiteLLM gateway migration for production tenants.',
  },
  {
    id: 'bc-003',
    subject: { id: 'policy-09', identifier: 'policy-09 · spend cap' },
    planRev: 'rev-04',
    outcome: 'declined',
    decider: { displayName: 'Jane CTO', id: 'u-cto' },
    decidedAt: '2026-06-25 09:30',
    reason: 'Spend cap is too aggressive for Q3 forecast.',
    idempotencyKey: 'idem-bc-003',
    prompt: 'Apply $4k/day spend cap to all teams.',
  },
  {
    id: 'bc-004',
    subject: { id: 'plan-2026-q3', identifier: 'plan-2026-q3 · drafting' },
    planRev: 'rev-01',
    outcome: 'pending',
    idempotencyKey: 'idem-bc-004',
    prompt: 'Approve Q3 plan for synthesis.',
  },
];

/** Read the active Board token for a persona (legacy mock helper). */
export function readBoardTokenForPersona(persona: string): RbacToken | undefined {
  if (persona === 'cto' || persona === 'vp-eng') {
    return { kind: 'user', displayName: 'Jane CTO', id: 'u-cto' };
  }
  if (persona === 'eng-lead') {
    return { kind: 'user', displayName: 'Eng Lead', id: 'u-englead' };
  }
  return undefined;
}

/** Returns a static Board token (legacy mock helper). */
export function boardTokenPresent(): RbacToken {
  return { kind: 'board', displayName: 'Board', id: 'board-token' };
}

// ---------------------------------------------------------------------------
// Track K (Day 2) — Command Center placeholder hooks
// ---------------------------------------------------------------------------

/**
 * useTickets — placeholder hook for Command Center tickets.
 *
 * The general `/v1/tickets` endpoint does not exist yet (the audit
 * flagged it as `NEEDS_BACKEND_IMPL`); tickets currently live under
 * `/v1/connectors/{id}/history`. Returning `[]` keeps the existing
 * UI contract intact and surfaces an explicit empty state with a
 * "Backend integration pending" message.
 *
 * Once Day 3+ ships `GET /v1/tickets`, swap the body for a real
 * TanStack `useQuery` against that endpoint and keep the return type.
 */
export function useTickets(_opts: { project_id?: string } = {}): {
  data: ReadonlyArray<Ticket>;
  isLoading: boolean;
} {
  // ponytail: returns empty array until tickets endpoint lands (Day 3+)
  return { data: [], isLoading: false };
}

/**
 * useSpecs — placeholder hook for Command Center specs.
 *
 * Same status as `useTickets` above. Day 3+ will add `GET /v1/specs`.
 */
export function useSpecs(_opts: { project_id?: string } = {}): {
  data: ReadonlyArray<Spec>;
  isLoading: boolean;
} {
  // ponytail: returns empty array until specs endpoint lands (Day 3+)
  return { data: [], isLoading: false };
}