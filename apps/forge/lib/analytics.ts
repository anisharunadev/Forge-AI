/**
 * apps/forge/lib/analytics.ts — typed event tracking shim (M15-8).
 *
 * Stand-in for PostHog / Segment / etc. Calls resolve to a no-op in
 * dev + a structured ``console.info`` call in any environment so the
 * event is observable in DevTools. The real provider is wired by
 * ops once a destination is decided; this file owns the call sites
 * so the swap is a 1-line edit.
 *
 * Typed event names are mandatory — the schema is the
 * single source of truth and tools like ``tsc`` enforce it.
 */

export type AnalyticsEventName =
  | 'idea.captured'
  | 'prd.generated'
  | 'adr.created'
  | 'task_breakdown.generated'
  | 'approval.requested'
  | 'approval.decided';

export interface AnalyticsContext {
  tenant_id?: string;
  project_id?: string;
  user_id?: string;
}

export interface AnalyticsPayload {
  [k: string]: string | number | boolean | undefined;
}

/**
 * Track a typed analytics event. No-op unless
 * ``NEXT_PUBLIC_ANALYTICS_TARGET`` is set; otherwise forwards to
 * the configured destination once ops flips the env var.
 */
export function track(
  event: AnalyticsEventName,
  payload?: AnalyticsPayload,
  context?: AnalyticsContext,
): void {
  if (typeof window === 'undefined') return;
  // ponytail: console.info is the swap point. Replace with the
  // chosen provider's call (e.g. ``posthog.capture(event, payload)``)
  // when ops flips NEXT_PUBLIC_ANALYTICS_TARGET.
  if (process.env.NEXT_PUBLIC_ANALYTICS_TARGET === 'noop') return;
  // eslint-disable-next-line no-console
  console.info(
    `[analytics] ${event}`,
    JSON.stringify({ payload: payload ?? {}, context: context ?? {} }),
  );
}
