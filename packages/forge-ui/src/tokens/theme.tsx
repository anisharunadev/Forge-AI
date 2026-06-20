import type { JSX } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { InvestigationMode, Persona, Theme, ThemeMode } from "./types";

/**
 * Per-persona theme defaults — FORA-393 Plan 3 §4.1.
 * Customer is `system` (follows OS prefers-color-scheme).
 */
export const PERSONA_DEFAULT_THEME: Record<Persona, ThemeMode> = {
  pm: "light",
  "eng-lead": "dark",
  cto: "dark",
  "vp-eng": "dark",
  security: "dark",
  customer: "system",
};

const STORAGE_KEY = "forge-theme";
const COOKIE_NAME = "forge-theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, tenant-scoped in the consumer

export interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  persona: Persona;
  investigationMode: InvestigationMode;
  setMode: (mode: ThemeMode) => void;
  setPersona: (persona: Persona) => void;
  setInvestigationMode: (mode: InvestigationMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readCookieMode(): ThemeMode | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (value === "light" || value === "dark" || value === "system") return value;
  return null;
}

function writeCookie(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(mode)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}

function readStorageMode(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // Ignore quota / privacy mode errors — fall back to cookie.
  }
  return null;
}

function writeStorage(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // noop
  }
}

function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): Theme {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export interface ThemeProviderProps {
  /** Active persona. Determines initial theme if user has no preference. */
  persona: Persona;
  /** Optional initial mode override; otherwise uses cookie → localStorage → persona default. */
  initialMode?: ThemeMode;
  children: ReactNode;
}

/**
 * ThemeProvider — wires Plan 3 §4 (dark/light, per-persona defaults, cookie persistence,
 * investigation mode). Renders children inside a [data-theme] wrapper so Tailwind dark: works.
 */
export function ThemeProvider({
  persona,
  initialMode,
  children,
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(
    initialMode ?? PERSONA_DEFAULT_THEME[persona],
  );
  const [resolvedPersona, setPersona] = useState<Persona>(persona);
  const [investigationMode, setInvestigationMode] =
    useState<InvestigationMode>("off");
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(false);

  // Hydrate from storage + cookie + system preference on mount.
  useEffect(() => {
    setSystemPrefersDark(getSystemPrefersDark());
    const stored = readStorageMode() ?? readCookieMode();
    if (stored) setModeState(stored);
  }, []);

  // React to OS theme change when in `system` mode.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent): void => setSystemPrefersDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const theme: Theme = useMemo(
    () => resolveTheme(mode, systemPrefersDark),
    [mode, systemPrefersDark],
  );

  // Investigation mode wins — forces dark regardless of preference (Plan 3 §4.3).
  const effectiveTheme: Theme =
    investigationMode === "on" ? "dark" : theme;

  // Reflect on document for CSS variable cascade.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    document.documentElement.setAttribute("data-persona", resolvedPersona);
    document.documentElement.setAttribute(
      "data-investigation-mode",
      investigationMode,
    );
  }, [effectiveTheme, resolvedPersona, investigationMode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    writeStorage(next);
    writeCookie(next);
  }, []);

  const setPersonaAndMode = useCallback((next: Persona) => {
    setPersona(next);
    const nextMode = PERSONA_DEFAULT_THEME[next];
    setModeState(nextMode);
    writeStorage(nextMode);
    writeCookie(nextMode);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: effectiveTheme,
      mode,
      persona: resolvedPersona,
      investigationMode,
      setMode,
      setPersona: setPersonaAndMode,
      setInvestigationMode,
    }),
    [effectiveTheme, mode, resolvedPersona, investigationMode, setMode, setPersonaAndMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}