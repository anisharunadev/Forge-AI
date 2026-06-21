import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { TypedTable, type TypedTableColumn } from "../lists/typed-table";
import type { Policy } from "./governance";

/**
 * Policy list — Plan 1 §3.11 typed-artifact surface (active + archived).
 *
 * Per Plan 3 §7.2:
 *   - active   → `--brand-primary`
 *   - archived → neutral grey
 *
 * The renderer is the typed twin of the IAM registry (FORA-125) Policy
 * record. The `dsl` field is intentionally NOT surfaced in the list
 * view; surfacing it requires a detail panel that ships in v1.1.
 */

const STATUS_LABEL: Record<Policy["status"], string> = {
  active: "active",
  archived: "archived",
};

export interface PolicyListProps {
  readonly policies: ReadonlyArray<Policy>;
  /** Optional aria-label override; default: "Policies". */
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function PolicyList({
  policies,
  ariaLabel = "Policies",
  className,
}: PolicyListProps): JSX.Element {
  const columns: ReadonlyArray<TypedTableColumn<Policy>> = [
    {
      id: "title",
      header: "Policy",
      accessor: (p) => p.title,
      cell: (_v, p) => (
        <div className="space-y-0.5">
          <p className="font-medium text-ink-default">{p.title}</p>
          <p className="text-caption text-ink-muted">{p.summary}</p>
        </div>
      ),
    },
    {
      id: "version",
      header: "Version",
      accessor: (p) => p.version,
      cell: (v) => <span className="font-mono">{String(v)}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessor: (p) => p.status,
      cell: (v, p) => (
        <Badge
          tone={p.status === "active" ? "primary" : "neutral"}
          data-status={p.status}
          aria-label={`Status: ${STATUS_LABEL[p.status]}`}
        >
          {STATUS_LABEL[p.status]}
        </Badge>
      ),
    },
    {
      id: "updatedBy",
      header: "Updated by",
      accessor: (p) => p.updatedBy.displayName,
    },
    {
      id: "updatedAt",
      header: "Updated at",
      accessor: (p) => p.updatedAt,
      cell: (v) => <span className="font-mono text-caption text-ink-muted">{String(v)}</span>,
    },
  ];

  return (
    <TypedTable<Policy>
      data={policies}
      columns={columns}
      ariaLabel={ariaLabel}
      {...(className ? { className } : {})}
    />
  );
}