/**
 * Governance Center — async data seam (FORA-507 v1.0 GA).
 *
 * Replaces the sync `lib/governance/mock-data.ts` for live rendering.
 *
 * API endpoints (from `bin/orchestrator-stub.py`):
 *   GET  /v1/governance/approvals             → ApprovalRequest[]
 *   GET  /v1/governance/policies              → Policy[]
 *   GET  /v1/governance/rbac-roles            → RbacRole[]
 *   GET  /v1/governance/board-confirmations   → BoardConfirmation[]
 *   POST /v1/governance/approvals/{id}/accept  → ApprovalRequest (updated)
 *   POST /v1/governance/approvals/{id}/decline → ApprovalRequest (updated)
 */

export type ApprovalKind =
  | "request_confirmation"
  | "request_checkbox_confirmation"
  | "ask_user_questions"
  | "suggest_tasks";

export type ApprovalState =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "superseded";

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

export interface Policy {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly status: "active" | "archived";
  readonly version: string;
  readonly updatedAt: string;
  readonly updatedBy: { readonly displayName: string; readonly id: string };
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
  readonly outcome: "accepted" | "declined" | "pending";
  readonly decider?: { readonly displayName: string; readonly id: string };
  readonly decidedAt?: string;
  readonly reason?: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
}

export type RbacToken =
  | { readonly kind: "board"; readonly displayName: string; readonly id: string }
  | { readonly kind: "agent"; readonly displayName: string; readonly id: string; readonly role: string }
  | { readonly kind: "user"; readonly displayName: string; readonly id: string };

const BASE_URL =
  process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function postJson<T>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Pending approval requests (FORA-507 typed artifact). */
export async function listApprovals(): Promise<ReadonlyArray<ApprovalRequest>> {
  const rows = await getJson<ApprovalRequest[]>('/v1/governance/approvals');
  return rows ?? [];
}

/** Active + archived policies. */
export async function listPolicies(): Promise<ReadonlyArray<Policy>> {
  const rows = await getJson<Policy[]>('/v1/governance/policies');
  return rows ?? [];
}

/** RBAC roles viewer. */
export async function listRbacRoles(): Promise<ReadonlyArray<RbacRole>> {
  const rows = await getJson<RbacRole[]>('/v1/governance/rbac-roles');
  return rows ?? [];
}

/** Board confirmation history. */
export async function listBoardConfirmations(): Promise<
  ReadonlyArray<BoardConfirmation>
> {
  const rows = await getJson<BoardConfirmation[]>(
    '/v1/governance/board-confirmations',
  );
  return rows ?? [];
}

/** Accept an approval (POST). */
export async function acceptApproval(
  id: string,
): Promise<ApprovalRequest | null> {
  return postJson<ApprovalRequest>(
    `/v1/governance/approvals/${encodeURIComponent(id)}/accept`,
  );
}

/** Decline an approval (POST). */
export async function declineApproval(
  id: string,
): Promise<ApprovalRequest | null> {
  return postJson<ApprovalRequest>(
    `/v1/governance/approvals/${encodeURIComponent(id)}/decline`,
  );
}

/**
 * Resolve the active Board token for a persona. The Board token is a
 * session-level secret; the legacy mock returns it from the persona
 * mapping. The new seam is persona-aware at the page level (the
 * session cookie carries the persona) — this function preserves the
 * same shape so the page can keep calling one helper.
 */
export function readBoardTokenForPersona(persona: string): RbacToken | undefined {
  if (persona === 'cto' || persona === 'vp-eng') {
    return { kind: 'user', displayName: 'Jane CTO', id: 'u-cto' };
  }
  if (persona === 'eng-lead') {
    return { kind: 'user', displayName: 'Eng Lead', id: 'u-englead' };
  }
  return undefined;
}

export function boardTokenPresent(): RbacToken {
  return { kind: 'board', displayName: 'Board', id: 'board-token' };
}