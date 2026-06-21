import type { JSX } from "react";
import { useMemo } from "react";
import { ApprovalRequestRenderer } from "./approval-request";
import { BoardConfirmationHistory } from "./board-confirmation-history";
import { PolicyList } from "./policy-list";
import { RbacRoleViewer } from "./rbac-role-viewer";
import type {
  BoardConfirmation,
  Policy,
  RbacRole,
  RbacToken,
} from "./governance";
import type { ApprovalRequest } from "./types";

/**
 * GovernanceCenter — Plan 1 §3.11 center surface.
 *
 * Composes the four typed-artifact surfaces the v1.0 GA center ships with:
 *   1. Pending ApprovalRequest — rendered through `ApprovalRequestRenderer`
 *      (panel variant, with Accept/Decline gated by `evaluateBoardAccess`).
 *   2. Board Confirmation history — every resolved `request_confirmation`.
 *   3. RBAC role viewer — read-only in v1.0 per Plan 1 §5.1.
 *   4. Policy list — active + archived (Plan 3 §7.2 brand mapping).
 *
 * Reconciles with:
 *   - Governance Center plan (FORA-399)
 *   - IAM registry (FORA-125) — Policy + RbacRole shapes
 *   - Paperclip interaction schema (request_confirmation)
 */

export interface GovernanceCenterProps {
  /** Pending approvals for the tenant. The first `pending` is rendered prominently. */
  readonly pendingApprovals: ReadonlyArray<ApprovalRequest>;
  /** Resolved (and still-pending) confirmations for the tenant. */
  readonly boardConfirmations: ReadonlyArray<BoardConfirmation>;
  /** Active + archived policies for the tenant. */
  readonly policies: ReadonlyArray<Policy>;
  /** Tenant RBAC roles. Read-only in v1.0. */
  readonly rbacRoles: ReadonlyArray<RbacRole>;
  /** Optional `RbacToken` for Accept/Decline gating. */
  readonly token?: RbacToken;
  /** Accept handler — server-side Board token gate is the security boundary. */
  readonly onAccept?: (request: ApprovalRequest) => void;
  /** Decline handler. */
  readonly onDecline?: (request: ApprovalRequest) => void;
  readonly className?: string;
}

export function GovernanceCenter({
  pendingApprovals,
  boardConfirmations,
  policies,
  rbacRoles,
  token,
  onAccept,
  onDecline,
  className,
}: GovernanceCenterProps): JSX.Element {
  // The most recently-created pending approval is the "headline" — sort
  // by createdAt desc and pick the first. Memoize so re-renders don't
  // re-sort on identity-equal inputs.
  const headline = useMemo(() => {
    if (pendingApprovals.length === 0) return null;
    return [...pendingApprovals].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    )[0];
  }, [pendingApprovals]);

  const activePolicyCount = useMemo(
    () => policies.filter((p) => p.status === "active").length,
    [policies],
  );
  const archivedPolicyCount = policies.length - activePolicyCount;

  return (
    <div className={className} data-testid="governance-center">
      <header className="mb-6 space-y-1">
        <p className="text-caption uppercase tracking-wider text-ink-muted">
          Center #8
        </p>
        <h1 className="text-display-2 font-semibold text-ink-default">
          Governance Center
        </h1>
        <p className="text-body text-ink-muted">
          Manage Approval Requests, view Board Confirmation history, audit
          active Policies, and inspect the RBAC role catalog. Read-only in
          v1.0; full role editor ships in v1.1.
        </p>
      </header>

      <section
        aria-labelledby="pending-approvals-h"
        className="mb-8 space-y-3"
        data-testid="pending-approvals"
      >
        <div className="flex items-baseline justify-between">
          <h2
            id="pending-approvals-h"
            className="text-heading-1 font-semibold text-ink-default"
          >
            Pending Approvals
          </h2>
          <p className="text-caption text-ink-muted">
            {pendingApprovals.length} pending
          </p>
        </div>

        {headline ? (
          <ApprovalRequestRenderer
            artifact={headline}
            variant="panel"
            {...(token ? { token } : {})}
            {...(onAccept ? { onAccept } : {})}
            {...(onDecline ? { onDecline } : {})}
          />
        ) : (
          <EmptyState
            message="No pending approvals. The Board is caught up."
            testId="pending-approvals-empty"
          />
        )}

        {pendingApprovals.length > 1 && (
          <details className="rounded-md border border-surface-border bg-surface-raised px-3 py-2">
            <summary className="cursor-pointer text-body-sm font-medium text-ink-default">
              {pendingApprovals.length - 1} more pending
            </summary>
            <ul className="mt-3 space-y-2">
              {pendingApprovals.slice(1).map((p) => (
                <li key={p.id}>
                  <ApprovalRequestRenderer
                    artifact={p}
                    variant="inline-banner"
                    {...(token ? { token } : {})}
                    {...(onAccept ? { onAccept } : {})}
                    {...(onDecline ? { onDecline } : {})}
                  />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section
        aria-labelledby="board-history-h"
        className="mb-8 space-y-3"
        data-testid="board-confirmation-section"
      >
        <div className="flex items-baseline justify-between">
          <h2
            id="board-history-h"
            className="text-heading-1 font-semibold text-ink-default"
          >
            Board Confirmation History
          </h2>
          <p className="text-caption text-ink-muted">
            {boardConfirmations.length} record
            {boardConfirmations.length === 1 ? "" : "s"}
          </p>
        </div>
        <BoardConfirmationHistory confirmations={boardConfirmations} />
      </section>

      <section
        aria-labelledby="policies-h"
        className="mb-8 space-y-3"
        data-testid="policies-section"
      >
        <div className="flex items-baseline justify-between">
          <h2
            id="policies-h"
            className="text-heading-1 font-semibold text-ink-default"
          >
            Policies
          </h2>
          <p className="text-caption text-ink-muted">
            {activePolicyCount} active · {archivedPolicyCount} archived
          </p>
        </div>
        <PolicyList policies={policies} />
      </section>

      <section
        aria-labelledby="rbac-h"
        className="mb-8 space-y-3"
        data-testid="rbac-section"
      >
        <div className="flex items-baseline justify-between">
          <h2
            id="rbac-h"
            className="text-heading-1 font-semibold text-ink-default"
          >
            RBAC Roles
          </h2>
          <p className="text-caption text-ink-muted">
            {rbacRoles.length} role{rbacRoles.length === 1 ? "" : "s"}
          </p>
        </div>
        <RbacRoleViewer roles={rbacRoles} />
      </section>
    </div>
  );
}

function EmptyState({
  message,
  testId,
}: {
  message: string;
  testId: string;
}): JSX.Element {
  return (
    <div
      role="status"
      data-testid={testId}
      className="rounded-md border border-surface-border bg-surface-raised px-4 py-8 text-center"
    >
      <p className="text-body-sm text-ink-muted">{message}</p>
    </div>
  );
}