/**
 * Governance Center — typed shapes + query keys (Step-72).
 *
 * Mirrors `backend/app/schemas/governance.py` (camelCase wire format
 * via Pydantic `serialize_by_alias=True`). The pair
 * `governance.ts` + `governance-hooks.ts` follows the `dashboard.ts`
 * + `dashboard-hooks.ts` convention.
 */

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export type PolicyStatus = 'active' | 'archived' | 'draft';
export type PolicySeverity = 'low' | 'medium' | 'high' | 'critical';
export type PolicyCategory = 'security' | 'compliance' | 'cost' | 'privacy';

export interface PolicyActor {
  readonly id: string;
  readonly displayName: string;
}

export interface PolicyRead {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly status: PolicyStatus;
  readonly severity: PolicySeverity;
  readonly category: PolicyCategory;
  readonly version: string;
  readonly updatedAt: string;
  readonly updatedBy: PolicyActor;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export type ApprovalState = 'pending' | 'accepted' | 'declined' | 'expired';
export type ApprovalKind =
  | 'request_confirmation'
  | 'request_checkbox_confirmation'
  | 'ask_user_questions'
  | 'suggest_tasks';

export interface ApprovalRead {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly title: string;
  readonly prompt: string;
  readonly state: ApprovalState;
  readonly createdAt: string;
  readonly idempotencyKey: string;
  readonly decider: { id: string; displayName: string } | null;
  readonly decidedAt: string | null;
  readonly reason: string | null;
}

// ---------------------------------------------------------------------------
// RBAC roles
// ---------------------------------------------------------------------------

export interface RbacPermission {
  readonly resource: string;
  readonly actions: ReadonlyArray<string>;
}

export interface RbacRoleRead {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly permissions: ReadonlyArray<RbacPermission>;
  readonly memberCount: number;
  readonly system: boolean;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Board confirmations
// ---------------------------------------------------------------------------

export type BoardConfirmationOutcome = 'pending' | 'accepted' | 'declined';

export interface BoardConfirmationRead {
  readonly id: string;
  readonly subject: { id: string; identifier: string };
  readonly planRev: string;
  readonly outcome: BoardConfirmationOutcome;
  readonly decider: { id: string; displayName: string } | null;
  readonly decidedAt: string | null;
  readonly idempotencyKey: string;
  readonly prompt: string;
}

// ---------------------------------------------------------------------------
// Violations (LiteLLM-derived)
// ---------------------------------------------------------------------------

export type ViolationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ViolationStatus = 'OPEN' | 'RESOLVED' | 'REOPENED';

export interface Violation {
  readonly id: string;
  readonly timestamp: string | null;
  readonly model: string | null;
  readonly severity: ViolationSeverity;
  readonly kind: string;
  readonly description: string;
  readonly actor: string | null;
  readonly key_alias: string | null;
  readonly status: ViolationStatus;
}

export interface ViolationPollResult {
  readonly polled_at: string;
  readonly previous_poll_at: string | null;
  readonly count: number;
  readonly items: ReadonlyArray<Violation>;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  readonly id: string;
  readonly ts: string;
  readonly actor: string;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AuditPage {
  readonly items: ReadonlyArray<AuditEvent>;
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const governanceQueryKeys = {
  all: () => ['governance'] as const,
  policies: () => ['governance', 'policies'] as const,
  approvals: () => ['governance', 'approvals'] as const,
  rbacRoles: () => ['governance', 'rbac-roles'] as const,
  boardConfirmations: () => ['governance', 'board-confirmations'] as const,
  violations: () => ['governance', 'violations'] as const,
  audit: (page: number) => ['governance', 'audit', page] as const,
};