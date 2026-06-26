'use client';

/**
 * ProjectContextBar — sticky top context bar for the Project Intelligence
 * center (Step 20).
 *
 * Layout (h-72px, --bg-base, backdrop-blur, border-b --border-subtle):
 *   - Left:   project selector (Command-style Combobox, ⌘P hint).
 *   - Middle: breadcrumbs "Tenant / Project / Center".
 *   - Right:  last-sync, health pill, export, new-epic.
 *
 * Sticky behavior uses `position: sticky; top: 0` so it pins inside the
 * scroll container. The Combobox is a lightweight popover — the option
 * list is computed client-side from the passed projects.
 */

import * as React from 'react';
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  Cloud,
  Download,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusPill } from '@/components/shell';
import { Button } from '@/components/ui/button';

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
  readonly region?: string;
  readonly initials: string;
}

export interface HealthState {
  readonly status: 'healthy' | 'degraded' | 'down';
  readonly label: string;
}

export interface ProjectContextBarProps {
  /** Current tenant display name (e.g. "Acme Corp (Dev Demo)"). */
  tenantName: string;
  /** Current tenant slug (e.g. "acme-corp"). */
  tenantSlug: string;
  /** Current project being viewed. */
  project: ProjectOption;
  /** Other projects in the tenant (for the Combobox). */
  projects: ReadonlyArray<ProjectOption>;
  /** Fired when the user picks a different project. */
  onProjectChange?: (projectId: string) => void;
  /** "Last sync: 2m ago" — server-rendered. */
  lastSyncLabel: string;
  /** Health pill state. */
  health: HealthState;
  /** Breadcrumb segments. Last segment is the current page. */
  breadcrumbs: ReadonlyArray<{ label: string; href?: string }>;
  /** Right-cluster action handlers. */
  onRefresh?: () => void;
  onExport?: () => void;
  onNewEpic?: () => void;
}

function healthTone(h: HealthState['status']): 'success' | 'warn' | 'danger' {
  switch (h) {
    case 'healthy':
      return 'success';
    case 'degraded':
      return 'warn';
    case 'down':
      return 'danger';
  }
}

function healthGlyph(h: HealthState['status']): '✓' | '◑' | '✕' {
  switch (h) {
    case 'healthy':
      return '✓';
    case 'degraded':
      return '◑';
    case 'down':
      return '✕';
  }
}

