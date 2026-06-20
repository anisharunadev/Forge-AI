/**
 * Governance Center typed-artifact surface — FORA-393 Plan 1 §3.11.
 *
 * Separated from `./types` so the Governance Center slice ships
 * independently of the shared typed-artifact table (which the
 * Audit Center + Knowledge Center slices also touch). The renderer
 * mirror of the runtime contract:
 *   * `Policy`            — active vs archived per Plan 3 §7.2 brand mapping
 *   * `RbacRole`          — read-only in v1.0; full editor is v1.1 (Plan 1 §5.1)
 *   * `BoardConfirmation` — accepted / pending / declined per Paperclip
 *                            `request_confirmation` interaction schema
 *   * `RbacToken`         — discriminated union the Governance Center passes
 *                            to the Accept/Decline actions; an agent token
 *                            gets "Board access required" (Plan 4 §3.10 +
 *                            FORA-507 AC #2)
 *
 * Reconciles with:
 *   - Governance Center plan (FORA-399)
 *   - IAM registry (FORA-125) — Policy + RbacRole canonical source
 *   - Paperclip interaction schema (`reference-paperclip-interaction-schema`)
 */

import type { ApprovalRequest } from "./types";

/**
 * A `Policy` is a tenant-scoped IAM rule, expressed in the IAM registry
 * DSL per FORA-125. The Governance Center surfaces active + archived;
 * active uses `--brand-primary` (Plan 3 §7.2), archived uses neutral grey.
 */
export interface Policy {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** DSL source — never rendered in the list view, surfaced only on detail. */
  readonly dsl: string;
  readonly status: "active" | "archived";
  readonly version: string;
  readonly updatedAt: string;
  readonly updatedBy: { readonly displayName: string; readonly id: string };
  /** Optional scope — the tenants / roles this policy applies to. */
  readonly appliesTo?: ReadonlyArray<string>;
}

/**
 * An `RbacRole` is a typed bundle of permissions scoped to the tenant.
 * v1.0 is read-only (Plan 1 §5.1); the renderer does not expose edit
 * affordances. v1.1 will introduce the role editor.
 */
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

/**
 * A `BoardConfirmation` is the typed record of a Paperclip
 * `request_confirmation` decision. The Governance Center renders a
 * history per tenant; the currently-pending request is rendered
 * separately via `ApprovalRequestRenderer`.
 */
export interface BoardConfirmation {
  readonly id: string;
  /** Issue / epic the confirmation governed. */
  readonly subject: { readonly identifier: string; readonly id: string };
  readonly planRev: string;
  readonly outcome: "accepted" | "declined" | "pending";
  readonly decider?: { readonly displayName: string; readonly id: string };
  readonly decidedAt?: string;
  readonly reason?: string;
  readonly idempotencyKey: string;
  /** Mirror of the originating ApprovalRequest.prompt for context. */
  readonly prompt: string;
}

/**
 * The token the Governance Center (or any consumer) hands to the
 * Accept/Decline actions. Only `kind: "board"` may accept a
 * `request_confirmation` (Plan 4 §3.10). An `agent` token is allowed
 * to *decline* (so an agent can refuse its own prompt) but the
 * renderer must surface "Board access required" when an agent tries
 * to Accept.
 */
export type RbacToken =
  | { readonly kind: "board"; readonly displayName: string; readonly id: string }
  | { readonly kind: "agent"; readonly displayName: string; readonly id: string; readonly role: string }
  | { readonly kind: "user"; readonly displayName: string; readonly id: string };

/**
 * The outcome of the Board-token gate for a given ApprovalRequest.
 * Used by `ApprovalRequestRenderer` to decide whether to render the
 * Accept button as enabled, disabled-with-tooltip, or hidden.
 */
export interface BoardAccessDecision {
  readonly canAccept: boolean;
  readonly canDecline: boolean;
  readonly reason?: string;
}

/**
 * The decision the Governance Center needs to render Accept/Decline.
 * Pure function — no DOM, no fetch — so it is unit-testable in
 * isolation and a downstream consumer (server action, API route) can
 * use the same gate on the runtime side. The renderer-side mirror
 * must match the server-side gate byte-for-byte; a mismatch is a
 * security finding.
 */
export function evaluateBoardAccess(
  token: RbacToken | undefined,
  request: ApprovalRequest,
): BoardAccessDecision {
  if (!token) {
    return {
      canAccept: false,
      canDecline: false,
      reason: "Sign in to act on this approval.",
    };
  }
  if (request.state !== "pending") {
    return {
      canAccept: false,
      canDecline: false,
      reason: `This request is already ${request.state}.`,
    };
  }
  if (request.kind === "request_confirmation") {
    if (token.kind === "board") {
      return { canAccept: true, canDecline: true };
    }
    if (token.kind === "user") {
      return {
        canAccept: false,
        canDecline: true,
        reason: "Board access required — only the Board token can accept request_confirmation.",
      };
    }
    return {
      canAccept: false,
      canDecline: true,
      reason: "Board access required.",
    };
  }
  // ask_user_questions + suggest_tasks + request_checkbox_confirmation — any signed-in token may act.
  if (token.kind === "agent" || token.kind === "user") {
    return { canAccept: true, canDecline: true };
  }
  return { canAccept: true, canDecline: true };
}