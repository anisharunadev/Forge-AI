'use client';

/**
 * Step 24 — Persistent floating Co-pilot launcher (FAB).
 *
 * 60×60 floating action button anchored to the bottom-right corner of
 * every page. Clicking opens the existing right-side `CopilotPanel`.
 *
 * Visual states:
 *   - **Idle** — gentle scale pulse (1 → 1.04 → 1, 3s), brand
 *     gradient (indigo → cyan), cyan Sparkles icon.
 *   - **Hover** — scale 1.08, glow intensifies.
 *   - **Active (panel open)** — scale 0.96 (morphs into the panel).
 *   - **Thinking** — gradient shift (rotates indigo → violet →
 *     cyan), thinking-dot indicator below.
 *   - **Unread** — rose badge top-right corner; "Forge Co-pilot: N
 *     new messages" tooltip on hover.
 *   - **Drag** — cursor grab; FAB grows 1.1×; subtle trail.
 *
 * Affordances:
 *   - **Context badge** floating above the FAB (only on
 *     workflow-shaped pages), shows current route + page icon, click
 *     to open panel with that page's context pre-attached.
 *   - **Quick actions** mini-menu on long-press / right-click:
 *     New conversation / Summarize current page / Voice mode /
 *     Recent conversations / Settings.
 *   - **Notification tooltip** when new messages arrive while panel
 *     is closed.
 *
 * Skill influence (ui-ux-pro-max):
 *   - "AI-Native UI" — minimal chrome, single accent, conversational
 *     layout.
 *   - "Dimensional Layering" — z-50, --shadow-lg for elevation.
 *   - "Focus States" + "Keyboard Navigation" — visible focus ring;
 *     ⌘J/Ctrl+J hotkey; Esc returns focus.
 *   - "Streaming" UX — never block on a spinner for the duration of
 *     a response.
 *
 * Mounted once at the `ShellProvider` boundary (next to `CopilotPanel`)
 * so the FAB persists across navigations. Hides on `/copilot`.
 */

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Compass,
  History,
  Mic,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { useCopilotEnabled } from '@/lib/feature-flags';
import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const FAB_SIZE = 60; // px — Step 24 spec bumps from 56 to 60
const CONTEXT_BADGE_OFFSET = 16; // px gap above the FAB
const CORNER_OFFSET = 24; // px — bottom-6 / right-6
const HIDE_ON_ROUTES = ['/copilot'];

