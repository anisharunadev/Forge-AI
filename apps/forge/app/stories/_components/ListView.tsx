'use client';

/**
 * Stories Center — List View (Step 21).
 *
 * Virtualized table that mirrors the kanban's Story type. Bulk select
 * surfaces a floating action bar with Assign / Move / Delete actions.
 *
 * Skill influence:
 *   - Virtualization is opt-in for very long lists; here we use plain
 *     scroll because the typical Stories dataset stays under a few
 *     hundred rows.
 *   - Sortable headers — clear visual affordance (hover, focus).
 *   - Accessibility: row selection via checkbox column, aria-selected
 *     on <tr>, keyboard friendly (Space toggles selection).
 */

import * as React from 'react';
import { ArrowDownAZ, ArrowUpAZ, Trash2, FolderInput, UserPlus, X } from 'lucide-react';

import type { Story, StoryStatus } from '@/lib/stories/types';
import {
  LABEL_DOT_VAR,
  LABEL_LABEL,
  PRIORITY_DOT_VAR,
  STATUS_DOT_VAR,
  STATUS_LABEL,
} from '@/lib/stories/types';
import { cn } from '@/lib/utils';

export interface ListViewProps {
  readonly stories: ReadonlyArray<Story>;
  readonly onOpenStory: (id: string) => void;
  readonly onBulkDelete: (ids: ReadonlyArray<string>) => void;
  readonly onBulkMove: (ids: ReadonlyArray<string>, to: StoryStatus) => void;
}

type SortKey = 'identifier' | 'title' | 'status' | 'priority' | 'estimate' | 'updatedAt';

export function ListView({
  stories,
  onOpenStory,
  onBulkDelete,
  onBulkMove,
}: ListViewProps) {
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'updatedAt',
    dir: 'desc',
  });
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());

  const sorted = React.useMemo(() => {
    const copy = [...stories];
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [stories, sort]);

  const allSelected = sorted.length > 0 && sorted.every((s) => selected.has(s.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((s) => s.id)));
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section
      aria-label="List"
      data-testid="stories-list"
      className="relative flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      <div className="thin-scrollbar max-h-[calc(100vh-360px)] overflow-y-auto">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--bg-base)]/90 backdrop-blur">
            <tr className="border-b border-[var(--border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-3 w-3 accent-[var(--accent-primary)]"
                />
              </th>
              <SortableHeader
                label="ID"
                active={sort.key === 'identifier'}
                dir={sort.dir}
                onClick={() => setSort({ key: 'identifier', dir: flipDir(sort.dir) })}
                className="w-20"
              />
              <SortableHeader
                label="Title"
                active={sort.key === 'title'}
                dir={sort.dir}
                onClick={() => setSort({ key: 'title', dir: flipDir(sort.dir) })}
              />
              <SortableHeader
                label="Status"
                active={sort.key === 'status'}
                dir={sort.dir}
                onClick={() => setSort({ key: 'status', dir: flipDir(sort.dir) })}
                className="w-32"
              />
              <SortableHeader
                label="Priority"
                active={sort.key === 'priority'}
                dir={sort.dir}
                onClick={() => setSort({ key: 'priority', dir: flipDir(sort.dir) })}
                className="w-24"
              />
              <th className="w-28 px-3 py-2">Assignee</th>
              <SortableHeader
                label="Estimate"
                active={sort.key === 'estimate'}
                dir={sort.dir}
                onClick={() => setSort({ key: 'estimate', dir: flipDir(sort.dir) })}
                className="w-24"
              />
              <th className="w-40 px-3 py-2">Labels</th>
              <SortableHeader
                label="Updated"
                active={sort.key === 'updatedAt'}
                dir={sort.dir}
                onClick={() => setSort({ key: 'updatedAt', dir: flipDir(sort.dir) })}
                className="w-28"
              />
              <th className="w-16 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr
                key={s.id}
                data-testid={`story-row-${s.identifier}`}
                aria-selected={selected.has(s.id)}
                className={cn(
                  'border-b border-[var(--border-subtle)] transition-colors duration-fast',
                  selected.has(s.id)
                    ? 'bg-[rgba(99,102,241,0.06)]'
                    : 'hover:bg-[var(--hover)]',
                )}
              >
                <td className="px-3 py-2 align-middle">
                  <input
                    type="checkbox"
                    aria-label={`Select ${s.identifier}`}
                    checked={selected.has(s.id)}
                    onChange={() => toggleRow(s.id)}
                    className="h-3 w-3 accent-[var(--accent-primary)]"
                  />
                </td>
                <td className="px-3 py-2 align-middle font-mono text-[10px] text-[var(--fg-tertiary)]">
                  {s.identifier}
                </td>
                <td className="px-3 py-2 align-middle">
                  <button
                    type="button"
                    onClick={() => onOpenStory(s.id)}
                    className="text-left text-sm font-medium text-[var(--fg-primary)] hover:underline focus:outline-none focus-visible:underline"
                  >
                    {s.title}
                  </button>
                </td>
                <td className="px-3 py-2 align-middle">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: STATUS_DOT_VAR[s.status] }}
                    />
                    {STATUS_LABEL[s.status]}
                  </span>
                </td>
                <td className="px-3 py-2 align-middle">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: PRIORITY_DOT_VAR[s.priority] }}
                    />
                    {s.priority}
                  </span>
                </td>
                <td className="px-3 py-2 align-middle">
                  {s.assignee ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-secondary)]">
                      <span
                        aria-hidden="true"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                        style={{ backgroundColor: s.assignee.color }}
                      >
                        {s.assignee.initials}
                      </span>
                      {s.assignee.name}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--fg-tertiary)]">—</span>
                  )}
                </td>
                <td className="px-3 py-2 align-middle font-mono text-xs text-[var(--fg-secondary)]">
                  {s.estimate}
                </td>
                <td className="px-3 py-2 align-middle">
                  <div className="flex flex-wrap items-center gap-1">
                    {s.labels.slice(0, 3).map((l) => (
                      <span
                        key={l}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--fg-secondary)]"
                      >
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: LABEL_DOT_VAR[l] }}
                        />
                        {LABEL_LABEL[l]}
                      </span>
                    ))}
                    {s.labels.length > 3 ? (
                      <span className="text-[10px] text-[var(--fg-tertiary)]">
                        +{s.labels.length - 3}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 align-middle text-xs text-[var(--fg-tertiary)]">
                  {formatRelative(s.updatedAt)}
                </td>
                <td className="px-3 py-2 text-right align-middle">
                  <button
                    type="button"
                    onClick={() => onOpenStory(s.id)}
                    className="rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected.size > 0 ? (
        <FloatingActionBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onAssign={() => console.log('[stories] bulk-assign', [...selected])}
          onMove={(to) => onBulkMove([...selected], to)}
          onDelete={() => {
            onBulkDelete([...selected]);
            setSelected(new Set());
          }}
        />
      ) : null}
    </section>
  );
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  className?: string;
}) {
  return (
    <th className={cn('px-3 py-2 text-left', className)}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1 py-0.5 text-[10px] uppercase tracking-wider',
          active ? 'text-[var(--fg-primary)]' : 'text-[var(--fg-tertiary)]',
          'hover:bg-[var(--hover)] hover:text-[var(--fg-primary)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ArrowUpAZ size={10} aria-hidden="true" />
          ) : (
            <ArrowDownAZ size={10} aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );
}

