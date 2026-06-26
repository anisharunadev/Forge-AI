'use client';

/**
 * Scope switcher — picks "Org-wide" or a specific project.
 *
 * Cmd/Ctrl+Shift+S toggles the combobox. The selected scope is reflected in
 * a pill next to the page title and is plumbed through to every tab so
 * counts and lists filter consistently.
 */

import * as React from 'react';
import { ChevronsUpDown, Check, Search, Globe2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROJECTS, type ProjectRef } from './sample-data';

export type Scope = { kind: 'org' } | { kind: 'project'; projectId: string };

interface Props {
  value: Scope;
  onChange: (next: Scope) => void;
  artifactCount: number;
}

const ORG_SCOPE: Scope = { kind: 'org' };

export function scopeLabel(scope: Scope, projects: ReadonlyArray<ProjectRef>): string {
  if (scope.kind === 'org') return 'Org-wide';
  return projects.find((p) => p.id === scope.projectId)?.name ?? 'Project';
}

export function ScopeSwitcher({ value, onChange, artifactCount }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PROJECTS;
    return PROJECTS.filter((p) => p.name.toLowerCase().includes(q));
  }, [query]);

  const currentLabel =
    value.kind === 'org' ? 'Org-wide' : PROJECTS.find((p) => p.id === value.projectId)?.name ?? 'Project';

  return (
    <div ref={containerRef} className="relative" data-testid="ok-scope-switcher">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid="ok-scope-trigger"
        className={cn(
          'inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--fg-primary)]',
          'transition-colors duration-150 hover:border-[var(--border-default)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}
      >
        {value.kind === 'org' ? (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
            <Globe2 className="h-2.5 w-2.5" aria-hidden="true" />
          </span>
        ) : (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-cyan)]/15 font-mono text-[9px] text-[var(--accent-cyan)]">
            P
          </span>
        )}
        <span className="font-medium">{currentLabel}</span>
        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{artifactCount}</span>
        <ChevronsUpDown className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
        <span className="ml-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1 font-mono text-[9px] text-[var(--fg-tertiary)]">
          ⌘⇧S
        </span>
      </button>
      {open ? (
        <div
          role="listbox"
          data-testid="ok-scope-popover"
          className="absolute right-0 z-30 mt-2 w-72 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 shadow-[var(--shadow-md)]"
        >
          <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5">
            <Search className="h-3 w-3 text-[var(--fg-tertiary)]" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects…"
              aria-label="Search projects"
              data-testid="ok-scope-search"
              className="w-full bg-transparent text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none"
            />
          </label>
          <button
            type="button"
            role="option"
            aria-selected={value.kind === 'org'}
            data-testid="ok-scope-org"
            onClick={() => {
              onChange(ORG_SCOPE);
              setOpen(false);
            }}
            className={cn(
              'mt-1 flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs',
              value.kind === 'org'
                ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]',
            )}
          >
            <span className="flex items-center gap-2">
              <Globe2 className="h-3 w-3" aria-hidden="true" />
              <span className="font-medium">Org-wide (all projects)</span>
            </span>
            {value.kind === 'org' ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
          </button>
          <p className="mt-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
            Projects
          </p>
          <ul className="max-h-60 overflow-y-auto" data-testid="ok-scope-list">
            {filtered.map((p) => {
              const isActive = value.kind === 'project' && value.projectId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-testid={`ok-scope-project-${p.id}`}
                    onClick={() => {
                      onChange({ kind: 'project', projectId: p.id });
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs',
                      isActive
                        ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                        : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-cyan)]/15 font-mono text-[9px] text-[var(--accent-cyan)]">
                        P
                      </span>
                      <span className="font-medium">{p.name}</span>
                    </span>
                    <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{p.artifactsCount}</span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center text-[10px] text-[var(--fg-muted)]">No matches</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}