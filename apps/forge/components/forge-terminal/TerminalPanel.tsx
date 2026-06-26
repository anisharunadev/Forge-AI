'use client';

/**
 * Terminal — Main panel (Step 36: canvas-first layout).
 *
 * New layout (after Step 36):
 *
 *   ┌─ LeftRail ─┬─ Canvas header (tabs + layout + status pill + toolbar) ─┬─ AuditRail ─┐
 *   │  (56/320)  │  SessionTabs (44px)                                      │  (56/360)   │
 *   │            │  Toolbar   (44px)                                        │             │
 *   │            │  Search bar (conditional)                                │             │
 *   │            │  Pane host (flex)                                        │             │
 *   │            │  StatusBar (32px)                                        │             │
 *   └────────────┴──────────────────────────────────────────────────────────┴─────────────┘
 *
 * Rails collapse by default → terminal gets the full canvas width.
 *
 * Wires:
 *   - Keyboard shortcuts for sessions (Ctrl+Shift+T/W/Tab/1-9) — kept from
 *     Step 32.
 *   - Keyboard shortcuts for rails (⌘1..5, ⌘0, ⌘⇧0) — Fix 7.
 *   - Help overlay toggle (⌘?) — Fix 1.
 *   - Focus mode toggle (Ctrl+Shift+M, Esc to exit) — Fix 8.
 *   - Audit row → terminal focus event — kept from Step 32.
 *   - Toolbar actions via window event bus — kept from Step 32.
 */

import * as React from 'react';
import { LayoutGrid, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  useTerminalStore,
  type AgentId,
  type LayoutMode,
  type SessionColorId,
} from '@/lib/store';
import {
  useTerminalUiStore,
  LEFT_RAIL_SECTIONS,
  RIGHT_RAIL_SECTIONS,
} from '@/lib/terminal-ui-store';
import { FORGE_TERMINAL_WS_URL } from '@/lib/forge-api';
import type { TerminalConnectionState } from '@/hooks/use-terminal';

import { SessionTabs } from './SessionTabs';
import { LayoutSwitcher } from './LayoutSwitcher';
import { TerminalToolbar } from './TerminalToolbar';
import { StatusBar } from './StatusBar';
import { TerminalPane } from './TerminalPane';
import { HelpOverlay } from './HelpOverlay';
import {
  NewSessionDialog,
  type SessionColorId as ColorTag,
} from './NewSessionDialog';

export interface TerminalPanelProps {
  /** Connection state reported by the page-level sidecar probe. */
  connectionState: TerminalConnectionState;
  latencyMs?: number;
  /** Endpoint surfaced in the Help → About tab. */
  endpoint?: string;
}

