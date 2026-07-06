'use client';

// Forge's own theme provider. Replaces `next-themes` to avoid React 19's
// "Encountered a script tag while rendering React component" warning, which
// fires when `<script dangerouslySetInnerHTML>` is rendered inside a Client
// Component tree (the library injects a pre-hydration inline script to set the
// theme attribute on `<html>` and avoid FOUC).
//
// Behaviour we keep from next-themes:
//   - localStorage-backed theme persistence (`storageKey="theme"`).
//   - `attribute="class"` so Tailwind's `darkMode: 'class'` works.
//   - The hook signature `{ theme, resolvedTheme, setTheme, themes }` so
//     existing call sites (ThemeToggle, Topbar, CommandPalette) keep working
//     after the import swap.
//
// FOUC tradeoff: the default `<html className="dark">` set in `app/layout.tsx`
// covers the dark case (no flash). Users who have toggled to `light` see a
// brief dark flash on reload because we cannot pre-paint from a React Client
// Component without rendering a `<script>` tag. Acceptable: dark is the
// documented default per Rule 18 / Design System tokens.

import * as React from 'react';

export type Theme = 'dark' | 'light';

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: Theme;
  setTheme: (theme: Theme) => void;
  themes: Theme[];
};

const STORAGE_KEY = 'theme';

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

/**
 * Apply the theme class on `<html>` and the document color scheme.
 * Runs both on the server (default) and on every theme change.
 */
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

export function ThemeProvider({
  attribute = 'class',
  defaultTheme = 'dark',
  themes = ['dark', 'light'] as Theme[],
  children,
}: {
  attribute?: 'class' | string;
  defaultTheme?: Theme;
  themes?: Theme[];
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = React.useState<Theme>(defaultTheme);

  // Read stored preference before paint on the client. `useLayoutEffect`
  // runs synchronously after DOM mutations but before browser paint, so the
  // user sees the correct theme on first frame instead of a flash of dark.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useLayoutEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        setThemeState(stored);
        applyTheme(stored);
        return;
      }
    } catch {
      // localStorage can throw in privacy modes — fall through to default.
    }
    applyTheme(defaultTheme);
  }, []);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; theme is still applied for this session.
    }
    applyTheme(next);
    // attribute is accepted for API parity with next-themes; we only support
    // the `class` strategy Tailwind expects here.
    void attribute;
  }, [attribute]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme: theme,
      setTheme,
      themes,
    }),
    [theme, setTheme, themes],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    // Fallback when no provider is mounted (e.g., during tests) — matches
    // next-themes' default behaviour of returning a stub setTheme.
    return {
      theme: 'dark',
      resolvedTheme: 'dark',
      setTheme: () => {},
      themes: ['dark', 'light'],
    };
  }
  return ctx;
}