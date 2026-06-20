/**
 * AuditExportButton — Plan 1 §5.1 v1.1 export placeholder.
 *
 * v1.0 ships the button (disabled) so the audit-export affordance is visible
 * to the customer CISO; the wiring lands in v1.1 with the audit spine
 * (FORA-399). The button surfaces a tooltip + live-region message explaining
 * the deferred status so the disabled state isn't mistaken for a bug.
 */

import { Download } from "lucide-react";
import type { JSX } from "react";
import { Button } from "../primitives/button";
import { VisuallyHidden } from "../a11y/visually-hidden";

export interface AuditExportButtonProps {
  className?: string;
}

export function AuditExportButton({ className }: AuditExportButtonProps): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled
      aria-disabled="true"
      aria-describedby="audit-export-help"
      title="Audit export is shipping in v1.1"
      className={className}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      <VisuallyHidden>Export audit log</VisuallyHidden>
      <span aria-hidden="true" className="ml-1">Export</span>
    </Button>
  );
}
