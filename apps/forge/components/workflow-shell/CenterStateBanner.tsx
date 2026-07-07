/**
 * CenterStateBanner — single source of truth for the five data-source
 * states the workflow shell surfaces.
 *
 * Replaces the legacy `OfflineBanner` pattern (which had a single
 * "online / offline" toggle). The audit's P0 critical blocker #1 was
 * that `LiveConnectorDataProvider` silently fell back to a mock —
 * the user never knew. `CenterStateBanner` is the typed, auditable
 * counterpart: every stage page renders one of these, and the
 * `data-state` attribute is queryable in e2e tests.
 *
 * Visual language (mirrored from the existing design system tokens):
 *
 *   - `live`    — emerald dot, no copy ("Live data")
 *   - `cached`  — amber dot, "Cached — read-only"
 *   - `demo`    — violet dot, "Demo data — not for production"
 *   - `error`   — rose dot, "API error — retry in progress"
 *   - `loading` — pulsing dot, "Loading"
 *
 * Accessibility: the banner is an `aria-live="polite"` region so
 * screen readers announce state changes without interrupting.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  STATE_LABEL,
  STATE_TESTID,
  type CenterState,
} from '@/lib/workflow-shell/states';

export interface CenterStateBannerProps {
  readonly state: CenterState;
  /** Optional override label (used when `state` is `error` to show the API code). */
  readonly detail?: string;
  readonly className?: string;
}

const STATE_TONE: Readonly<Record<CenterState, string>> = {
  live: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200',
  cached: 'border-amber-500/30 bg-amber-500/5 text-amber-200',
  demo: 'border-violet-500/30 bg-violet-500/5 text-violet-200',
  error: 'border-rose-500/40 bg-rose-500/5 text-rose-200',
  loading: 'border-sky-500/30 bg-sky-500/5 text-sky-200',
};

const STATE_DOT: Readonly<Record<CenterState, string>> = {
  live: 'bg-emerald-400',
  cached: 'bg-amber-400',
  demo: 'bg-violet-400',
  error: 'bg-rose-400',
  loading: 'bg-sky-400 animate-pulse',
};

export function CenterStateBanner({
  state,
  detail,
  className,
}: CenterStateBannerProps) {
  const label = STATE_LABEL[state];
  const showDetail = state === 'error' && detail && detail.length > 0;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={STATE_TESTID[state]}
      data-state={state}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
        STATE_TONE[state],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('inline-block h-2 w-2 rounded-full', STATE_DOT[state])}
      />
      <span>
        {label}
        {showDetail ? <span className="ml-1 opacity-80">— {detail}</span> : null}
      </span>
    </div>
  );
}