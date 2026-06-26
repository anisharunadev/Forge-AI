'use client';

/**
 * Step 37 — Collapsible context strip.
 *
 * Replaces the always-visible "What I can see right now" card with a
 * single-line, low-priority pill that expands on click. Default state
 * is collapsed so it stops eating ~80px of vertical space in the
 * welcome card.
 *
 * Design rules (ui-ux-pro-max):
 *   - "AI-Native UI" — context indicators should be ambient, not
 *     foreground. One line, subtle type, expands on demand.
 *   - "User freedom" — clearing context is one click away (the
 *     expand affordance surfaces the same X the old card had).
 */

import * as React from 'react';
import { ChevronDown, ChevronUp, MapPin, Plus, X } from 'lucide-react';

import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

export interface ContextItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  iconColor?: string;
}

export interface ContextStripProps {
  /** Pathname or friendly page label, e.g. "/dashboard". */
  pathname: string;
  /** Page-aware counts — currently stubbed to 3 agents / 1 run. */
  items?: ReadonlyArray<ContextItem>;
  className?: string;
}

/**
 * Single-line pill that expands to reveal per-pill detail. Used by
 * `EmptyState` (welcome) AND optionally by the composer when context
 * is rich enough to surface inline.
 *
 * The default collapsed row reads like a Linear-style status pill:
 *
 *   📍 /dashboard · 3 agents · 1 run   ▾
 */
export function ContextStrip({
  pathname,
  items = DEFAULT_ITEMS,
  className,
}: ContextStripProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [cleared, setCleared] = React.useState(false);
  const setDraft = useCopilotStore((s) => s.setDraft);

  const summary = `${pathname} · ${items.length} context item${items.length === 1 ? '' : 's'}`;

  if (cleared) {
    return (
      <button
        type="button"
        onClick={() => setCleared(false)}
        className={cn(
          'flex items-center gap-1 self-center rounded-full border border-dashed border-[var(--border-subtle)] bg-transparent px-2.5 py-0.5 text-[10px] text-[var(--fg-tertiary)]',
          'hover:border-[var(--border-default)] hover:text-[var(--fg-secondary)]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
          className,
        )}
        data-testid="copilot-context-strip-restored"
      >
        <Plus className="h-2.5 w-2.5" aria-hidden="true" />
        Add context
      </button>
    );
  }

  return (
    <div className={cn('flex w-full flex-col items-center', className)}>
      {/* Collapsed pill — single line. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="copilot-context-strip-detail"
        className={cn(
          'flex w-fit max-w-full items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1 text-[10px] text-[var(--fg-tertiary)]',
          'hover:border-[var(--border-default)] hover:text-[var(--fg-secondary)]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
        )}
        data-testid="copilot-context-strip-toggle"
      >
        <MapPin aria-hidden="true" className="h-3 w-3 text-[var(--accent-cyan)]" />
        <span className="truncate">{summary}</span>
        {expanded ? (
          <ChevronUp aria-hidden="true" className="h-3 w-3" />
        ) : (
          <ChevronDown aria-hidden="true" className="h-3 w-3" />
        )}
      </button>

      {expanded ? (
        <div
          id="copilot-context-strip-detail"
          className="mt-2 flex w-full flex-col gap-1"
          data-testid="copilot-context-strip-detail"
        >
          <ul className="flex flex-col gap-1">
            <li>
              <span className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--bg-base)] px-2 py-1 text-[11px] text-[var(--fg-secondary)]">
                <MapPin
                  aria-hidden="true"
                  className="h-3 w-3 text-[var(--accent-cyan)]"
                />
                <span className="truncate">On {pathname}</span>
              </span>
            </li>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <span className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--bg-base)] px-2 py-1 text-[11px] text-[var(--fg-secondary)]">
                    {Icon ? (
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          'h-3 w-3 shrink-0',
                          item.iconColor ?? 'text-[var(--fg-tertiary)]',
                        )}
                      />
                    ) : null}
                    <span className="truncate">{item.label}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setCleared(true);
                setExpanded(false);
              }}
              className="flex items-center gap-1 text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--fg-secondary)]"
              data-testid="copilot-context-strip-clear"
            >
              <X className="h-2.5 w-2.5" aria-hidden="true" />
              Clear context
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(`@${pathname} `);
                setExpanded(false);
              }}
              className="flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--fg-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--fg-primary)]"
              data-testid="copilot-context-strip-add"
            >
              <Plus className="h-2.5 w-2.5" aria-hidden="true" />
              Add to message
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DEFAULT_ITEMS: ReadonlyArray<ContextItem> = [
  {
    id: 'agents',
    label: '3 agents active',
    icon: BotIcon,
    iconColor: 'text-[var(--accent-emerald)]',
  },
  {
    id: 'runs',
    label: '1 run in progress',
    icon: ActivityIcon,
    iconColor: 'text-[var(--accent-primary)]',
  },
];

// Local icon stubs to avoid importing the lucide set for two icons
// (the parent already imports lucide — but inline components keep
// this file's graph cheap).
function BotIcon({
  className,
  'aria-hidden': ariaHidden,
}: {
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={ariaHidden}
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

function ActivityIcon({
  className,
  'aria-hidden': ariaHidden,
}: {
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={ariaHidden}
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

export default ContextStrip;
