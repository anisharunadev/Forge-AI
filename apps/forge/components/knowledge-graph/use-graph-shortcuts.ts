'use client';

import * as React from 'react';

import type { GraphLayout, ViewMode } from './GraphHeader';

export interface GraphShortcutsOptions {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  setLayout: (next: GraphLayout) => void;
  layout: GraphLayout;
  viewMode: ViewMode;
  setViewMode: (next: ViewMode) => void;
  clearSelection: () => void;
  cycleLayout: () => void;
  cycleVisibleNode: (dir: 1 | -1) => void;
  openIngest: () => void;
  exportGraph: () => void;
  jumpToKind: (kindIndex: number) => void;
  kinds: ReadonlyArray<string>;
}

/**
 * Zone 8 — global keyboard shortcuts. Mounted once at the page level.
 *
 *   ⌘K / Ctrl+K   → focus search
 *   F             → fit graph (callback supplied by page)
 *   L             → cycle layouts
 *   Esc           → clear selection
 *   Arrow ←/→     → cycle through visible nodes
 *   1..9          → toggle the Nth kind
 *   ⌘E            → export graph as JSON
 *   ⌘I            → open ingestion modal
 *
 * Implementation note: a single window-level keydown listener avoids the
 * React event delegation fights we hit when an `<input>` is focused.
 */
export function useGraphShortcuts(opts: GraphShortcutsOptions): void {
  const optsRef = React.useRef(opts);
  React.useEffect(() => {
    optsRef.current = opts;
  });

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const o = optsRef.current;
      const target = e.target as HTMLElement | null;
      const inFormField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      const mod = e.metaKey || e.ctrlKey;

      // ⌘K / Ctrl+K — focus search (works even from inside inputs).
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        o.searchInputRef.current?.focus();
        o.searchInputRef.current?.select();
        return;
      }

      // ⌘E — export graph.
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        o.exportGraph();
        return;
      }

      // ⌘I — open ingestion modal.
      if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        o.openIngest();
        return;
      }

      if (inFormField) return;

      if (e.key === 'Escape') {
        o.clearSelection();
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        // 'F' alone cycles through visible nodes (matches Obsidian's navigation).
        o.cycleVisibleNode(1);
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        o.cycleLayout();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        o.cycleVisibleNode(1);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        o.cycleVisibleNode(-1);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        o.jumpToKind(Number(e.key) - 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}