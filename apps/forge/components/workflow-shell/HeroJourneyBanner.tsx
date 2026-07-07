/**
 * HeroJourneyBanner — the persistent spine above every workflow page.
 *
 * Per M20 (Phase C — Experience), the workflow shell now exposes a
 * continuous hero journey surface. The banner shows:
 *
 *   1. The elapsed time since the user started the journey
 *      (Idea → PR). The north-star metric.
 *   2. The next step with a single CTA — what the user should do
 *      next, with no discoverability cliff.
 *   3. A 1-line hint explaining why this step matters.
 *
 * The banner intentionally does NOT compete with the workflow
 * progress bar (which is always visible at the top of the layout).
 * The progress bar shows "where in the workflow you are"; this
 * banner shows "what you should do next".
 */

'use client';

import * as React from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  formatElapsed,
  getNextHeroStep,
  readJourneyStart,
} from '@/lib/workflow-shell/hero-journey';
import type { WorkflowStageId } from '@/lib/workflow-shell/types';

export interface HeroJourneyBannerProps {
  /** The stage the user is currently viewing. */
  readonly stage: WorkflowStageId;
  /** Optional override for elapsed time (ms) — useful for tests. */
  readonly nowMs?: number;
  readonly className?: string;
}

export function HeroJourneyBanner({
  stage,
  nowMs,
  className,
}: HeroJourneyBannerProps) {
  // Live elapsed ticker — updates every second while the banner is
  // mounted. SSR-safe: starts at null and resolves on mount.
  const [start, setStart] = React.useState<number | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    setStart(readJourneyStart());
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const next = getNextHeroStep(stage);
  const elapsedMs =
    nowMs !== undefined
      ? nowMs - (start ?? nowMs)
      : start !== null
        ? Date.now() - start
        : 0;
  const elapsedLabel = start === null ? 'Not started yet' : formatElapsed(elapsedMs);

  return (
    <Card
      role="region"
      aria-label="Hero journey status"
      data-testid="hero-journey-banner"
      data-elapsed-ms={elapsedMs}
      className={cn(
        'border-border bg-gradient-to-r from-card/80 via-card/60 to-card/80',
        className,
      )}
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex flex-col gap-0.5" data-testid="hero-journey-status">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Hero journey
            </span>
            <span
              data-testid="hero-journey-elapsed"
              className="font-mono text-sm font-medium tabular-nums"
            >
              {elapsedLabel}
            </span>
          </div>
          {next ? (
            <p className="text-xs text-muted-foreground">{next.oneLiner}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Final step — your idea is in production.
            </p>
          )}
        </div>
        {next ? (
          <Button asChild variant="default" size="sm">
            <Link
              href={next.path}
              data-testid="hero-journey-next-cta"
              aria-label={`Continue to ${next.label}`}
            >
              Next: {next.label}
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}