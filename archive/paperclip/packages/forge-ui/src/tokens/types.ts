/**
 * FORA personas — see FORA-393 Plan 3 §4.1 (per-persona theme defaults).
 * Centralised here so ThemeProvider, Audit Center (investigation mode), and the
 * shell persona switcher all reference the same source of truth.
 */
export type Persona =
  | "pm"
  | "eng-lead"
  | "cto"
  | "vp-eng"
  | "security"
  | "customer";

export type Theme = "light" | "dark";

/**
 * Theme resolution modes (Plan 3 §4.2):
 * - `light` / `dark` explicit override
 * - `system` follows OS prefers-color-scheme (customer default)
 */
export type ThemeMode = Theme | "system";

/** Investigation mode forces dark — Audit Center / Security Center (Plan 3 §4.3). */
export type InvestigationMode = "off" | "on";