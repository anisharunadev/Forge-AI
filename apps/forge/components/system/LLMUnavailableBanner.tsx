'use client';

/**
 * LLMUnavailableBanner — global banner driven by `useLiteLLMStatus`.
 *
 * Mounted at the app root in `components/providers.tsx` so every
 * page gets the same degraded experience when the LiteLLM proxy
 * is unreachable.
 *
 * Auto-clears on recovery (the underlying TanStack query refetches
 * every 30s; the banner unmounts when `is_healthy` flips back to
 * true). Matches the Phase B exit criterion: "shows when LiteLLM
 * is down; auto-clears on recovery".
 */

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import { useLiteLLMStatus } from '@/hooks/use-litellm-status';

export interface LLMUnavailableBannerProps {
  /** Override the underlying query (tests). */
  readonly statusOverride?: ReturnType<typeof useLiteLLMStatus>;
  /** Optional className passthrough. */
  readonly className?: string;
}

export function LLMUnavailableBanner({
  statusOverride,
  className,
}: LLMUnavailableBannerProps) {
  const status = statusOverride ?? useLiteLLMStatus();
  const show = status.data
    ? status.data.healthy === false
    : Boolean(status.isError);

  if (!show) return null;

  const failures = status.data?.consecutive_failures ?? 0;
  const checked = status.data?.last_check_at
    ? new Date(status.data.last_check_at).toLocaleTimeString()
    : '—';

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="llm-unavailable-banner"
      className={
        'flex items-center gap-2 border-b border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-300 ' +
        (className ?? '')
      }
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="font-medium">LiteLLM unreachable.</span>
      <span className="text-muted-foreground">
        LLM calls will fail until the gateway recovers. Last probe at {checked} ({failures} consecutive failure{failures === 1 ? '' : 's'}).
      </span>
    </div>
  );
}
