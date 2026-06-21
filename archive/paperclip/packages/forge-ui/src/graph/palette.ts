/**
 * Typed-artifact node palette — Plan 2 §3 + Plan 3 §5.
 *
 * Every node on every canvas is a typed component (no raw HTML nodes —
 * Plan 2 §4.2). All nodes carry a family badge (top-right corner) so the
 * user knows what they're looking at without reading the label. All nodes
 * are color-coded by the typed-artifact family:
 *
 *  - Knowledge   → indigo
 *  - Architecture → emerald
 *  - Dependency  → slate
 *  - Audit       → amber
 *
 * Per Plan 3 §5, color is **paired with shape** (a small leading icon) so
 * WCAG 1.4.1 (color is never the only signal) is satisfied.
 */

import type { GraphFamily } from "./provider";

/** Token names — these map to Tailwind / CSS variables in the design system. */
export const FAMILY_TOKENS: Record<
  GraphFamily,
  { readonly bg: string; readonly border: string; readonly text: string; readonly ring: string }
> = {
  knowledge: {
    bg: "bg-forge-knowledge-bg",
    border: "border-forge-knowledge-border",
    text: "text-forge-knowledge-text",
    ring: "ring-forge-knowledge-border",
  },
  architecture: {
    bg: "bg-forge-architecture-bg",
    border: "border-forge-architecture-border",
    text: "text-forge-architecture-text",
    ring: "ring-forge-architecture-border",
  },
  dependency: {
    bg: "bg-forge-dependency-bg",
    border: "border-forge-dependency-border",
    text: "text-forge-dependency-text",
    ring: "ring-forge-dependency-border",
  },
  audit: {
    bg: "bg-forge-audit-bg",
    border: "border-forge-audit-border",
    text: "text-forge-audit-text",
    ring: "ring-forge-audit-border",
  },
};

/** Human-readable family label (the badge text). */
export const FAMILY_LABEL: Record<GraphFamily, string> = {
  knowledge: "Knowledge",
  architecture: "Architecture",
  dependency: "Dependency",
  audit: "Audit",
};

/** Family short code — used as the typed-artifact badge top-right per Plan 2 §4.2. */
export const FAMILY_BADGE: Record<GraphFamily, string> = {
  knowledge: "K",
  architecture: "A",
  dependency: "D",
  audit: "Au",
};

/** Glyph — a single-character lead icon. Pairs with color (Plan 3 §5 WCAG 1.4.1). */
export const FAMILY_GLYPH: Record<GraphFamily, string> = {
  knowledge: "▤",
  architecture: "▣",
  dependency: "▦",
  audit: "◇",
};

/** Edge style tokens — Plan 2 §4.3. */
export const EDGE_KIND_STYLE: Record<
  "solid" | "dashed" | "animated",
  { readonly className: string; readonly ariaLabel: string }
> = {
  solid: {
    className: "stroke-2 stroke-ink-default",
    ariaLabel: "present-tense relation",
  },
  dashed: {
    className: "stroke-2 stroke-ink-muted [stroke-dasharray:4_3]",
    ariaLabel: "historical relation",
  },
  animated: {
    className: "stroke-2 stroke-ink-default [stroke-dasharray:6_3] animate-pulse",
    ariaLabel: "live tail",
  },
};

/**
 * Classify an edge kind into one of the three render styles.
 * `followed_by` with `live: true` is the only animated case.
 */
export function classifyEdgeKind(kind: string, live?: boolean): "solid" | "dashed" | "animated" {
  if (live) return "animated";
  if (kind === "supersedes" || kind === "followed_by") return "dashed";
  return "solid";
}