// Pages where the floating context badge earns its keep — workflow
// surfaces where a "summarize this page" launch makes sense.
const CONTEXT_PAGES: Record<string, { label: string; icon: LucideIcon }> = {
  '/workflows': { label: 'On /workflows', icon: Workflow },
  '/dashboard': { label: 'On /dashboard', icon: Compass },
  '/agents': { label: 'On /agents', icon: Compass },
  '/audit': { label: 'On /audit', icon: History },
};

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function CopilotLauncher() {
  const pathname = usePathname();
  const copilotEnabled = useCopilotEnabled();
  const copilotOpen = useCopilotStore((s) => s.open);
  const setCopilotOpen = useCopilotStore((s) => s.setOpen);
  const toggleCopilot = useCopilotStore((s) => s.toggle);
  const streaming = useCopilotStore((s) => s.streaming);
  const unreadCount = useCopilotStore((s) => s.unreadCount);
  const clearUnread = useCopilotStore((s) => s.clearUnread);

  const fabRef = React.useRef<HTMLButtonElement | null>(null);
  const longPressTimer = React.useRef<number | null>(null);
  const [tooltipVisible, setTooltipVisible] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [contextBadgeVisible, setContextBadgeVisible] = React.useState(false);
  const [isMac, setIsMac] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  // ── Platform detection ────────────────────────────────────────
  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform));
    }
  }, []);

  // ── Tooltip dwell ─────────────────────────────────────────────
  const dwellTimer = React.useRef<number | null>(null);
  const handlePointerEnter = React.useCallback(() => {
    if (dwellTimer.current !== null) window.clearTimeout(dwellTimer.current);
    dwellTimer.current = window.setTimeout(() => setTooltipVisible(true), 500);
  }, []);
  const handlePointerLeave = React.useCallback(() => {
    if (dwellTimer.current !== null) {
      window.clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    }
    setTooltipVisible(false);
    setMenuOpen(false);
  }, []);

  // ── Clear unread when panel opens ─────────────────────────────
  React.useEffect(() => {
    if (copilotOpen && unreadCount > 0) {
      clearUnread();
    }
  }, [copilotOpen, unreadCount, clearUnread]);

  // ── Focus return when panel closes ────────────────────────────
  const wasOpen = React.useRef(copilotOpen);
  React.useEffect(() => {
    if (wasOpen.current && !copilotOpen) {
      fabRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = copilotOpen;
  }, [copilotOpen]);

  // ── Context badge — auto-show on page change, fade after 3s ──
  const contextPage = React.useMemo(() => {
    if (!pathname) return null;
    const keys = Object.keys(CONTEXT_PAGES).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (pathname === key || pathname.startsWith(`${key}/`)) {
        return CONTEXT_PAGES[key];
      }
    }
    return null;
  }, [pathname]);

  React.useEffect(() => {
    if (!contextPage) {
      setContextBadgeVisible(false);
      return;
    }
    setContextBadgeVisible(true);
    const t = window.setTimeout(() => setContextBadgeVisible(false), 3000);
    return () => window.clearTimeout(t);
  }, [pathname, contextPage]);

  // ── Long-press for quick actions ─────────────────────────────
  const handlePointerDown = React.useCallback(() => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setMenuOpen(true);
    }, 600);
  }, []);
  const handlePointerUp = React.useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen((v) => !v);
  }, []);

  // ── Close menu on outside click ──────────────────────────────
  React.useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-testid="copilot-launcher-menu"]')) return;
      if (target.closest('[data-testid="copilot-launcher"]')) return;
      setMenuOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // ── Hide when disabled or on fullscreen route ────────────────
  const shouldHide =
    !copilotEnabled ||
    (pathname !== null && HIDE_ON_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`)));

  if (shouldHide) return null;

  const handleClick = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    if (copilotOpen) {
      setCopilotOpen(false);
    } else {
      toggleCopilot();
    }
  };

  const handleQuickAction = (action: string) => {
    setMenuOpen(false);
    setCopilotOpen(true);
    // Fire a window event that ComposerInput can listen for. The
    // store stays small — these are UI-only shortcuts.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('copilot:quick_action', { detail: { action } }),
      );
    }
  };

  return (
    <div
      className="pointer-events-none fixed z-50 flex flex-col items-end gap-2"
      style={{
        right: CORNER_OFFSET,
        bottom: CORNER_OFFSET,
      }}
      data-testid="copilot-launcher-root"
    >
      {/* Context badge ─────────────────────────────────────────── */}
      <AnimatePresence>
        {contextBadgeVisible && contextPage && !copilotOpen ? (
          <motion.div
            key="context-badge"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            style={{ marginBottom: CONTEXT_BADGE_OFFSET - 16 }}
          >
            <button
              type="button"
              onClick={() => toggleCopilot()}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--fg-secondary)] shadow-[var(--shadow-md)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]"
              data-testid="copilot-launcher-context-badge"
              aria-label={`Open Co-pilot with ${contextPage.label} context`}
            >
              <contextPage.icon className="h-3 w-3 text-[var(--accent-cyan)]" aria-hidden="true" />
              <span>{contextPage.label}</span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Tooltip ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {tooltipVisible && !menuOpen ? (
          <motion.div
            key="tooltip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-auto absolute right-0 bottom-[calc(100%+12px)] z-10 whitespace-nowrap rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg-primary)] shadow-[var(--shadow-md)]"
            role="tooltip"
            data-testid="copilot-launcher-tooltip"
          >
            {unreadCount > 0 ? (
              <>
                <span className="font-semibold">Forge Co-pilot</span>
                <span className="ml-1 text-[var(--accent-rose)]">
                  · {unreadCount} new message{unreadCount === 1 ? '' : 's'}
                </span>
                <p className="mt-0.5 text-[10px] text-[var(--fg-tertiary)]">
                  Click to view
                </p>
              </>
            ) : (
              <>
                <span className="font-semibold">Forge Co-pilot</span>
                <span className="ml-1 text-[var(--fg-tertiary)]">
                  · {isMac ? '⌘' : 'Ctrl'}J
                </span>
                <p className="mt-0.5 text-[10px] text-[var(--fg-tertiary)]">
                  Ask, draft, navigate
                </p>
              </>
            )}
            <span
              aria-hidden="true"
              className="absolute right-5 -bottom-1 h-2 w-2 rotate-45 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Quick actions menu (long-press / right-click) ──────────── */}
      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            key="quick-menu"
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-auto absolute bottom-[calc(100%+12px)] right-0 z-20 w-56 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-lg)]"
            role="menu"
            aria-label="Co-pilot quick actions"
            data-testid="copilot-launcher-menu"
          >
            <QuickAction
              icon={Plus}
              label="New conversation"
              onClick={() => handleQuickAction('new')}
            />
            <QuickAction
              icon={Sparkles}
              label="Summarize current page"
              onClick={() => handleQuickAction('summarize')}
            />
            <QuickAction
              icon={Mic}
              label="Voice mode"
              onClick={() => handleQuickAction('voice')}
            />
            <QuickAction
              icon={History}
              label="Recent conversations"
              onClick={() => handleQuickAction('history')}
            />
            <div className="my-1 h-px bg-[var(--border-subtle)]" />
            <QuickAction
              icon={SettingsIcon}
              label="Settings"
              onClick={() => handleQuickAction('settings')}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div
        animate={{ scale: copilotOpen ? 0.92 : dragging ? 1.1 : 1 }}
        whileHover={{ scale: copilotOpen ? 0.94 : 1.08 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring' as const, stiffness: 320, damping: 22 }}
        className="pointer-events-auto"
        style={{ width: FAB_SIZE, height: FAB_SIZE }}
      >
        <button
          ref={fabRef}
          type="button"
          onClick={handleClick}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={handleContextMenu}
          onFocus={handlePointerEnter}
          onBlur={handlePointerLeave}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          aria-label={
            copilotOpen
              ? 'Close Forge Co-pilot'
              : unreadCount > 0
                ? `Open Forge Co-pilot — ${unreadCount} new messages`
                : `Open Forge Co-pilot (${isMac ? '⌘' : 'Ctrl'}+J)`
          }
          aria-expanded={copilotOpen}
          aria-haspopup="dialog"
          data-state={copilotOpen ? 'expanded' : 'collapsed'}
          data-thinking={streaming ? 'true' : 'false'}
          data-testid="copilot-launcher"
          className={cn(
            'group relative flex items-center justify-center rounded-full text-white',
            'border border-white/10 cursor-pointer',
            // Idle pulse + hover/active glow.
            !streaming && !copilotOpen && 'animate-[copilot-fab-pulse_3s_ease-in-out_infinite]',
            dragging && 'cursor-grabbing',
          )}
          style={{
            width: FAB_SIZE,
            height: FAB_SIZE,
            // Brand gradient — indigo → cyan per Step 24 spec.
            backgroundImage: streaming
              ? 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-violet) 50%, var(--accent-cyan) 100%)'
              : 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-cyan) 100%)',
            backgroundSize: '200% 200%',
            animation: streaming
              ? 'animate-gradient 2.4s ease-in-out infinite'
              : undefined,
            boxShadow:
              'var(--shadow-lg), 0 0 24px rgba(99,102,241,0.35)',
          }}
        >
          {/* Sparkles icon */}
          <Sparkles
            aria-hidden="true"
            className="h-6 w-6"
            strokeWidth={2}
          />

          {/* Orbital dot — only when idle, no unread */}
          {!streaming && unreadCount === 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)]"
              style={{ animation: 'copilot-orbiting-dot 8s linear infinite' }}
            />
          ) : null}

          {/* Unread badge */}
          <AnimatePresence>
            {!streaming && unreadCount > 0 ? (
              <motion.div
                key="unread-badge"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-rose)] px-1 text-[10px] font-bold text-white shadow-[0_0_0_2px_var(--bg-base)]"
                style={{ animation: 'copilot-unread-pulse 1.6s ease-in-out infinite' }}
                aria-hidden="true"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Thinking dots */}
          {streaming ? (
            <span
              aria-hidden="true"
              className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-[var(--bg-elevated)] px-2 py-1 shadow-[var(--shadow-md)]"
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]"
                style={{ animation: 'copilot-thinking-dot 1.4s ease-in-out infinite' }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]"
                style={{ animation: 'copilot-thinking-dot 1.4s ease-in-out 0.2s infinite' }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]"
                style={{ animation: 'copilot-thinking-dot 1.4s ease-in-out 0.4s infinite' }}
              />
            </span>
          ) : null}
        </button>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-xs)] text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
      data-testid={`copilot-launcher-quick-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export default CopilotLauncher;
