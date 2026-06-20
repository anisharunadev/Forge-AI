import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { cn } from "../tokens/cn";
import { evaluateBoardAccess, type RbacToken } from "./governance";
import type { ApprovalRequest, ApprovalState, BaseRendererProps } from "./types";

const STATE_TONE: Record<ApprovalState, "neutral" | "primary" | "success" | "warn" | "danger"> = {
  pending: "primary",
  accepted: "success",
  declined: "danger",
  expired: "warn",
  superseded: "neutral",
};

const KIND_LABEL: Record<ApprovalRequest["kind"], string> = {
  request_confirmation: "Confirm",
  request_checkbox_confirmation: "Select",
  ask_user_questions: "Question",
  suggest_tasks: "Suggest",
};

const STATE_LABEL: Record<ApprovalState, string> = {
  pending: "pending",
  accepted: "approved",
  declined: "declined",
  expired: "expired",
  superseded: "superseded",
};

export interface ApprovalRequestRendererProps extends BaseRendererProps<ApprovalRequest> {
  /**
   * Optional `RbacToken` for Accept/Decline gating. When omitted, the
   * renderer surfaces actions as disabled with a "Sign in to act" tooltip.
   *
   * The renderer NEVER calls `evaluateBoardAccess` with anything other than
   * the supplied `token` — the server-side gate is the security boundary,
   * the renderer only mirrors it for UX.
   */
  readonly token?: RbacToken;
  /** Optional Accept handler — fires when state is `pending` and the token allows. */
  readonly onAccept?: (request: ApprovalRequest) => void;
  /** Optional Decline handler — fires when state is `pending` and the token allows. */
  readonly onDecline?: (request: ApprovalRequest) => void;
}

/**
 * ApprovalRequestRenderer — Plan 4 §3.10. Variants: inline-banner | panel | history-row.
 * The Governance Center and Dashboard surface in-flight approvals through this.
 *
 * Color mapping per Plan 3 §7.2:
 *   pending → --brand-primary (neutral banner)
 *   accepted → --brand-success
 *   declined → --brand-danger
 *   expired → --brand-warn
 */
