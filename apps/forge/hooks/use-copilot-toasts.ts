'use client';

/**
 * M10 Track B — wire-level toast bus for the Co-pilot panel.
 *
 * Bridges the `ComposerInput` (the API call site) and the
 * `CopilotPanel` (the render site) without prop-drilling the
 * error shape across every layer in between. We dispatch
 * `CustomEvent`s on `window` because every panel instance is
 * already mounted and the existing `copilot:open_history` /
 * `copilot:open_settings` events use the same bus.
 *
 * Events:
 *   - `copilot:rate_limit` — payload: `{ retryAfter: number }`
 *     (T-B1)
 *   - `copilot:guardrail_denied` — payload: `{}`
 *     (T-B2)
 *
 * `useCopilotToasts()` is the panel-side subscriber; it returns
 * the active toasts plus dismissal callbacks.
 *
 * Testability: the events use `CustomEvent` so vitest can dispatch
 * them with `window.dispatchEvent(new CustomEvent(...))` without
 * any extra infrastructure.
 */

import * as React from 'react';

export const COPILOT_RATE_LIMIT_EVENT = 'copilot:rate_limit';
export const COPILOT_GUARDRAIL_DENIED_EVENT = 'copilot:guardrail_denied';

export interface RateLimitEventDetail {
  retryAfter: number;
}

export function dispatchCopilotRateLimit(retryAfter: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<RateLimitEventDetail>(COPILOT_RATE_LIMIT_EVENT, {
      detail: { retryAfter },
    }),
  );
}

export function dispatchCopilotGuardrailDenied(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(COPILOT_GUARDRAIL_DENIED_EVENT, { detail: {} }),
  );
}

export interface ActiveCopilotToasts {
  rateLimit: { retryAfter: number; key: string } | null;
  guardrail: { key: string } | null;
}

export interface CopilotToastsApi {
  toasts: ActiveCopilotToasts;
  dismissRateLimit: () => void;
  dismissGuardrail: () => void;
}

/**
 * Panel-side hook. Tracks the most recent rate-limit + guardrail
 * events. The `key` is monotonic so the same toast re-mounts
 * cleanly when a new event arrives mid-display.
 */
export function useCopilotToasts(): CopilotToastsApi {
  const [rateLimit, setRateLimit] = React.useState<{
    retryAfter: number;
    key: string;
  } | null>(null);
  const [guardrail, setGuardrail] = React.useState<{ key: string } | null>(
    null,
  );
  const seqRef = React.useRef(0);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    function nextKey(): string {
      seqRef.current += 1;
      return `${Date.now()}-${seqRef.current}`;
    }
    function onRateLimit(e: Event) {
      const detail = (e as CustomEvent<RateLimitEventDetail>).detail;
      const retryAfter = Number(detail?.retryAfter ?? 0);
      if (!Number.isFinite(retryAfter) || retryAfter < 0) return;
      setRateLimit({ retryAfter, key: nextKey() });
    }
    function onGuardrail() {
      setGuardrail({ key: nextKey() });
    }
    window.addEventListener(COPILOT_RATE_LIMIT_EVENT, onRateLimit);
    window.addEventListener(COPILOT_GUARDRAIL_DENIED_EVENT, onGuardrail);
    return () => {
      window.removeEventListener(COPILOT_RATE_LIMIT_EVENT, onRateLimit);
      window.removeEventListener(COPILOT_GUARDRAIL_DENIED_EVENT, onGuardrail);
    };
  }, []);

  return {
    toasts: { rateLimit, guardrail },
    dismissRateLimit: React.useCallback(() => setRateLimit(null), []),
    dismissGuardrail: React.useCallback(() => setGuardrail(null), []),
  };
}