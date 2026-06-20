/**
 * FORA-507 typed mock data source for the Governance Center.
 *
 * This is the seam the page reads from. The runtime wire-up (Policy
 * service + RbacRole registry + Board Confirmation log) is owned by
 * IAM/IntegrationEngineer; the typed shape is the contract.
 *
 * Source of truth:
 *   * `Policy` / `RbacRole` / `BoardConfirmation` / `RbacToken` /
 *     `ApprovalRequest` — from `@fora/forge-ui/typed-artifacts` (shipped
 *     in FORA-507, package v0.4.0). The app currently renders with its
 *     own tailwind tokens, so we mirror the type shape here rather than
 *     import (matches the connector-center pattern in mock-data.ts).
 *
 * Why mock: the Policy + RBAC services are planned for FORA-125+
 * integration but the renderer-side v1.0 GA ships with typed mocks.
 * The swap is a one-file change in this seam.
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

// ---------------------------------------------------------------------------
// Seed dataset — fixture for v1.0 GA; swapped for live services later.
// Tenant: SEED_TENANT_ID = "tnt_8XQ" (matches connector-center mock).
// ---------------------------------------------------------------------------

export const PENDING_APPROVALS: ReadonlyArray<ApprovalRequest> = [
  {
    id: "apr-fora-507",
    kind: "request_confirmation",
    title: "Approve FORA-507 Governance Center v1.0 GA",
    prompt: "Ship the Governance Center slice (Approval Requests + Board Confirmation + RBAC viewer + Policy list) as v1.0 GA.",
    state: "pending",
    createdAt: "2026-06-20T23:00Z",
    idempotencyKey: "conf:fora-507:plan:v0.4.0",
  },
  {
    id: "apr-fora-578-extra",
    kind: "request_confirmation",
    title: "Approve FORA-578 connector-center list page",
    prompt: "Ship the connector-center list page slice as part of FORA-504 v1.0 GA.",
    state: "pending",
    createdAt: "2026-06-20T22:00Z",
    idempotencyKey: "conf:fora-578:plan:v0.3.0",
  },
];

export const POLICIES: ReadonlyArray<Policy> = [
  {
    id: "pol-deny-destructive-prod",
    title: "Deny destructive MCP actions in prod",
    summary: "Block all delete_* / rotate_* tools against prod connectors.",
    status: "active",
    version: "1.4.0",
    updatedAt: "2026-06-19T10:00Z",
    updatedBy: { displayName: "CTO", id: "cto" },
  },
  {
    id: "pol-rate-limit-egress",
    title: "Rate-limit external HTTP egress",
    summary: "Cap egress at 100 req/min/tenant.",
    status: "active",
    version: "1.1.0",
    updatedAt: "2026-06-15T08:00Z",
    updatedBy: { displayName: "Architect", id: "arch" },
  },
  {
    id: "pol-archive-quota-trial",
    title: "Trial tenants: 10 MCP calls/hour cap",
    summary: "Legacy cap from the trial tier; superseded by Enterprise default.",
    status: "archived",
    version: "0.7.0",
    updatedAt: "2025-12-01T10:00Z",
    updatedBy: { displayName: "CTO", id: "cto" },
  },
];

export const RBAC_ROLES: ReadonlyArray<RbacRole> = [
  {
    id: "role-board",
    name: "board",
    description: "Board token — accepts request_confirmation interactions.",
    permissions: [
      { resource: "approval.request_confirmation", actions: ["accept", "decline"] },
      { resource: "policy", actions: ["read"] },
      { resource: "rbac.role", actions: ["read"] },
    ],
    memberCount: 1,
    system: true,
    updatedAt: "2026-06-15T10:00Z",
  },
  {
    id: "role-cto",
    name: "cto",
    description: "Engineering owner — full read across the Governance Center.",
    permissions: [
      { resource: "approval", actions: ["read", "decline"] },
      { resource: "policy", actions: ["read", "write"] },
      { resource: "rbac.role", actions: ["read", "write"] },
    ],
    memberCount: 1,
    system: true,
    updatedAt: "2026-06-15T10:00Z",
  },
  {
    id: "role-architect",
    name: "architect",
    description: "Design + implementation owner.",
    permissions: [
      { resource: "approval", actions: ["read", "decline"] },
      { resource: "policy", actions: ["read", "write"] },
      { resource: "rbac.role", actions: ["read"] },
    ],
    memberCount: 4,
    system: false,
    updatedAt: "2026-06-10T10:00Z",
  },
  {
    id: "role-developer",
    name: "developer",
    description: "Engineers who ship code.",
    permissions: [{ resource: "task", actions: ["read", "update"] }],
    memberCount: 14,
    system: false,
    updatedAt: "2026-06-10T10:00Z",
  },
];

export const BOARD_CONFIRMATIONS: ReadonlyArray<BoardConfirmation> = [
  {
    id: "bc-fora-393",
    subject: { identifier: "FORA-393", id: "fora-393" },
    planRev: "v0.1",
    outcome: "accepted",
    decider: { displayName: "Board", id: "board" },
    decidedAt: "2026-06-20T05:30Z",
    idempotencyKey: "conf:fora-393:plan:v0.1",
    prompt: "Approve FORA-393 UI/Visualization Spine Plan rev v0.1.",
  },
  {
    id: "bc-fora-128",
    subject: { identifier: "FORA-128", id: "fora-128" },
    planRev: "v0.7.5",
    outcome: "declined",
    decider: { displayName: "Board", id: "board" },
    decidedAt: "2026-06-17T20:50Z",
    reason: "Wait for AWS SM hand-off.",
    idempotencyKey: "conf:fora-128:plan:v0.7.5",
    prompt: "Approve FORA-128 secrets-mcp v0 ship.",
  },
  {
    id: "bc-fora-577",
    subject: { identifier: "FORA-577", id: "fora-577" },
    planRev: "v0.3.0",
    outcome: "accepted",
    decider: { displayName: "Board", id: "board" },
    decidedAt: "2026-06-20T17:05Z",
    idempotencyKey: "conf:fora-577:plan:v0.3.0",
    prompt: "Approve FORA-577 @fora/forge-ui v0.3.0 Connector Center foundation.",
  },
];

export function readBoardTokenForPersona(persona: string): RbacToken | undefined {
  if (persona === "cto" || persona === "vp-eng") {
    return { kind: "user", displayName: "Jane CTO", id: "u-cto" };
  }
  if (persona === "eng-lead") {
    return { kind: "user", displayName: "Eng Lead", id: "u-englead" };
  }
  // For v1.0 GA, the Board token is only surfaced in investigation mode
  // (a session-level toggle owned by the customer CISO). The default
  // forge console does NOT hand the Board token to any persona — every
  // Approval Request Accept action will surface "Board access required".
  return undefined;
}

export function boardTokenPresent(): RbacToken {
  return { kind: "board", displayName: "Board", id: "board-token" };
}