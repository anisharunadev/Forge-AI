/**
 * The eight Orchestrator gates — typed, exhaustive.
 *
 * Source of truth: [FORA-50 spec §6.1](/FORA/issues/FORA-50#document-spec) and
 * [ADR-0008 §3](/FORA/docs/architecture/adr-0008-paperclip-approvals.md).
 *
 * The gate table is a one-way door. Adding a gate, changing the role of
 * record, or changing the TTL all require an ADR per architecture.md §5.
 * The eval test in `test/gates.test.ts` asserts every (gate → role) pair
 * so a drift between the spec and the code fails loud.
 *
 * The seven stage transitions + the customer-facing launch gate. The
 * customer-facing launch gate is the only `board` gate; all others are
 * per-stage `request_confirmation` interactions.
 */

import type { Stage } from './types.js';

/** The seven stage transitions, ordered. */
export type StageTransition =
  | 'ideation->architect'
  | 'architect->dev'
  | 'dev->qa'
  | 'qa->security'
  | 'security->devops'
  | 'devops->docs'
  | 'docs->done';

/**
 * The customer-facing launch gate. The role of record is `board`; the
 * approver is the board; the primitive is `request_board_approval`;
 * the continuation policy is `wake_assignee_on_accept` (we resume only
 * on accept because the rejection path is terminal for the run).
 */
export type LaunchGate = 'launch';

/** All eight gates. */
export type GateKind = StageTransition | LaunchGate;

/**
 * Role of record — the role the approver must hold, not the person. A
 * future CTO hire satisfies the `cto` gate as long as Paperclip has them
 * in that role. The enum matches `agent_run_approvals.required_role`
 * (rev 2 normalised — no `_owner` suffix).
 */
export type RoleOfRecord =
  | 'product'
  | 'cto'
  | 'qa'
  | 'security'
  | 'devops'
  | 'docs'
  | 'board';

/**
 * TTL tier. Per ADR-0008 §3 the board gate and the product gate are
 * 24 h; CEO/CTO are 4 h; engineering roles are 1 h (FORA-50 spec §6
 * §6.1 default). A single source of truth keeps the table from drifting
 * from the sweeper (sweeper.ts).
 */
export type TtlTier = 'board_24h' | 'cto_4h' | 'engineering_1h';

/**
 * Per-stage approver description (human-readable, not enforced). The
 * enforcement is in Paperclip's role membership; the router only needs
 * to set the right `required_role` and `target` so Paperclip routes the
 * card to the right inbox.
 */
export type Approver =
  | 'CEO or Product'
  | 'CTO'
  | 'Dev owner (CODEOWNERS)'
  | 'QA lead'
  | 'Security lead'
  | 'DevOps lead'
  | 'Doc lead'
  | 'Board';

/** Paperclip primitive. */
export type PaperclipPrimitive = 'request_confirmation' | 'request_board_approval';

/** Continuation policy (Paperclip wake semantics). */
export type ContinuationPolicy = 'wake_assignee' | 'wake_assignee_on_accept';

/** Tier for escalation when the primary approver is unreachable. */
export type EscalationTarget = 'cto' | 'board' | 'none';

export interface GateDefinition {
  readonly kind: GateKind;
  /** The originating stage (undefined for the launch gate). */
  readonly from: Stage | null;
  /** The next stage (undefined for the launch gate). */
  readonly to: Stage | null;
  readonly required_role: RoleOfRecord;
  readonly approver: Approver;
  readonly ttl: TtlTier;
  readonly escalation: EscalationTarget;
  readonly primitive: PaperclipPrimitive;
  readonly continuation: ContinuationPolicy;
}

/** TTL in milliseconds, derived from the tier. The sweeper uses this. */
export function ttlMs(tier: TtlTier): number {
  switch (tier) {
    case 'board_24h':
      return 24 * 60 * 60 * 1000;
    case 'cto_4h':
      return 4 * 60 * 60 * 1000;
    case 'engineering_1h':
      return 60 * 60 * 1000;
  }
}

