import type { JSX } from "react";
import { Badge } from "../primitives/badge";
import { TypedTable, type TypedTableColumn } from "../lists/typed-table";
import type { RbacRole } from "./governance";

/**
 * RBAC role viewer — Plan 1 §3.11 typed-artifact surface.
 *
 * v1.0 is **read-only** per Plan 1 §5.1: the renderer exposes the role
 * list and a "View permissions" disclosure but NEVER a "create role",
 * "edit role", or "delete role" affordance. v1.1 introduces the editor.
 *
 * Reconciles with the IAM registry (FORA-125) — the `RbacRole` mirror
 * is the renderer twin; the canonical record lives in the registry.
 *
 * Accessibility: system roles are marked with `data-system="true"` and
 * a `<Badge>` so screen readers announce "system" alongside the role
 * name (WCAG 1.3.1 + Plan 3 §5.1 — color is paired with text).
 */

export interface RbacRoleViewerProps {
  readonly roles: ReadonlyArray<RbacRole>;
  /** Optional aria-label override; default: "RBAC roles". */
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function RbacRoleViewer({
  roles,
  ariaLabel = "RBAC roles",
  className,
}: RbacRoleViewerProps): JSX.Element {
  const columns: ReadonlyArray<TypedTableColumn<RbacRole>> = [
    {
      id: "name",
      header: "Role",
      accessor: (r) => r.name,
      cell: (_v, r) => (
        <div className="space-y-0.5">
          <p className="font-medium text-ink-default">
            {r.name}
            {r.system && (
              <span className="ml-2 align-middle">
                <Badge tone="neutral" aria-label="System role">
                  system
                </Badge>
              </span>
            )}
          </p>
          {r.description && (
            <p className="text-caption text-ink-muted">{r.description}</p>
          )}
        </div>
      ),
    },
    {
      id: "permissions",
      header: "Permissions",
      accessor: (r) => r.permissions.length,
      numeric: true,
      cell: (_v, r) => (
        <span className="font-mono text-caption text-ink-default" aria-label={`${r.permissions.length} permission rows`}>
          {r.permissions.length} row{r.permissions.length === 1 ? "" : "s"}
        </span>
      ),
    },
    {
      id: "memberCount",
      header: "Members",
      accessor: (r) => r.memberCount,
      numeric: true,
      cell: (v) => <span className="font-mono">{String(v)}</span>,
    },
    {
      id: "updatedAt",
      header: "Updated at",
      accessor: (r) => r.updatedAt,
      cell: (v) => <span className="font-mono text-caption text-ink-muted">{String(v)}</span>,
    },
  ];

  return (
    <div className="space-y-3" data-testid="rbac-role-viewer">
      <p className="text-caption text-ink-muted" role="note">
        Read-only view — the role editor ships in v1.1.
      </p>
      <TypedTable<RbacRole>
        data={roles}
        columns={columns}
        ariaLabel={ariaLabel}
        {...(className ? { className } : {})}
      />
    </div>
  );
}