function FloatingActionBar({
  count,
  onClear,
  onAssign,
  onMove,
  onDelete,
}: {
  count: number;
  onClear: () => void;
  onAssign: () => void;
  onMove: (to: StoryStatus) => void;
  onDelete: () => void;
}) {
  const [moveOpen, setMoveOpen] = React.useState(false);
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      data-testid="stories-bulk-bar"
      className="absolute inset-x-4 bottom-4 z-20 mx-auto flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 shadow-[var(--shadow-lg)]"
    >
      <span className="text-xs font-medium text-[var(--fg-primary)]">{count} selected</span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-tertiary)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      >
        <X size={12} aria-hidden="true" />
      </button>
      <div className="mx-2 h-4 w-px bg-[var(--border-subtle)]" aria-hidden="true" />
      <button
        type="button"
        onClick={onAssign}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      >
        <UserPlus size={12} aria-hidden="true" /> Assign
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => setMoveOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={moveOpen}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        >
          <FolderInput size={12} aria-hidden="true" /> Move
        </button>
        {moveOpen ? (
          <ul
            role="menu"
            className="absolute bottom-full left-0 z-30 mb-1 w-44 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-lg"
          >
            {(['backlog', 'todo', 'in_progress', 'in_review', 'done'] as ReadonlyArray<StoryStatus>).map(
              (s) => (
                <li key={s} role="menuitem">
                  <button
                    type="button"
                    onClick={() => {
                      onMove(s);
                      setMoveOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg-primary)] focus:outline-none"
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: STATUS_DOT_VAR[s] }}
                    />
                    {STATUS_LABEL[s]}
                  </button>
                </li>
              ),
            )}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[rgba(244,63,94,0.15)] px-2 py-1 text-xs font-medium text-[var(--accent-rose)] hover:bg-[rgba(244,63,94,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-rose)]"
      >
        <Trash2 size={12} aria-hidden="true" /> Delete
      </button>
    </div>
  );
}

function flipDir(d: 'asc' | 'desc') {
  return d === 'asc' ? 'desc' : 'asc';
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}