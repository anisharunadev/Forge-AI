'use client';

import * as React from 'react';
import {
  Network,
  Filter,
  Focus,
  Database,
  Plus,
  Command,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type ViewMode = 'graph' | 'list' | 'outline';
export type GraphLayout = 'force' | 'tb' | 'lr' | 'radial' | 'grid' | 'timeline';

export interface GraphHeaderProps {
  search: string;
  onSearchChange: (next: string) => void;
  onSearchSubmit: () => void;
  layout: GraphLayout;
  onLayoutChange: (next: GraphLayout) => void;
  viewMode: ViewMode;
  onViewModeChange: (next: ViewMode) => void;
  localActive: boolean;
  onToggleLocal: () => void;
  localHops: number;
  onLocalHopsChange: (next: number) => void;
  filterCount: number;
  onOpenFilters: () => void;
  onOpenIngest: () => void;
  totalNodes: number;
  totalEdges: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Zone 1 — compact hero + toolbar.
 *
 * Hero is intentionally lean (no giant animated gradient — keeps the page
 * weight on the canvas). Toolbar carries search (⌘K), zoom buttons, the
 * layout dropdown, the segmented view-mode switch, the local-graph
 * toggle, the filters button (with badge), and the "Ingest source" CTA.
 */
export function GraphHeader({
  search,
  onSearchChange,
  onSearchSubmit,
  layout,
  onLayoutChange,
  viewMode,
  onViewModeChange,
  localActive,
  onToggleLocal,
  localHops,
  onLocalHopsChange,
  filterCount,
  onOpenFilters,
  onOpenIngest,
  totalNodes,
  totalEdges,
  searchInputRef,
}: GraphHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Hero */}
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-[var(--fg-tertiary)]">
          Center
        </p>
        <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-[var(--fg-primary)]">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[rgba(168,85,247,0.10)]">
              <Network className="h-5 w-5 text-[var(--accent-violet)]" aria-hidden="true" />
            </span>
            Knowledge Graph
          </h1>
          <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <span className="font-mono">{totalNodes} nodes</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{totalEdges} edges</span>
          </div>
        </div>
        <p className="text-sm text-[var(--fg-secondary)]">
          Unified view across repos, services, ADRs, ideas, risks, tasks, tests,
          runs, and agents. Click a node to inspect.{' '}
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]">
            <Command className="inline h-2.5 w-2.5" aria-hidden="true" />K
          </kbd>{' '}
          to search.
        </p>
      </header>

      {/* Toolbar */}
      <section
        aria-label="Graph toolbar"
        className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        data-testid="graph-toolbar"
      >
        {/* Search */}
        <form
          className="relative flex-1 min-w-[240px]"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit();
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--fg-tertiary)]" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search nodes, edges, or content…"
            data-testid="graph-search-input"
            aria-label="Search nodes, edges, or content"
            className={cn(
              'h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-9 pr-12 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]',
              'focus:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/40',
            )}
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-tertiary)]">
            <Command className="h-2.5 w-2.5" aria-hidden="true" />K
          </kbd>
        </form>

        {/* Layout selector */}
        <label className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
          <span className="text-[var(--fg-tertiary)]">Layout</span>
          <select
            value={layout}
            onChange={(e) => onLayoutChange(e.target.value as GraphLayout)}
            data-testid="layout-select"
            className="h-10 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--fg-primary)] focus:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/40"
          >
            <option value="force">Force-directed</option>
            <option value="tb">Hierarchical T→B</option>
            <option value="lr">Hierarchical L→R</option>
            <option value="radial">Radial</option>
            <option value="grid">Grid</option>
            <option value="timeline">Timeline</option>
          </select>
        </label>

        {/* View-mode segmented control */}
        <div
          role="tablist"
          aria-label="View mode"
          className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-0.5"
        >
          {(['graph', 'list', 'outline'] as ReadonlyArray<ViewMode>).map((v) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={viewMode === v}
              data-testid={`view-mode-${v}`}
              onClick={() => onViewModeChange(v)}
              className={cn(
                'rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                viewMode === v
                  ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-sm'
                  : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
              )}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Filters */}
        <button
          type="button"
          onClick={onOpenFilters}
          aria-label={`Filters${filterCount ? ` (${filterCount} active)` : ''}`}
          data-testid="filters-button"
          className="relative inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]"
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          Filters
          {filterCount > 0 && (
            <span
              data-testid="filter-count"
              className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--accent-primary)] px-1.5 font-mono text-[10px] font-semibold text-white"
            >
              {filterCount}
            </span>
          )}
        </button>

        {/* Local graph toggle */}
        <button
          type="button"
          onClick={onToggleLocal}
          aria-pressed={localActive}
          data-testid="local-graph-toggle"
          className={cn(
            'inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border px-3 text-sm transition-colors',
            localActive
              ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--accent-primary)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--fg-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--fg-primary)]',
          )}
        >
          <Focus className="h-4 w-4" aria-hidden="true" />
          Local graph
          {localActive && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-[var(--accent-primary)]/15 px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent-primary)]">
              {localHops} hop{localHops === 1 ? '' : 's'}
            </span>
          )}
        </button>

        {/* Ingest source — primary CTA */}
        <button
          type="button"
          onClick={onOpenIngest}
          data-testid="ingest-button"
          className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 text-sm font-medium text-white shadow-[var(--shadow-glow-primary)] transition-opacity hover:opacity-90"
        >
          <Database className="h-4 w-4" aria-hidden="true" />
          <Plus className="-ml-1 h-3.5 w-3.5" aria-hidden="true" />
          Ingest source
        </button>
      </section>
    </div>
  );
}

// Local lucide re-export — `Search` is imported inline by parent to keep
// this component pure. We do need it here for the search-icon display, so
// import at the top of the file (Next 15 inlines ESM tree-shaking fine).
import { Search } from 'lucide-react';