export function ApprovalRequestRenderer({
  artifact,
  variant = "inline-banner",
  token,
  onAccept,
  onDecline,
  className,
}: ApprovalRequestRendererProps): JSX.Element {
  if (variant === "history-row") {
    return (
      <div
        role="row"
        aria-label={`Approval ${artifact.id}`}
        className={cn(
          "grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 border-b border-surface-border px-3 py-2 text-body-sm",
          className,
        )}
      >
        <span className="font-mono text-caption text-ink-muted">{artifact.createdAt}</span>
        <span className="truncate text-ink-default">{artifact.title}</span>
        <Badge tone="neutral">{KIND_LABEL[artifact.kind]}</Badge>
        <Badge
          tone={STATE_TONE[artifact.state]}
          data-state={artifact.state}
          aria-label={`State: ${STATE_LABEL[artifact.state]}`}
        >
          {STATE_LABEL[artifact.state]}
        </Badge>
        <span className="font-mono text-caption text-ink-subtle">
          {artifact.decider?.displayName ?? "—"}
        </span>
      </div>
    );
  }

  const containerClass =
    variant === "inline-banner"
      ? "rounded-md border border-brand-primary/30 bg-brand-primary/5 p-3"
      : "rounded-lg border border-surface-border bg-surface p-4 shadow-elev-1";

  return (
    <article
      aria-labelledby={`approval-${artifact.id}-title`}
      className={cn(containerClass, className)}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-caption text-ink-muted">
            {KIND_LABEL[artifact.kind]} request
          </p>
          <h3
            id={`approval-${artifact.id}-title`}
            className="text-heading-3 font-semibold text-ink-default"
          >
            {artifact.title}
          </h3>
        </div>
        <Badge
          tone={STATE_TONE[artifact.state]}
          data-state={artifact.state}
          aria-label={`State: ${STATE_LABEL[artifact.state]}`}
        >
          {STATE_LABEL[artifact.state]}
        </Badge>
      </header>

      <p className="mt-2 text-body text-ink-default">{artifact.prompt}</p>

      {artifact.options && artifact.options.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Options">
          {artifact.options.map((o) => (
            <li
              key={o.id}
              className="rounded-sm border border-surface-border bg-surface-raised px-3 py-2"
            >
              <p className="text-body-sm font-medium text-ink-default">{o.label}</p>
              {o.description && (
                <p className="mt-0.5 text-caption text-ink-muted">{o.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2 text-caption text-ink-muted" aria-label="Approval metadata">
        <dt>Decider</dt>
        <dd className="text-ink-default">
          {artifact.decider ? artifact.decider.displayName : "pending"}
        </dd>
        <dt>Decided at</dt>
        <dd className="font-mono text-ink-default">{artifact.decidedAt ?? "—"}</dd>
        {artifact.idempotencyKey && (
          <>
            <dt>Idempotency key</dt>
            <dd className="font-mono text-ink-default">{artifact.idempotencyKey}</dd>
          </>
        )}
        {artifact.issueRef && (
          <>
            <dt>Issue</dt>
            <dd className="font-mono text-ink-default">{artifact.issueRef.identifier}</dd>
          </>
        )}
      </dl>

      {artifact.state === "declined" && artifact.reason && (
        <p
          role="alert"
          className="mt-3 rounded-sm border border-brand-danger/30 bg-brand-danger/5 px-2 py-1 text-body-sm text-brand-danger"
        >
          Declined: {artifact.reason}
        </p>
      )}

      {artifact.state === "pending" && (
        <ApprovalRequestActions
          artifact={artifact}
          {...(token ? { token } : {})}
          {...(onAccept ? { onAccept } : {})}
          {...(onDecline ? { onDecline } : {})}
        />
      )}
    </article>
  );
}

/**
 * Accept/Decline action row. Only rendered when `artifact.state === 'pending'`.
 * The Board-token gate is evaluated by the pure `evaluateBoardAccess` helper
 * (imported from `./types`) — the same helper the server uses — so a renderer
 * mirror is impossible to drift from the runtime gate.
 *
 * Accessibility:
 *   - Both buttons announce their disabled state via `aria-disabled`.
 *   - The "Board access required" tooltip is wired through `title` and a
 *     visually-hidden live region so screen readers also hear it (per WCAG 1.3.1
 *     + Plan 3 §5.1).
 */
function ApprovalRequestActions({
  artifact,
  token,
  onAccept,
  onDecline,
}: {
  artifact: ApprovalRequest;
  token?: RbacToken;
  onAccept?: (request: ApprovalRequest) => void;
  onDecline?: (request: ApprovalRequest) => void;
}): JSX.Element {
  const decision = evaluateBoardAccess(token, artifact);
  const blockedReason = decision.reason ?? "Sign in to act on this approval.";

  return (
    <div
      role="group"
      aria-label="Approval actions"
      className="mt-3 flex flex-wrap items-center justify-end gap-2"
    >
      {decision.reason && (
        <p className="sr-only" role="status" aria-live="polite">
          {decision.reason}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onDecline ? () => onDecline(artifact) : undefined}
        disabled={!decision.canDecline || !onDecline}
        aria-disabled={!decision.canDecline || !onDecline}
        title={!decision.canDecline ? blockedReason : "Decline this request"}
        data-action="decline"
        data-testid={`approval-decline-${artifact.id}`}
      >
        Decline
      </Button>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={onAccept ? () => onAccept(artifact) : undefined}
        disabled={!decision.canAccept || !onAccept}
        aria-disabled={!decision.canAccept || !onAccept}
        title={!decision.canAccept ? blockedReason : "Accept this request"}
        data-action="accept"
        data-testid={`approval-accept-${artifact.id}`}
      >
        Accept
      </Button>
    </div>
  );
}