'use client';

/**
 * Sprint 3 — Crash #2.
 *
 * Renders a destructive-variant Alert above the connector detail panel
 * when the audit feed was synthesized client-side (no live
 * TenantScopedAuditFetcher yet). The banner is the user-facing signal
 * that the inline audit list is mock-backed, not real.
 */

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function AuditFeedFallbackBanner() {
  return (
    <Alert
      variant="destructive"
      className="mb-4"
      data-testid="audit-feed-fallback-banner"
      role="status"
      aria-live="polite"
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Showing mock audit feed — live fetcher unavailable</AlertTitle>
      <AlertDescription>
        The Connector Center is rendering the in-memory audit seed because
        the live TenantScopedAuditFetcher is not yet wired. Entry timestamps
        and hashes are deterministic fixtures, not real tool calls.
      </AlertDescription>
    </Alert>
  );
}