export function TerminalPanel({
  connectionState,
  latencyMs,
  endpoint,
}: TerminalPanelProps) {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeSessionId);
  const createSession = useTerminalStore((s) => s.createSession);
  const setActive = useTerminalStore((s) => s.setActiveSession);

  // Local UI state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchHits, setSearchHits] = React.useState<{
    current: number;
    total: number;
  } | null>(null);
  const [focusHint, setFocusHint] = React.useState(false);

  // Global UI store
  const helpOpen = useTerminalUiStore((s) => s.helpOpen);
  const openHelp = useTerminalUiStore((s) => s.openHelp);
  const closeHelp = useTerminalUiStore((s) => s.closeHelp);
  const focusMode = useTerminalUiStore((s) => s.focusMode);
  const toggleFocusMode = useTerminalUiStore((s) => s.toggleFocusMode);
  const setFocusMode = useTerminalUiStore((s) => s.setFocusMode);
  const toggleLeftRail = useTerminalUiStore((s) => s.toggleLeftRail);
  const toggleRightRail = useTerminalUiStore((s) => s.toggleRightRail);
  const collapseAllRails = useTerminalUiStore((s) => s.collapseAllRails);
  const bumpVisitCount = useTerminalUiStore((s) => s.bumpVisitCount);

  // First-visit counter — bumps once per mount.
  React.useEffect(() => {
    bumpVisitCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show a "Press Esc to exit" hint for 2s when focus mode toggles on.
  React.useEffect(() => {
    if (!focusMode) return;
    setFocusHint(true);
    const t = window.setTimeout(() => setFocusHint(false), 2000);
    return () => window.clearTimeout(t);
  }, [focusMode]);

  // ------------------------------------------------------------------
  // Global keyboard shortcuts
  // ------------------------------------------------------------------
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      const isEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        target?.isContentEditable === true;

      const meta = e.metaKey || e.ctrlKey;

      // Esc — exit focus mode (unless user is editing text).
      if (e.key === 'Escape' && focusMode && !isEditable) {
        e.preventDefault();
        setFocusMode(false);
        return;
      }

      // ⌘? / Ctrl+? — Help overlay.
      if (
        meta &&
        e.shiftKey &&
        (e.key === '?' || e.key === '/' || (e.code === 'Slash' && e.shiftKey))
      ) {
        e.preventDefault();
        openHelp();
        return;
      }

      // ⌘0 — collapse all rails.
      if (meta && !e.shiftKey && e.key === '0') {
        e.preventDefault();
        collapseAllRails();
        return;
      }

      // ⌘⇧0 — expand all rails (open audit on the right, sessions on the left).
      if (meta && e.shiftKey && e.key === '0') {
        e.preventDefault();
        useTerminalUiStore.getState().setLeftRail('sessions');
        useTerminalUiStore.getState().setRightRail('audit');
        return;
      }

      // ⌘1..5 — toggle left/right rail sections.
      if (meta && !e.shiftKey && !e.altKey && !isEditable) {
        const idx = Number.parseInt(e.key, 10);
        if (idx >= 1 && idx <= 5) {
          const left = LEFT_RAIL_SECTIONS[idx - 1];
          if (left) {
            e.preventDefault();
            toggleLeftRail(left.id);
            return;
          }
          const right = RIGHT_RAIL_SECTIONS[idx - 5];
          if (right) {
            e.preventDefault();
            toggleRightRail(right.id);
            return;
          }
        }
      }

      // Ctrl+Shift+M — toggle focus mode (also in the toolbar).
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // ---- Step 32 shortcuts (preserved) ----

      // Ctrl+Shift+T — new session (suppresses browser "reopen closed tab").
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setDialogOpen(true);
        return;
      }
      // Ctrl+Shift+W — close active session.
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        const closeSession = useTerminalStore.getState().closeSession;
        if (activeId) closeSession(activeId);
        return;
      }
      // Ctrl+Tab / Ctrl+Shift+Tab — next/previous session.
      if (e.ctrlKey && e.key === 'Tab' && sessions.length > 0) {
        e.preventDefault();
        const idx = sessions.findIndex((s) => s.id === activeId);
        const dir = e.shiftKey ? -1 : 1;
        const nextIdx = (idx + dir + sessions.length) % sessions.length;
        const target = sessions[nextIdx];
        if (target) setActive(target.id);
        return;
      }
      // Ctrl+1..9 — jump to session N (only when no rail shortcut caught it).
      if (
        e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        !isEditable
      ) {
        const n = Number.parseInt(e.key, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 9) {
          const target = sessions[n - 1];
          if (target) {
            e.preventDefault();
            setActive(target.id);
            return;
          }
        }
      }
      // Ctrl+Shift+F — toggle the search bar.
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    sessions,
    activeId,
    setActive,
    focusMode,
    setFocusMode,
    openHelp,
    collapseAllRails,
    toggleFocusMode,
    toggleLeftRail,
    toggleRightRail,
  ]);

  // ------------------------------------------------------------------
  // Toolbar actions
  // ------------------------------------------------------------------
  const handleCopy = React.useCallback(() => {
    const sel = window.getSelection()?.toString() ?? '';
    if (!sel) return;
    void navigator.clipboard.writeText(sel);
  }, []);

  const handlePaste = React.useCallback(() => {
    void navigator.clipboard.readText().then((text) => {
      window.dispatchEvent(
        new CustomEvent('forge:terminal:paste', { detail: { text } }),
      );
    });
  }, []);

  const handleClear = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('forge:terminal:clear'));
  }, []);

  const handleSettings = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('forge:terminal:settings'));
  }, []);

  // ------------------------------------------------------------------
  // Audit row click → focus that session and write a marker.
  // ------------------------------------------------------------------
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string; command: string }>).detail;
      if (!detail?.sessionId) return;
      setActive(detail.sessionId);
      window.dispatchEvent(
        new CustomEvent('forge:terminal:goto', { detail }),
      );
    };
    window.addEventListener('forge:terminal:goto', handler);
    return () => window.removeEventListener('forge:terminal:goto', handler);
  }, [setActive]);

  // ------------------------------------------------------------------
  // Page-level "open new session" event from the hero button.
  // ------------------------------------------------------------------
  React.useEffect(() => {
    const handler = () => setDialogOpen(true);
    window.addEventListener('forge:terminal:open-new', handler);
    return () => window.removeEventListener('forge:terminal:open-new', handler);
  }, []);

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------
  const runSearch = React.useCallback((q: string, dir: 'next' | 'prev') => {
    if (!q) {
      setSearchHits(null);
      return;
    }
    window.dispatchEvent(
      new CustomEvent('forge:terminal:search', { detail: { query: q, direction: dir } }),
    );
  }, []);

  React.useEffect(() => {
    const resultHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ current: number; total: number }>).detail;
      if (detail && typeof detail.total === 'number') {
        setSearchHits(detail);
      }
    };
    window.addEventListener('forge:terminal:search-result', resultHandler);
    return () => window.removeEventListener('forge:terminal:search-result', resultHandler);
  }, []);

  // ------------------------------------------------------------------
  // Empty state — no active session yet.
  // ------------------------------------------------------------------
  const layout = useTerminalStore((s) => s.layout);
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const extras = sessions
    .filter((s) => s.id !== active?.id)
    .slice(0, layout === 'grid-2x2' ? 3 : 1);

  if (!active) {
    return (
      <>
        <div
          data-testid="terminal-panel-empty"
          className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] p-10 text-center"
        >
          <Sparkles className="h-6 w-6 text-[var(--accent-primary)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--fg-primary)]">
            Create your first session
          </p>
          <p className="max-w-sm text-xs text-[var(--fg-tertiary)]">
            Start a PTY-backed session for Claude Code, Codex, Aider, or your
            custom agent. Each session keeps its own scrollback, agent, and workspace.
          </p>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="mt-2 bg-[var(--accent-primary)] text-white hover:opacity-90"
            data-testid="terminal-empty-new"
          >
            New session
          </Button>
        </div>
        <NewSessionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onCreate={(input) => {
            createSession({
              title: input.title,
              agent: input.agent,
              workspace: input.workspace,
              color: input.color as SessionColorId,
            });
          }}
        />
        <HelpOverlay open={helpOpen} onOpenChange={(v) => (v ? openHelp() : closeHelp())} endpoint={endpoint} />
      </>
    );
  }

  const renderPane = (
    s: (typeof sessions)[number],
    opts?: { focusOnMount?: boolean },
  ) => (
    <TerminalPane
      key={s.id}
      sessionId={s.id}
      agent={s.agent}
      workspace={s.workspace}
      // Point each pane at the dev PTY sidecar directly. The previous
      // `/ws/terminal/${s.id}` was a relative path that `openForgeWebSocket`
      // joined onto FORGE_WS_BASE_URL (the orchestrator, :8000), which
      // returns 403 for that route. The sidecar on :4001 accepts every
      // connection and spawns a fresh PTY per WebSocket, so the absolute
      // URL is the right one in dev. When the real orchestrator exposes
      // its own terminal endpoint, repoint this back at it.
      wsPath={FORGE_TERMINAL_WS_URL}
      status={s.status}
      focusOnMount={opts?.focusOnMount ?? false}
    />
  );

  return (
    <>
      <div
        data-testid="terminal-panel"
        data-focus-mode={focusMode ? 'true' : 'false'}
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)]',
          focusMode && 'fixed inset-2 z-40 shadow-2xl',
        )}
      >
        {/* FOCUS MODE HINT — bottom-right, fades after 2s */}
        {focusMode && focusHint ? (
          <div
            data-testid="focus-mode-hint"
            className="pointer-events-none absolute bottom-12 right-4 z-10 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] text-[var(--fg-secondary)] shadow-md animate-in fade-in slide-in-from-bottom-2"
          >
            Press Esc to exit focus
          </div>
        ) : null}

        {/* SESSION TABS — always visible (even in focus mode) */}
        <SessionTabs onNewSession={() => setDialogOpen(true)} />

        {/* TOOLBAR — hidden in focus mode */}
        {!focusMode ? (
          <div className="flex h-11 flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3">
            <div className="flex items-center gap-3">
              <LayoutSwitcher />
            </div>
            <TerminalToolbar
              onSearch={() => setSearchOpen((v) => !v)}
              onCopy={handleCopy}
              onPaste={handlePaste}
              onClear={handleClear}
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreen((v) => !v)}
              onSettings={handleSettings}
              searchOpen={searchOpen}
              onOpenHelp={openHelp}
              focusMode={focusMode}
              onToggleFocusMode={toggleFocusMode}
            />
          </div>
        ) : null}

        {searchOpen && !focusMode ? (
          <div
            data-testid="terminal-search"
            className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-1.5"
          >
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => {
                const v = e.target.value;
                setSearchQuery(v);
                runSearch(v, 'next');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runSearch(searchQuery, e.shiftKey ? 'prev' : 'next');
                }
                if (e.key === 'Escape') {
                  setSearchOpen(false);
                  setSearchQuery('');
                  setSearchHits(null);
                }
              }}
              placeholder="Search scrollback…"
              className={cn(
                'h-7 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-xs',
                'text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]',
              )}
              data-testid="terminal-search-input"
            />
            {searchHits ? (
              <span
                className="font-mono text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]"
                data-testid="terminal-search-counter"
              >
                {searchHits.total > 0
                  ? `${searchHits.current} / ${searchHits.total}`
                  : 'no matches'}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => runSearch(searchQuery, 'prev')}
              className="h-7 px-2 text-xs"
              aria-label="Previous match"
              data-testid="terminal-search-prev"
              disabled={!searchQuery || (searchHits?.total ?? 0) === 0}
            >
              ↑
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => runSearch(searchQuery, 'next')}
              className="h-7 px-2 text-xs"
              aria-label="Next match"
              data-testid="terminal-search-next"
              disabled={!searchQuery || (searchHits?.total ?? 0) === 0}
            >
              ↓
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery('');
                setSearchHits(null);
              }}
              className="h-7 px-2 text-xs"
              data-testid="terminal-search-close"
            >
              Close
            </Button>
          </div>
        ) : null}

        {/* CANVAS — terminal panes fill the remaining space */}
        <div
          className={cn(
            'relative min-h-0 flex-1 p-3',
            fullscreen && 'fixed inset-0 z-40 bg-[var(--bg-base)] p-4',
          )}
          data-testid="terminal-pane-host"
          data-fullscreen={fullscreen}
        >
          {layout === 'single' && renderPane(active, { focusOnMount: true })}

          {layout === 'split-horizontal' && (
            <div className="flex h-full flex-col gap-2">
              <div className="min-h-0 flex-1">{renderPane(active)}</div>
              {extras[0] ? (
                <div className="min-h-0 flex-1">{renderPane(extras[0])}</div>
              ) : (
                <EmptySlot label="No second session" />
              )}
            </div>
          )}

          {layout === 'split-vertical' && (
            <div className="flex h-full gap-2">
              <div className="min-w-0 flex-1">{renderPane(active)}</div>
              {extras[0] ? (
                <div className="min-w-0 flex-1">{renderPane(extras[0])}</div>
              ) : (
                <EmptySlot label="No second session" />
              )}
            </div>
          )}

          {layout === 'grid-2x2' && (
            <div className="grid h-full grid-cols-2 grid-rows-2 gap-2">
              <div className="min-h-0">{renderPane(active)}</div>
              {extras[0] ? (
                <div className="min-h-0">{renderPane(extras[0])}</div>
              ) : (
                <EmptySlot label="Empty slot" />
              )}
              {extras[1] ? (
                <div className="min-h-0">{renderPane(extras[1])}</div>
              ) : (
                <EmptySlot label="Empty slot" />
              )}
              {extras[2] ? (
                <div className="min-h-0">{renderPane(extras[2])}</div>
              ) : (
                <EmptySlot label="Empty slot" />
              )}
            </div>
          )}
        </div>

        {/* STATUS BAR */}
        <StatusBar connectionState={connectionState} latencyMs={latencyMs} />
      </div>

      <NewSessionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={(input: { title: string; agent: AgentId; workspace: string; color: ColorTag }) => {
          createSession({
            title: input.title,
            agent: input.agent,
            workspace: input.workspace,
            color: input.color as SessionColorId,
          });
        }}
      />
      <HelpOverlay
        open={helpOpen}
        onOpenChange={(v) => (v ? openHelp() : closeHelp())}
        endpoint={endpoint}
      />
    </>
  );
}

function EmptySlot({ label }: { label: string }) {
  return (
    <div
      className="flex h-full items-center justify-center rounded-md border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] text-xs text-[var(--fg-muted)]"
      data-testid="terminal-empty-slot"
    >
      <span className="inline-flex items-center gap-2">
        <LayoutGrid className="h-3 w-3" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}