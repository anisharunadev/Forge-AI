/**
 * Architecture Center extras: Export, SavedFilters, AIBadge, BulkBar.
 * Single small file with all the missing universal features.
 */
'use client';

import * as React from 'react';
import { Download, Sparkles, BookmarkPlus, BookmarkCheck, CheckSquare, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// =============================================================================
// EXPORT (JSON / CSV / Markdown)
// =============================================================================

export type ExportFormat = 'json' | 'csv' | 'md' | 'pdf';

function toCsv<T extends Record<string, unknown>>(rows: ReadonlyArray<T>, columns: ReadonlyArray<keyof T>): string {
  const header = columns.join(',');
  const lines = rows.map((r) =>
    columns.map((c) => {
      const v = String(r[c] ?? '');
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','),
  );
  return [header, ...lines].join('\n');
}

function toMarkdown<T extends Record<string, unknown>>(rows: ReadonlyArray<T>, columns: ReadonlyArray<keyof T>, title: string): string {
  const head = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${columns.map((c) => String(r[c] ?? '')).join(' | ')} |`).join('\n');
  return `# ${title}\n\n${head}\n${body}\n`;
}

export function exportData<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  columns: ReadonlyArray<keyof T>,
  filename: string,
  format: ExportFormat,
  title: string,
): void {
  let blob: Blob;
  if (format === 'json') {
    blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  } else if (format === 'csv') {
    blob = new Blob([toCsv(rows, columns)], { type: 'text/csv' });
  } else if (format === 'md') {
    blob = new Blob([toMarkdown(rows, columns, title)], { type: 'text/markdown' });
  } else {
    // PDF: open a print-friendly HTML view in a new window and trigger print,
    // so the browser's "Save as PDF" produces the artifact. No jsPDF dep.
    const md = toMarkdown(rows, columns, title);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 32px; color: #111; }
  h1 { font-size: 22px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 12px; }
  th { background: #f3f4f6; }
  pre { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 11px; }
  @media print { .no-print { display: none; } }
</style>
</head><body>
<h1>${title}</h1>
<pre>${md.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)}</pre>
<p class="no-print"><button onclick="window.print()">Save as PDF</button></p>
<script>window.onload = () => setTimeout(() => window.print(), 250);</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    } else {
      blob = new Blob([html], { type: 'text/html' });
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButton({ getData, filename, title, columns, testId }: {
  getData: () => ReadonlyArray<Record<string, unknown>>;
  filename: string;
  title: string;
  columns: ReadonlyArray<string>;
  testId?: string;
}) {
  const onExport = (format: ExportFormat) => {
    exportData(getData(), columns as never, filename, format, title);
  };
  return (
    <div className="relative inline-flex" data-testid={testId}>
      <details className="group">
        <summary className={cn(
          'inline-flex h-7 cursor-pointer list-none items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 text-xs text-[var(--fg-secondary)]',
          'hover:border-[var(--border-default)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        )}>
          <Download className="h-3 w-3" aria-hidden="true" /> Export
        </summary>
        <div className="absolute right-0 top-full z-10 mt-1 flex flex-col gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-xl">
          {(['json', 'csv', 'md', 'pdf'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onExport(f)}
              data-testid={`export-${f}`}
              className="rounded px-2 py-1 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:bg-[var(--bg-inset)]"
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

// =============================================================================
// SAVED FILTERS (localStorage)
// =============================================================================

const SAVED_FILTERS_KEY = 'architecture:saved-filters';

export interface SavedFilter {
  id: string;
  name: string;
  tab: string;
  state: Record<string, unknown>;
  createdAt: string;
}

export function useSavedFilters(tab: string): {
  filters: SavedFilter[];
  save: (name: string, state: Record<string, unknown>) => void;
  remove: (id: string) => void;
} {
  const [filters, setFilters] = React.useState<SavedFilter[]>([]);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_FILTERS_KEY);
      const all: SavedFilter[] = raw ? JSON.parse(raw) : [];
      setFilters(all.filter((f) => f.tab === tab));
    } catch {
      // ignore
    }
  }, [tab]);

  const save = React.useCallback((name: string, state: Record<string, unknown>) => {
    try {
      const raw = localStorage.getItem(SAVED_FILTERS_KEY);
      const all: SavedFilter[] = raw ? JSON.parse(raw) : [];
      const next = { id: `f-${Date.now()}`, name, tab, state, createdAt: new Date().toISOString() };
      all.push(next);
      localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(all));
      setFilters((prev) => [...prev, next]);
    } catch {
      // ignore
    }
  }, [tab]);

  const remove = React.useCallback((id: string) => {
    try {
      const raw = localStorage.getItem(SAVED_FILTERS_KEY);
      const all: SavedFilter[] = raw ? JSON.parse(raw) : [];
      const next = all.filter((f) => f.id !== id);
      localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(next));
      setFilters((prev) => prev.filter((f) => f.id !== id));
    } catch {
      // ignore
    }
  }, []);

  return { filters, save, remove };
}

export function SavedFiltersBar({ tab, currentState, onApply }: { tab: string; currentState: Record<string, unknown>; onApply: (state: Record<string, unknown>) => void }) {
  const { filters, save, remove } = useSavedFilters(tab);
  const [name, setName] = React.useState('');

  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px]" data-testid={`saved-filters-${tab}`}>
      <span className="font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">Saved</span>
      {filters.length === 0 ? (
        <span className="text-[var(--fg-muted)]">none</span>
      ) : (
        filters.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => onApply(f.state)}
              data-testid={`saved-filter-apply-${f.id}`}
              className="text-[var(--fg-secondary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              {f.name}
            </button>
            <button
              type="button"
              onClick={() => remove(f.id)}
              aria-label={`Delete saved filter ${f.name}`}
              className="text-[var(--fg-tertiary)] hover:text-rose-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              ×
            </button>
          </span>
        ))
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); if (name) { save(name, currentState); setName(''); } }}
        className="inline-flex items-center gap-1"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Save current as…"
          className="w-32 rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[10px] text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          data-testid={`saved-filter-input-${tab}`}
        />
        <button
          type="submit"
          disabled={!name}
          className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-1.5 py-0.5 text-[var(--fg-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          data-testid={`saved-filter-save-${tab}`}
        >
          <BookmarkPlus className="h-3 w-3" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

// =============================================================================
// AI ASSISTANT BADGE (per-tab)
// =============================================================================

export function AIAssistantBadge({ tab, onClick }: { tab: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`ai-badge-${tab}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300 transition-colors',
        'hover:border-violet-400/60 hover:bg-violet-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
      )}
      aria-label={`AI assistant for ${tab}`}
    >
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      AI
    </button>
  );
}

// =============================================================================
// BULK SELECT + ACTIONS BAR
// =============================================================================

export function BulkBar<T extends { id: string }>({
  items,
  selected,
  onToggle,
  onClear,
  actions,
  testId,
}: {
  items: ReadonlyArray<T>;
  selected: Readonly<Set<string>>;
  onToggle: (id: string) => void;
  onClear: () => void;
  actions: ReadonlyArray<{ label: string; onClick: () => void; tone?: 'default' | 'rose' }>;
  testId?: string;
}) {
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid={testId}>
      <button
        type="button"
        onClick={() => (allSelected ? onClear() : items.forEach((i) => onToggle(i.id)))}
        className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1 text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        data-testid={`bulk-toggle-${testId ?? ''}`}
      >
        {allSelected ? <CheckSquare className="h-3 w-3" aria-hidden="true" /> : <Square className="h-3 w-3" aria-hidden="true" />}
        {allSelected ? 'Deselect all' : 'Select all'}
      </button>
      {selected.size > 0 ? (
        <>
          <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{selected.size} selected</span>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              data-testid={`bulk-action-${a.label.toLowerCase().replace(/\s+/g, '-')}`}
              className={cn(
                'inline-flex items-center rounded border px-2 py-1',
                a.tone === 'rose'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:border-rose-400/60'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
            >
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            Clear
          </button>
        </>
      ) : null}
    </div>
  );
}
