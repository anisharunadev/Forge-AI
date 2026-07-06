'use client';

/**
 * CenterStateBanner — Sprint 5 (M15).
 *
 * The universal banner primitive that every Forge center uses to tell the
 * operator exactly which kind of data it is rendering. Supersedes Sprint 3's
 * `OfflineBanner` (kept as a re-export shim for backward compatibility).
 *
 * Five states, each mapped to a tone + a11y role:
 *
 *   live     — no banner. Default; the page is rendering real backend data.
 *   demo     — amber, "Demo data loaded". seed/demo fixtures are visible.
 *   cached   — blue,  "Showing cached data". stale cache hit, no live.
 *   error    — red,   "Couldn't load — retry". role=alert.
 *   loading  — gray,  "Loading…". Pending query with no data yet.
 *
 * The component is intentionally a leaf — it does NOT call any hooks.
 * Each center composes its own thin wrapper that reads its data hook and
 * passes `state` + copy down. This keeps the banner testable in isolation
 * (no QueryClientProvider, no router, no provider tree).
 *
 * Test seams:
 *   - `data-testid="center-state-banner"` is always present for non-live.
 *   - `data-testid="center-state-banner-{state}"` is the per-state hook for
 *     Playwright / vitest assertions.
 *   - a11y: `role="status"` + `aria-live="polite"` for non-error states,
 *     `role="alert"` + `aria-live="assertive"` for error.
 *   - `mb-3` margin mirrors Sprint 3's OfflineBanner so layout doesn't shift.
 *
 * ponytail: leaf component, no provider, no async. If a center needs
 * something more elaborate (Retry button, hash-chain copy, etc.) it
 * wraps its own banner instance with extra buttons — not this primitive.
 */

import * as React from 'react';
import {
  AlertCircle,
  Database,
  Loader2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export type CenterState = 'live' | 'demo' | 'cached' | 'error' | 'loading';

export interface CenterStateBannerProps {
  /** Required. Live = render null. Any other value renders the banner. */
  readonly state: CenterState;
  /** Optional override of the title. Defaults to the state-default copy. */
  readonly title?: string;
  /** Optional override of the description copy. */
  readonly description?: string;
  /** Optional CTA (e.g. retry button). Rendered to the right of the copy. */
  readonly action?: React.ReactNode;
  /**
   * Optional override of the testid suffix. Default = `state`. Use this
   * only when a single page renders multiple banners (Audit center has
   * the integrity banner alongside the generic CenterStateBanner).
   */
  readonly testIdSuffix?: string;
}

const STATE_DEFAULTS: Record<
  Exclude<CenterState, 'live'>,
  {
    icon: LucideIcon;
    title: string;
    description: string;
    variant: 'default' | 'destructive' | 'warning' | 'info';
  }
> = {
  demo: {
    icon: Sparkles,
    title: 'Demo data loaded',
    description:
      'You are viewing the seed fixture dataset. Decisions made here will not persist against real tenants.',
    variant: 'warning',
  },
  cached: {
    icon: Database,
    title: 'Showing cached data',
    description:
      'The backend is unreachable. The center is rendering the most recent successful response so you can keep working.',
    variant: 'info',
  },
  error: {
    icon: AlertCircle,
    title: "Couldn't load — retry",
    description:
      'The Forge API returned an error. The center is rendering an empty state until the next successful load.',
    variant: 'destructive',
  },
  loading: {
    icon: Loader2,
    title: 'Loading…',
    description: 'Fetching the latest data from the Forge API.',
    variant: 'default',
  },
};

export function CenterStateBanner({
  state,
  title,
  description,
  action,
  testIdSuffix,
}: CenterStateBannerProps) {
  if (state === 'live') return null;

  const cfg = STATE_DEFAULTS[state];
  const Icon = cfg.icon;
  const isError = state === 'error';
  const suffix = testIdSuffix ?? state;

  return (
    <Alert
      variant={cfg.variant}
      className="mb-3"
      data-testid="center-state-banner"
      data-banner-state={state}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <Icon
        className={state === 'loading' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
        aria-hidden="true"
      />
      <AlertTitle data-testid={`center-state-banner-${suffix}`}>
        {title ?? cfg.title}
      </AlertTitle>
      <AlertDescription>{description ?? cfg.description}</AlertDescription>
      {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
    </Alert>
  );
}

CenterStateBanner.displayName = 'CenterStateBanner';