export function ProjectContextBar({
  tenantName,
  tenantSlug,
  project,
  projects,
  onProjectChange,
  lastSyncLabel,
  health,
  breadcrumbs,
  onRefresh,
  onExport,
  onNewEpic,
}: ProjectContextBarProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Click-outside to close
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // ⌘P / Ctrl+P — open the project switcher
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [projects, query]);

  return (
    <div
      className={cn(
        'sticky top-0 z-30 h-[72px] border-b border-[var(--border-subtle)]',
        'bg-[var(--bg-base)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg-base)]/70',
      )}
      data-testid="project-context-bar"
    >
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-4 md:px-6">
        {/* LEFT: project selector */}
        <div ref={containerRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              'group inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)]',
              'bg-[var(--bg-surface)] px-3 text-left transition-colors duration-150',
              'hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
            )}
            aria-haspopup="listbox"
            aria-expanded={open}
            data-testid="project-selector-trigger"
          >
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-primary)]/15 text-[10px] font-semibold text-[var(--accent-primary)]"
              aria-hidden="true"
            >
              {project.initials.slice(0, 2).toUpperCase()}
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[12px] font-medium text-[var(--fg-primary)]">
                {project.name}
              </span>
              <span className="text-[10px] text-[var(--fg-tertiary)]">
                {tenantName}
                {project.region ? ` · ${project.region}` : ''}
              </span>
            </div>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-[var(--fg-tertiary)] transition-transform duration-150',
                open && 'rotate-180',
              )}
              aria-hidden="true"
            />
            <kbd className="ml-1 hidden rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)] md:inline-flex">
              ⌘P
            </kbd>
          </button>

          {open ? (
            <div
              role="listbox"
              aria-label="Projects in this tenant"
              className={cn(
                'absolute left-0 top-12 z-40 w-[320px] origin-top-left',
                'rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
                'shadow-[var(--shadow-lg)]',
              )}
              data-testid="project-selector-menu"
            >
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
                <Search className="h-3.5 w-3.5 text-[var(--fg-tertiary)]" aria-hidden="true" />
                <input
                  type="text"
                  placeholder={`Search ${projects.length} projects…`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                  className="h-7 w-full bg-transparent text-[12px] text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
                  data-testid="project-selector-search"
                />
              </div>
              <ul className="max-h-[280px] overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <li className="px-3 py-4 text-center text-[12px] text-[var(--fg-tertiary)]">
                    No projects match.
                  </li>
                ) : (
                  filtered.map((p) => {
                    const active = p.id === project.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onProjectChange?.(p.id);
                            setOpen(false);
                            setQuery('');
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]',
                            'transition-colors duration-100',
                            active
                              ? 'bg-[var(--accent-primary)]/10 text-[var(--fg-primary)]'
                              : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
                          )}
                          data-testid="project-selector-item"
                          data-project-id={p.id}
                          data-active={active ? 'true' : 'false'}
                          role="option"
                          aria-selected={active}
                        >
                          <span
                            className={cn(
                              'inline-flex h-5 w-5 items-center justify-center rounded text-[9px] font-semibold',
                              active
                                ? 'bg-[var(--accent-primary)]/25 text-[var(--accent-primary)]'
                                : 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)]',
                            )}
                            aria-hidden="true"
                          >
                            {p.initials.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="flex flex-1 flex-col leading-tight">
                            <span className="font-medium">{p.name}</span>
                            <span className="text-[10px] text-[var(--fg-tertiary)]">
                              {p.id}
                              {p.region ? ` · ${p.region}` : ''}
                            </span>
                          </div>
                          {active ? (
                            <Check
                              className="h-3.5 w-3.5 text-[var(--accent-primary)]"
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              <div className="border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--fg-tertiary)]">
                Tenant <span className="font-mono">{tenantSlug}</span> ·{' '}
                {projects.length} project{projects.length === 1 ? '' : 's'}
              </div>
            </div>
          ) : null}
        </div>

        {/* MIDDLE: breadcrumbs */}
        <nav
          aria-label="Breadcrumb"
          className="hidden min-w-0 flex-1 items-center gap-1.5 text-[12px] text-[var(--fg-secondary)] md:flex"
          data-testid="project-breadcrumbs"
        >
          {breadcrumbs.map((b, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <React.Fragment key={`${b.label}-${i}`}>
                {i > 0 ? (
                  <span aria-hidden="true" className="text-[var(--fg-muted)]">
                    /
                  </span>
                ) : null}
                {b.href && !isLast ? (
                  <a
                    href={b.href}
                    className="rounded text-[var(--fg-secondary)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
                    data-testid={`project-breadcrumb-${b.label
                      .toLowerCase()
                      .replace(/\s+/g, '-')}`}
                  >
                    {b.label}
                  </a>
                ) : (
                  <span
                    aria-current="page"
                    className="truncate text-[var(--fg-primary)]"
                  >
                    {b.label}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </nav>

        {/* RIGHT cluster */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span
            className="hidden items-center gap-1 text-[11px] text-[var(--fg-tertiary)] md:inline-flex"
            data-testid="project-last-sync"
          >
            <Cloud className="h-3 w-3" aria-hidden="true" />
            Last sync: {lastSyncLabel}
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                aria-label="Refresh sync"
                data-testid="project-refresh"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </span>

          <StatusPill
            tone={healthTone(health.status)}
            glyph={healthGlyph(health.status)}
            label={health.label}
            size="sm"
            data-testid="project-health"
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onExport}
            data-testid="project-export"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export view
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={onNewEpic}
            data-testid="project-new-epic"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New epic
          </Button>
        </div>
      </div>
    </div>
  );
}
