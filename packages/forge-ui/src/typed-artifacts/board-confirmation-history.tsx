import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { TypedTable, type TypedTableColumn } from "../lists/typed-table";
import type { BoardConfirmation } from "./governance";

/**
 * Board Confirmation history — Plan 1 §3.11 typed-artifact surface.
 *
 * Renders the per-tenant history of Paperclip `request_confirmation`
 * decisions. The currently-pending confirmation is rendered separately
 * via `ApprovalRequestRenderer` (panel variant); this surface covers
 * every confirmation that has been resolved (accepted / declined) or
 * that the Board has not yet picked up (pending).
 *
 * Color mapping per Plan 3 §7.2:
 *   accepted → `--brand-success`
 *   declined → `--brand-danger`
 *   pending  → neutral
 */

const OUTCOME_LABEL: Record<BoardConfirmation["outcome"], string> = {
  accepted: "accepted",
  declined: "declined",
  pending: "pending",
};

const OUTCOME_TONE: Record<BoardConfirmation["outcome"], "success" | "danger" | "neutral"> = {
  accepted: "success",
  declined: "danger",
  pending: "neutral",
};

export interface BoardConfirmationHistoryProps {
  readonly confirmations: ReadonlyArray<BoardConfirmation>;
  /** Optional aria-label override; default: "Board Confirmation history". */
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function BoardConfirmationHistory({
  confirmations,
  ariaLabel = "Board Confirmation history",
  className,
}: BoardConfirmationHistoryProps): JSX.Element {
  const columns: ReadonlyArray<TypedTableColumn<BoardConfirmation>> = [
    {
      id: "subject",
      header: "Subject",
      accessor: (c) => c.subject.identifier,
      cell: (_v, c) => (
        <div className="space-y-0.5">
          <p className="font-mono text-body-sm text-ink-default">{c.subject.identifier}</p>
          <p className="text-caption text-ink-muted">{c.prompt}</p>
        </div>
      ),
    },
    {
      id: "planRev",
      header: "Plan rev",
      accessor: (c) => c.planRev,
      cell: (v) => <span className="font-mono text-caption">{String(v)}</span>,
    },
    {
      id: "outcome",
      header: "Outcome",
      accessor: (c) => c.outcome,
      cell: (_v, c) => (
        <Badge
          tone={OUTCOME_TONE[c.outcome]}
          data-outcome={c.outcome}
          aria-label={`Outcome: ${OUTCOME_LABEL[c.outcome]}`}
        >
          {OUTCOME_LABEL[c.outcome]}
        </Badge>
      ),
    },
    {
      id: "decider",
      header: "Decider",
      accessor: (c) => c.decider?.displayName ?? "—",
      cell: (v) => (
        <span className="font-mono text-caption text-ink-default">{String(v)}</span>
      ),
    },
    {
      id: "decidedAt",
      header: "Decided at",
      accessor: (c) => c.decidedAt ?? "—",
      cell: (v) => <span className="font-mono text-caption text-ink-muted">{String(v)}</span>,
    },
  ];

  return (
    <TypedTable<BoardConfirmation>
      data={confirmations}
      columns={columns}
      ariaLabel={ariaLabel}
      {...(className ? { className } : {})}
    />
  );
}