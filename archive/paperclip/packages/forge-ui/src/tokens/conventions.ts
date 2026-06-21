/**
 * engagement/<customer-slug>/conventions.md override hook — FORA-393 Plan 3 §6.
 *
 * When a customer engagement provides a `conventions.md` file, brand tokens
 * (CSS custom properties) may be overridden at runtime to honor the customer's
 * brand overlay (e.g. corporate primary colour, logo system, custom typography).
 *
 * Resolution order:
 *   1. Customer engagement override (highest priority)
 *   2. KnackForge brand overlay (Plan 3 §3)
 *   3. OS / system preference (customer persona default)
 *
 * Conventions.md is intentionally Markdown so non-engineers can edit it. The
 * shape is documented in `tokens/conventions.schema.md` and validated at load.
 */
import type { Persona, ThemeMode } from "./types";

export interface CustomerConventionOverride {
  /** Customer slug, e.g. "acme". Loaded from engagement/<slug>/conventions.md. */
  readonly customerSlug: string;

  /** Optional HSL tokens, e.g. { 'brand-primary': '210 100% 50%' }. */
  readonly tokens?: Readonly<Record<string, string>>;

  /** Optional persona → theme default override. */
  readonly personaTheme?: Readonly<Partial<Record<Persona, ThemeMode>>>;

  /** Optional brand name shown in the shell. */
  readonly brandName?: string;
}

export interface ConventionsResolution {
  /** Effective tokens after merging customer override on top of KnackForge defaults. */
  readonly tokens: Record<string, string>;
  /** Effective persona theme map after override. */
  readonly personaTheme: Record<Persona, ThemeMode>;
}

const DEFAULT_PERSONA_THEME: Record<Persona, ThemeMode> = {
  pm: "light",
  "eng-lead": "dark",
  cto: "dark",
  "vp-eng": "dark",
  security: "dark",
  customer: "system",
};

const DEFAULT_TOKENS: Record<string, string> = {
  "brand-primary": "252 100% 68%",
  "brand-accent": "162 78% 42%",
  "brand-warn": "38 92% 50%",
  "brand-danger": "0 84% 60%",
  "brand-success": "142 71% 45%",
};

/**
 * Resolve customer override on top of KnackForge defaults.
 * Pure function — keeps ThemeProvider unaware of file IO and tenant lookups.
 */
export function resolveConventions(
  override?: CustomerConventionOverride | null,
): ConventionsResolution {
  if (!override) {
    return {
      tokens: { ...DEFAULT_TOKENS },
      personaTheme: { ...DEFAULT_PERSONA_THEME },
    };
  }
  return {
    tokens: { ...DEFAULT_TOKENS, ...(override.tokens ?? {}) },
    personaTheme: { ...DEFAULT_PERSONA_THEME, ...(override.personaTheme ?? {}) },
  };
}

/**
 * Apply resolved tokens to the document root as CSS custom properties.
 * Called by the consumer (e.g. shell) after resolving conventions per tenant.
 */
export function applyTokensToDocument(tokens: Readonly<Record<string, string>>): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${name}`, value);
  }
}