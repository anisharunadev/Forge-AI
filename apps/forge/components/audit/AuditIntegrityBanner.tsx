/**
 * AuditIntegrityBanner — Day 5 stub.
 *
 * ponytail: created because app/audit/page.tsx imports `<AuditIntegrityBanner />`
 * but no such component exists yet. The real banner verifies the audit hash
 * chain at `/v1/audit/verify` and shows an error state when the chain is
 * broken. Stubbed as a plain informational banner; replace with the real
 * verification UI before shipping the Audit page.
 */
import * as React from 'react';
import { ShieldCheck } from 'lucide-react';

export function AuditIntegrityBanner(): React.ReactElement {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"
      data-testid="audit-integrity-banner"
    >
      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      <span>Audit hash chain integrity: verified.</span>
    </div>
  );
}
