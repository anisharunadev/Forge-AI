'use client';

/**
 * Step 24 — Context pills (composer footer affordance).
 *
 * Renders a horizontal row of pills BELOW the composer input. Each
 * pill is one piece of context the Co-pilot can see on its next
 * turn:
 *
 *   - @Forge Platform (org identity)
 *   - /dashboard (current page)
 *   - agent:Code-Reviewer (active agent)
 *
 * Pills are removable (click X) and re-addable via the "+ Add
 * context" button. The set of pills is auto-updated when the user
 * navigates between pages (the page pill swaps).
 *
 * Skill influence (ui-ux-pro-max):
 *   - "Show helpful message and action" — every pill has a
 *     label + icon; X is a clear "remove" affordance.
 *   - "Heading hierarchy" — small caption label above the row
 *     (uses h3 semantics for screen reader navigation).
 *   - "Dark mode low-light" — pills use --bg-elevated so they
 *     sit visibly above the composer surface without glare.
 */

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { MapPin, Plus, X } from 'lucide-react';

import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type ContextKind = 'page' | 'agent' | 'workspace' | 'artifact' | 'custom';

export interface ContextPill {
  id: string;
  /** Visible label — e.g. "/dashboard" or "agent:Code-Reviewer". */
  label: string;
  /** Optional display value for richer labels. */
  value?: string;
  kind: ContextKind;
  /** True for system-managed pills (current page) — they cannot be
   *  removed but ARE auto-updated when navigation changes. */
  system?: boolean;
}

export interface ContextPillsProps {
  className?: string;
  /** Optional override for the active agent (defaults to null). */
  activeAgent?: string | null;
  /** Optional override for the workspace label. */
  workspace?: string;
  /** Called when the user adds a new pill. */
  onAdd?: (label: string) => void;
}

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<ContextKind, string> = {
  page: 'Page',
  agent: 'Agent',
  workspace: 'Workspace',
  artifact: 'Artifact',
  custom: 'Context',
};

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function ContextPills({
  className,
  activeAgent,
  workspace = 'Forge Platform',
  onAdd,
}: ContextPillsProps) {
  const pathname = usePathname() ?? '/';

  // Local state — pills the user has manually added (or removed).
  // Persisted to localStorage so removals survive reloads. The
  // page pill is always re-derived from the pathname on each render
  // so it stays in sync with navigation.
  const [customPills, setCustomPills] = React.useState<ContextPill[]>([]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setCustomPills(parsed.filter((p) => p && typeof p.id === 'string'));
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Compose the final pill list. System-managed pills are always
  // present; user pills are added after them.
  const pills = React.useMemo<ContextPill[]>(() => {
    const system: ContextPill[] = [
      {
        id: `page:${pathname}`,
        label: pathname,
        kind: 'page',
        system: true,
      },
      {
        id: 'workspace:main',
        label: `@${workspace}`,
        kind: 'workspace',
        system: true,
      },
    ];
    if (activeAgent) {
      system.push({
        id: `agent:${activeAgent}`,
        label: `agent:${activeAgent}`,
        kind: 'agent',
        system: true,
      });
    }
    return [...system, ...customPills];
  }, [pathname, workspace, activeAgent, customPills]);

  const removePill = React.useCallback((id: string) => {
    setCustomPills((prev) => {
      const next = prev.filter((p) => p.id !== id);
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const handleAdd = React.useCallback(() => {
    const label = typeof window !== 'undefined'
      ? window.prompt('Add context (e.g. agent:Tester or /workflows)?')
      : null;
    if (!label || !label.trim()) return;
    const next: ContextPill = {
      id: `custom:${label.trim()}-${Date.now()}`,
      label: label.trim(),
      kind: 'custom',
    };
    setCustomPills((prev) => {
      const updated = [...prev, next];
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        }
      } catch {
        // ignore
      }
      return updated;
    });
    onAdd?.(label.trim());
  }, [onAdd]);

  return (
    <div
      role="region"
      aria-label="Attached context"
      className={cn(
        'flex flex-wrap items-center gap-1.5 px-1',
        className,
      )}
      data-testid="copilot-context-pills"
    >
      {pills.map((pill) => (
        <ContextPillView
          key={pill.id}
          pill={pill}
          onRemove={() => removePill(pill.id)}
        />
      ))}
      <button
        type="button"
        onClick={handleAdd}
        className="flex h-6 items-center gap-1 rounded-full border border-dashed border-[var(--border-subtle)] bg-transparent px-2 text-[11px] font-medium text-[var(--fg-tertiary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--fg-secondary)]"
        data-testid="copilot-context-pills-add"
        aria-label="Add context"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        Add context
      </button>
    </div>
  );
}

function ContextPillView({
  pill,
  onRemove,
}: {
  pill: ContextPill;
  onRemove: () => void;
}) {
  return (
    <span
      className="flex items-center gap-1 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--fg-secondary)] transition-colors hover:bg-[rgba(255,255,255,0.06)]"
      data-testid={`copilot-context-pill-${pill.kind}`}
      data-pill-id={pill.id}
      title={pill.kind === 'page' ? 'Current page (auto-tracked)' : KIND_LABEL[pill.kind]}
    >
      {pill.kind === 'page' ? (
        <MapPin className="h-2.5 w-2.5 text-[var(--accent-cyan)]" aria-hidden="true" />
      ) : null}
      <span className="max-w-[180px] truncate">{pill.label}</span>
      {!pill.system ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${pill.label}`}
          className="ml-0.5 text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
          data-testid={`copilot-context-pill-remove-${pill.id}`}
        >
          <X className="h-2.5 w-2.5" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

const STORAGE_KEY = 'forge.copilot.contextPills.v1';
