'use client';

/**
 * Agent Center — Rich per-tab empty state (Step 43 / Addition 4).
 *
 * Replaces the lean per-tab empty states when the page is in
 * "first-run" mode with value-focused copy:
 *
 *   - Title explains what the tab is FOR (not what is missing)
 *   - Description names the concrete benefit
 *   - Primary CTA has the right verb + icon
 *   - Secondary CTA links to docs
 *   - "Learn more" link is always present
 *
 * Falls back to a neutral variant when first-run is OFF so the page
 * still renders correctly when there are items but the user filters
 * down to zero rows.
 *
 * Constraints adopted from skill searches:
 *   - "Guide users when no content exists" — never blank screens.
 *   - "Provide Skip and Back buttons" — secondary actions never
 *     lock the user out.
 *   - Every status also carries a textual label (not just colour).
 */

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shell';

export interface AgentCenterEmptyStateProps {
  /** Lucide icon node. */
  icon: React.ReactNode;
  /** Headline. */
  title: string;
  /** Description (always shown). */
  description: string;
  /** Primary CTA. */
  primary: { label: string; onClick: () => void; icon?: React.ReactNode };
  /** Secondary CTA — render only when provided. */
  secondary?: { label: string; onClick?: () => void; href?: string };
  /** "Learn more" link rendered below the body. */
  learnMoreHref?: string;
  learnMoreLabel?: string;
  /** When true, applies the value-focused first-run copy styles. */
  valueFocused?: boolean;
  testId?: string;
}

export function AgentCenterEmptyState({
  icon,
  title,
  description,
  primary,
  secondary,
  learnMoreHref,
  learnMoreLabel = 'Learn more',
  valueFocused = true,
  testId = 'tab-empty-state',
}: AgentCenterEmptyStateProps) {
  if (!valueFocused) {
    return (
      <EmptyState
        icon={icon}
        title={title}
        description={description}
        action={
          <Button
            type="button"
            onClick={primary.onClick}
            data-testid={`${testId}-primary`}
            className="bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            {primary.icon ? (
              <span className="mr-1.5 inline-flex" aria-hidden="true">
                {primary.icon}
              </span>
            ) : null}
            {primary.label}
          </Button>
        }
        testId={testId}
      />
    );
  }

  return (
    <div
      data-testid={testId}
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)]',
        'border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
        'px-6 py-10 text-center',
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--accent-primary)]"
      >
        {icon}
      </span>
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-[var(--fg-primary)]">{title}</h3>
        <p className="mx-auto max-w-md text-sm text-[var(--fg-secondary)]">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={primary.onClick}
          data-testid={`${testId}-primary`}
          className="bg-[var(--accent-primary)] text-white hover:opacity-90"
        >
          {primary.icon ? (
            <span className="mr-1.5 inline-flex" aria-hidden="true">
              {primary.icon}
            </span>
          ) : null}
          {primary.label}
        </Button>
        {secondary ? (
          secondary.href ? (
            <a
              href={secondary.href}
              data-testid={`${testId}-secondary`}
              className="inline-flex h-9 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
            >
              {secondary.label}
            </a>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={secondary.onClick}
              data-testid={`${testId}-secondary`}
              className="border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
            >
              {secondary.label}
            </Button>
          )
        ) : null}
      </div>
      {learnMoreHref ? (
        <a
          href={learnMoreHref}
          data-testid={`${testId}-learn-more`}
          className="text-xs text-[var(--accent-primary)] underline-offset-4 hover:underline"
        >
          {learnMoreLabel} →
        </a>
      ) : null}
    </div>
  );
}
