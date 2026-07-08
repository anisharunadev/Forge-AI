"use client";

/**
 * StageErrorFallback — renders an `ErrorEnvelope` from the backend.
 *
 * The backend's `Phase4Error.to_envelope()` shape is:
 *
 *   {
 *     "error": "PASS_THROUGH_DISABLED",
 *     "message": "Pass-through is disabled in this environment",
 *     "details": { ... },
 *     "occurred_at": "2026-07-07T12:00:00+00:00"
 *   }
 *
 * This component renders that envelope as a typed surface: the code
 * is the headline, the message is the explanation, the details are
 * a collapsible JSON block, and `occurred_at` is the timestamp.
 *
 * The component is intentionally NOT a `<button>`-clicked recovery
 * flow. Recovery is delegated to the surrounding `StagePanel` (which
 * can re-render), and to a `Reload` button that refreshes the page
 * if all else fails.
 */

import { useState } from 'react';

import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ErrorEnvelope } from '@/lib/workflow-shell/states';

export interface StageErrorFallbackProps {
  readonly envelope: ErrorEnvelope;
  readonly className?: string;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function StageErrorFallback({
  envelope,
  className,
}: StageErrorFallbackProps) {
  const [showDetails, setShowDetails] = useState(false);
  const reload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };
  return (
    <div
      role="alert"
      data-testid="workflow-stage-error-fallback"
      data-error-code={envelope.error}
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-rose-500/40 bg-rose-500/5 px-4 py-4 text-sm',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/10 text-rose-300"
        >
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="font-mono text-xs uppercase tracking-wide text-rose-300/80">
            {envelope.error}
          </span>
          <span className="text-sm text-rose-100">{envelope.message}</span>
          <span className="text-xs text-rose-300/70">
            occurred_at {envelope.occurred_at}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
        >
          {showDetails ? 'Hide details' : 'Show details'}
        </Button>
        <Button type="button" variant="default" size="sm" onClick={reload}>
          Reload
        </Button>
      </div>
      {showDetails ? (
        <pre
          data-testid="workflow-stage-error-details"
          className="max-h-48 overflow-auto rounded-md border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-100"
        >
          {formatJson(envelope.details)}
        </pre>
      ) : null}
    </div>
  );
}