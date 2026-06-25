'use client';

import * as React from 'react';

import { CopilotPanel } from '@/components/copilot/CopilotPanel';
import { FirstRunNudge } from '@/components/copilot/FirstRunNudge';
import { useCopilotEnabled } from '@/lib/feature-flags';
import { CommandPalette } from './CommandPalette';

interface ShellContextValue {
  readonly paletteOpen: boolean;
  readonly setPaletteOpen: (b: boolean) => void;
  readonly openPalette: () => void;
  readonly closePalette: () => void;
  readonly mobileNavOpen: boolean;
  readonly setMobileNavOpen: (b: boolean) => void;
  readonly openMobileNav: () => void;
  readonly closeMobileNav: () => void;
  readonly copilotOpen: boolean;
  readonly setCopilotOpen: (b: boolean) => void;
  readonly openCopilot: () => void;
  readonly closeCopilot: () => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

/**
 * The shell owns global UI states: the CMD+K command palette, the
 * mobile navigation drawer, and the CMD+J Co-pilot panel. All three
 * are mounted once at the layout boundary and exposed via `useShell()`
 * to the rest of the tree.
 *
 * The global Cmd/Ctrl-K and Cmd/Ctrl-J keyboard listeners also live
 * here so we have exactly one listener pair for the whole document.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [copilotOpen, setCopilotOpen] = React.useState(false);

  // Co-pilot is feature-flagged server-side. Cmd+J is gated on
  // `COPILOT_ENABLED` so disabling the flag in production silently
  // drops the hotkey without breaking the rest of the shell.
  const copilotEnabled = useCopilotEnabled();

  const openPalette = React.useCallback(() => setPaletteOpen(true), []);
  const closePalette = React.useCallback(() => setPaletteOpen(false), []);
  const openMobileNav = React.useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = React.useCallback(() => setMobileNavOpen(false), []);
  const openCopilot = React.useCallback(() => setCopilotOpen(true), []);
  const closeCopilot = React.useCallback(() => setCopilotOpen(false), []);

  // Global keydown handler — same suppression rules apply to both
  // Cmd/Ctrl-K (palette) and Cmd/Ctrl-J (co-pilot): if the user is
  // typing in an INPUT, TEXTAREA, SELECT, or contenteditable, the
  // keystroke reaches the field instead of hijacking it.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      if (key !== 'k' && key !== 'j') return;

      // Cmd+J is gated on COPILOT_ENABLED — when the flag is off,
      // we let the keystroke pass through to whatever the host
      // page wants to do with it.
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
        setCopilotOpen((prev) => !prev);
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
    ],
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      <CommandPalette />
      <CopilotPanel />
      <FirstRunNudge />
    </ShellContext.Provider>
  );
}

/**
 * Hook for the shell context. Throws when called outside the provider
 * so the developer sees the missing-provider bug at the first call.
 */
export function useShell(): ShellContextValue {
  const ctx = React.useContext(ShellContext);
  if (!ctx) {
    throw new Error('useShell() called outside <ShellProvider>');
  }
  return ctx;
}
