'use client';

import * as React from 'react';

import { CopilotLauncher } from '@/components/copilot/CopilotLauncher';
import { CopilotPanel } from '@/components/copilot/CopilotPanel';
import { FirstRunNudge } from '@/components/copilot/FirstRunNudge';
import { useCopilotEnabled } from '@/lib/feature-flags';
import { useCopilotStore } from '@/lib/store/copilot';
import { CommandPalette } from './CommandPalette';

/**
 * Shell global state.
 *
 * Owned by `ShellProvider` (mounted once at the layout boundary) and
 * exposed via `useShell()` to the rest of the tree. Co-pilot is a
 * sibling feature and shares the same keydown supervisor so we have
 * exactly one document-level listener for the hotkeys.
 */
interface ShellContextValue {
  // Command palette (⌘K)
  readonly paletteOpen: boolean;
  readonly setPaletteOpen: (b: boolean) => void;
  readonly openPalette: () => void;
  readonly closePalette: () => void;

  // Mobile nav sheet
  readonly mobileNavOpen: boolean;
  readonly setMobileNavOpen: (b: boolean) => void;
  readonly openMobileNav: () => void;
  readonly closeMobileNav: () => void;

  // Co-pilot panel (⌘J)
  readonly copilotOpen: boolean;
  readonly setCopilotOpen: (b: boolean) => void;
  readonly openCopilot: () => void;
  readonly closeCopilot: () => void;

  // Sidebar collapse — persists to localStorage so the user's choice
  // survives a hard refresh.
  readonly sidebarCollapsed: boolean;
  readonly setSidebarCollapsed: (b: boolean) => void;
  readonly toggleSidebar: () => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

const SIDEBAR_COLLAPSED_KEY = 'forge.sidebar.collapsed';

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  // Co-pilot open state is shared with `CopilotPanel`, the FAB
  // launcher, and the `/copilot` route — read it directly from the
  // zustand store so the three sources of truth stay in sync. Step 19
  // unified the FAB and ⌘J hotkey on top of this single store.
  const copilotOpen = useCopilotStore((s) => s.open);
  const setCopilotOpen = useCopilotStore((s) => s.setOpen);
  const [sidebarCollapsed, setSidebarCollapsedState] = React.useState(false);

  // Hydrate persisted collapse state from localStorage. Defaults to
  // expanded on first load.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === 'true') setSidebarCollapsedState(true);
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  const setSidebarCollapsed = React.useCallback((b: boolean) => {
    setSidebarCollapsedState(b);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, b ? 'true' : 'false');
      } catch {
        /* ignore */
      }
    }
  }, []);
  const toggleSidebar = React.useCallback(
    () => setSidebarCollapsedState((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? 'true' : 'false');
        } catch {
          /* ignore */
        }
      }
      return next;
    }),
    [],
  );

  const copilotEnabled = useCopilotEnabled();
  const toggleCopilot = useCopilotStore((s) => s.toggle);

  const openPalette = React.useCallback(() => setPaletteOpen(true), []);
  const closePalette = React.useCallback(() => setPaletteOpen(false), []);
  const openMobileNav = React.useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = React.useCallback(() => setMobileNavOpen(false), []);
  const openCopilot = React.useCallback(() => setCopilotOpen(true), []);
  const closeCopilot = React.useCallback(() => setCopilotOpen(false), []);

  // Single document-level keydown supervisor for ⌘K / ⌘J. If the user
  // is typing inside an input/textarea/select/contenteditable, the
  // keystroke reaches the field instead of hijacking it.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      if (key !== 'k' && key !== 'j') return;

      // ⌘J is gated on the COPILOT_ENABLED flag.
      if (key === 'j' && !copilotEnabled) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isEditable =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable;
        if (isEditable) return;
      }

      e.preventDefault();
      if (key === 'k') {
        setPaletteOpen((prev) => !prev);
      } else {
        toggleCopilot();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [copilotEnabled]);

  const value = React.useMemo<ShellContextValue>(
    () => ({
      paletteOpen,
      setPaletteOpen,
      openPalette,
      closePalette,
      mobileNavOpen,
      setMobileNavOpen,
      openMobileNav,
      closeMobileNav,
      copilotOpen,
      setCopilotOpen,
      openCopilot,
      closeCopilot,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
    }),
    [
      paletteOpen,
      openPalette,
      closePalette,
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
      copilotOpen,
      openCopilot,
      closeCopilot,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
    ],
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      <CommandPalette />
      <CopilotPanel />
      <CopilotLauncher />
      <FirstRunNudge />
    </ShellContext.Provider>
  );
}

export function useShell(): ShellContextValue {
  const ctx = React.useContext(ShellContext);
  if (!ctx) {
    throw new Error('useShell() called outside <ShellProvider>');
  }
  return ctx;
}