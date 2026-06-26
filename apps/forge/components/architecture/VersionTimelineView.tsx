'use client';

/**
 * Architecture Center — Vertical version timeline (Step 3 enhanced).
 *
 * Per-version card = version number, release date, collapsible
 * changelog, "Promote" button. Promote fires a Sonner toast.
 *
 * Skill influence:
 *   - `06-keyboard-ux.md` — `prefers-reduced-motion` honoured globally;
 *     collapse uses CSS height transition only (no Framer Motion).
 *   - `07-collapse-breadcrumb.md` — collapse pattern uses a single
 *     `<details>` element for native a11y + focus order.
 */

import * as React from 'react';
import { ArrowUpCircle, History as HistoryIcon, Rocket } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/src/components/empty-state';
import { cn } from '@/lib/utils';
import type { ArchitectureVersion } from '@/lib/architecture/data';

export interface VersionTimelineViewProps {
  versions: ReadonlyArray<ArchitectureVersion>;
}

export function VersionTimelineView({ versions }: VersionTimelineViewProps) {
  if (versions.length === 0) {
    return (
      <div data-testid="versions-empty">
        <EmptyState
          illustration={<HistoryIcon size={40} strokeWidth={1.5} />}
          title="No architecture versions yet"
          description="Versions track ADR snapshots over time. The first one is created when an ADR is approved."
        />
      </div>
    );
  }

  const handlePromote = (v: ArchitectureVersion) => {
    toast.success(`Promoted ${v.version} to current`, {
      description: `Released ${new Date(v.releasedAt).toLocaleDateString()}`,
      duration: 3500,
    });
  };

  return (
    <ol
      aria-label="Architecture versions"
      className="relative ml-3 border-l border-[var(--border-default)]"
      data-testid="version-timeline"
    >
      {versions.map((v, i) => (
        <li
          key={v.version}
          data-testid="version-timeline-item"
          data-version={v.version}
          className="mb-6 ml-6"
        >
          <span
            className={cn(
              'absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full border',
              i === 0
                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
                : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--fg-secondary)]',
            )}
            aria-hidden="true"
          >
            <Rocket className="h-3 w-3" />
          </span>

          <article className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)]">
            <header className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold leading-tight text-[var(--fg-primary)]">
                  {v.version}
                </h3>
                <time className="font-mono text-xs text-[var(--fg-tertiary)]">
                  Released {new Date(v.releasedAt).toLocaleDateString()}
                </time>
              </div>
              <div className="flex items-center gap-2">
                {i === 0 ? (
                  <span className="rounded-[var(--radius-sm)] bg-[rgba(99,102,241,0.12)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent-primary)]">
                    current
                  </span>
                ) : null}
                <Button
                  variant={i === 0 ? 'ghost' : 'outline'}
                  size="sm"
                  onClick={() => handlePromote(v)}
                  disabled={i === 0}
                  data-testid={`version-promote-${v.version}`}
                  className="text-xs"
                >
                  <ArrowUpCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                  Promote
                </Button>
              </div>
            </header>
            <details className="group mt-3">
              <summary className="cursor-pointer select-none text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
                Changelog ({v.highlights.length})
              </summary>
              <ul className="mt-2 list-inside list-disc text-sm text-[var(--fg-secondary)]">
                {v.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </details>
          </article>
        </li>
      ))}
    </ol>
  );
}