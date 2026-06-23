'use client';

import * as React from 'react';

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
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

/**
 * The shell owns two global UI states: the CMD+K command palette and
 * the mobile navigation drawer. Both are mounted once at the layout
 * boundary and exposed via `useShell()` to the rest of the tree.
 *
 * The global Cmd/Ctrl-K keyboard listener also lives here so we have
 * exactly one listener for the whole document.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const openPalette = React.useCallback(() => setPaletteOpen(true), []);
  const closePalette = React.useCallback(() => setPaletteOpen(false), []);
  const openMobileNav = React.useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = React.useCallback(() => setMobileNavOpen(false), []);

  // Cmd/Ctrl-K listener — suppressed when the user is typing in an
  // input, textarea, select, or contenteditable so the keystroke
  // reaches the field instead of hijacking it.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.key.toLowerCase() !== 'k') return;
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
      setPaletteOpen((prev) => !prev);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    }),
    [
      paletteOpen,
      openPalette,
      closePalette,
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
    ],
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      <CommandPalette />
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
