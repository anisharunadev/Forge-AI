'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Forge empty state — first-run and filtered-zero result component.
 *
 * Two variants:
 *   - **full**     (default) — 96×96 illustration, py-24, suggestions.
 *   - **compact**  — 64×64 illustration, py-12, no suggestions.
 *
 * Skill influence (`08-empty-ux.md`):
 *   - "Show helpful message and action" → title + primary CTA always.
 *   - "Don't blank empty screens" → illustration + description.
 *
 * Skill influence (`09-empty-illustration.md`):
 *   - OLED dark base, indigo accent — matches Step 1 tokens.
 *
 * Accessibility: `role="status"` + `aria-live="polite"` so screen
 * readers announce the new content when the list flips to empty.
 */
export interface EmptyStateAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon?: React.ReactNode;
}

export interface EmptyStateQuickPath {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  readonly onClick?: () => void;
}

export interface EmptyStateProps {
  /** Lucide icon or any node — rendered inside the 80×80 (or 56×56) tile. */
  readonly illustration?: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly primaryAction?: EmptyStateAction;
  readonly secondaryAction?: EmptyStateAction;
  readonly suggestions?: ReadonlyArray<string>;
  readonly onSuggestionPick?: (suggestion: string) => void;
  readonly compact?: boolean;
  /** Optional "quick-start" paths shown beneath the CTA row in the
   *  full variant. Step 38 (Fix 9) — replaces single-button empty
   *  states with 3-paths onboarding. */
  readonly quickPaths?: ReadonlyArray<EmptyStateQuickPath>;
}

export function EmptyState({
  illustration,
  title,
  description,
  primaryAction,
  secondaryAction,
  suggestions,
  onSuggestionPick,
  compact = false,
  quickPaths,
}: EmptyStateProps) {
  const IconSize = compact ? 28 : 40;
  const tile = compact ? 'h-16 w-16' : 'h-20 w-20';
  const pad = compact ? 'py-12' : 'py-24';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'mx-auto flex max-w-[480px] flex-col items-center justify-center px-6 text-center',
        pad,
      )}
      data-testid="empty-state"
      data-variant={compact ? 'compact' : 'full'}
    >
      <div
        className={cn(
          tile,
          'flex items-center justify-center rounded-[var(--radius-xl)] bg-[rgba(99,102,241,0.08)]',
          'animate-[pulse-glow_2.4s_ease-in-out_infinite]',
        )}
        aria-hidden="true"
      >
        <div
          className="text-[var(--accent-primary)]"
          style={{ width: IconSize, height: IconSize }}
        >
          {illustration ?? <Sparkles size={IconSize} strokeWidth={1.5} />}
        </div>
      </div>

      <h3
        className={cn(
          'mt-5 font-semibold text-[var(--fg-primary)]',
          compact ? 'text-base' : 'text-[var(--text-lg)]',
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          'mt-2 max-w-[420px] text-[var(--fg-secondary)] line-clamp-2',
          compact ? 'text-[13px]' : 'text-[var(--text-sm)]',
        )}
      >
        {description}
      </p>

      {(primaryAction || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {primaryAction && (
            <Button
              type="button"
              onClick={primaryAction.onClick}
              className="bg-[var(--accent-primary)] text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              {primaryAction.icon ? (
                <span className="mr-1.5 inline-flex" aria-hidden="true">
                  {primaryAction.icon}
                </span>
              ) : null}
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              type="button"
              variant="ghost"
              onClick={secondaryAction.onClick}
              className="text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              {secondaryAction.icon ? (
                <span className="mr-1.5 inline-flex" aria-hidden="true">
                  {secondaryAction.icon}
                </span>
              ) : null}
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}

      {!compact && suggestions && suggestions.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggestionPick?.(s)}
              className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] transition-colors duration-150 ease-out-soft hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {!compact && quickPaths && quickPaths.length > 0 ? (
        <div className="mt-6 w-full">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
            Or pick a starting point
          </p>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
            {quickPaths.map((q) => {
              const className = cn(
                'flex flex-col items-start gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)]',
                'bg-[var(--bg-elevated)] px-3 py-2.5 text-left text-xs text-[var(--fg-secondary)]',
                'transition-colors duration-fast ease-out-soft',
                'hover:border-[var(--accent-primary)] hover:text-[var(--fg-primary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              );
              const inner = (
                <>
                  <span className="text-[var(--fg-primary)]">{q.label}</span>
                  {q.href ? (
                    <span className="text-[10px] text-[var(--fg-tertiary)]">↗ {q.href}</span>
                  ) : null}
                </>
              );
              if (q.href) {
                return (
                  <a key={q.id} href={q.href} className={className}>
                    {inner}
                  </a>
                );
              }
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={q.onClick}
                  className={className}
                >
                  {inner}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}