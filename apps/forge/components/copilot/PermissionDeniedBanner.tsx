'use client';

/**
 * F-800 — Permission denied banner.
 *
 * Yellow warning banner shown when Co-pilot returns a 403 (e.g. a
 * tool call the user is not authorized to invoke). Dismissible via
 * the X — dismissal lives only in component state because permission
 * denials are session-scoped and shouldn't persist across reloads.
 */

import * as React from 'react';
import { AlertTriangle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PermissionDeniedBannerProps {
  /** What action was denied — e.g. "Draft artifact (requires Architect role)". */
  message?: string;
  className?: string;
}

const DEFAULT_MESSAGE =
  'One of Co-pilot’s tools requires a higher role than you have. The rest of the response still works.';

/**
 * Yellow warning banner. Dismissible by clicking the X. Rendered at
 * the top of the Co-pilot panel content when a 403 has been
 * observed (parent owns the visibility flag).
 */
export function PermissionDeniedBanner({
  message = DEFAULT_MESSAGE,
  className,
}: PermissionDeniedBannerProps) {
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  return (
    <div
      role="alert"
      data-testid="copilot-permission-denied-banner"
      className={cn(
        'flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p className="flex-1 leading-snug">{message}</p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss permission warning"
        data-testid="copilot-permission-denied-dismiss"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </Button>
    </div>
  );
}