/**
 * True iff the tier is a "page the approver at 50% TTL" tier. The
 * default TTL policy (FORA-50 §6.1) is 50%-paging for all gates;
 * the constant is here so a future tier that doesn't page (e.g. a
 * fully automated gate) can opt out without surgery.
 */
export function pagesAt50Percent(tier: TtlTier): boolean {
  // Today every tier pages at 50%; the constant exists for the
  // future automated tier referenced in ADR-0008 §11.
  return true;
}

/**
 * The eight gates, in the order they appear in the spec table. The
 * iteration order is the public order so test snapshots and audit
 * logs read top-to-bottom matching the spec.
 */
export const GATES: ReadonlyArray<GateDefinition> = [
  {
    kind: 'ideation->architect',
    from: 'ideation',
    to: 'architect',
    required_role: 'product',
    approver: 'CEO or Product',
    ttl: 'board_24h',
    escalation: 'board',
    primitive: 'request_confirmation',
    continuation: 'wake_assignee',
  },
  {
    kind: 'architect->dev',
    from: 'architect',
    to: 'dev',
    required_role: 'cto',
    approver: 'CTO',
    ttl: 'cto_4h',
    escalation: 'board',
    primitive: 'request_confirmation',
    continuation: 'wake_assignee',
  },
  {
    kind: 'dev->qa',
    from: 'dev',
    to: 'qa',
    required_role: 'qa',
    approver: 'Dev owner (CODEOWNERS)',
    ttl: 'engineering_1h',
    escalation: 'cto',
    primitive: 'request_confirmation',
    continuation: 'wake_assignee',
  },
  {
    kind: 'qa->security',
    from: 'qa',
    to: 'security',
    required_role: 'security',
    approver: 'QA lead',
    ttl: 'engineering_1h',
    escalation: 'cto',
    primitive: 'request_confirmation',
    continuation: 'wake_assignee',
  },
  {
    kind: 'security->devops',
    from: 'security',
    to: 'devops',
    required_role: 'devops',
    approver: 'Security lead',
    ttl: 'engineering_1h',
    escalation: 'cto',
    primitive: 'request_confirmation',
    continuation: 'wake_assignee',
  },
  {
    kind: 'devops->docs',
    from: 'devops',
    to: 'docs',
    required_role: 'docs',
    approver: 'DevOps lead',
    ttl: 'engineering_1h',
    escalation: 'cto',
    primitive: 'request_confirmation',
    continuation: 'wake_assignee',
  },
  {
    kind: 'docs->done',
    from: 'docs',
    to: null,
    required_role: 'docs',
    approver: 'Doc lead',
    ttl: 'engineering_1h',
    escalation: 'cto',
    primitive: 'request_confirmation',
    continuation: 'wake_assignee',
  },
  {
    kind: 'launch',
    from: null,
    to: null,
    required_role: 'board',
    approver: 'Board',
    ttl: 'board_24h',
    escalation: 'none',
    primitive: 'request_board_approval',
    continuation: 'wake_assignee_on_accept',
  },
];

/** Look up a gate definition by kind. Returns `null` on miss. */
export function findGate(kind: GateKind): GateDefinition | null {
  return GATES.find((g) => g.kind === kind) ?? null;
}

/** True iff `from → to` is the gate `kind`. Convenience for the engine. */
export function isStageTransition(
  kind: GateKind,
  from: Stage,
  to: Stage | 'done',
): boolean {
  const gate = findGate(kind);
  if (!gate) return false;
  // docs->done is the special "stage null" gate — the run advances to
  // the `done` run status, not to another stage column.
  if (to === 'done') {
    return gate.from === from && gate.to === null;
  }
  return gate.from === from && gate.to === to;
}

/**
 * The full table is also exposed as a typed map keyed by kind for O(1)
 * lookups by callers that already know the gate. The map is built from
 * the array so the two stay in lockstep.
 */
export const GATE_BY_KIND: Readonly<Record<GateKind, GateDefinition>> =
  Object.freeze(
    GATES.reduce<Record<string, GateDefinition>>((acc, g) => {
      acc[g.kind] = g;
      return acc;
    }, {}),
  ) as Readonly<Record<GateKind, GateDefinition>>;
