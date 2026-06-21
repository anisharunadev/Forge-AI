import { configureAxe } from "vitest-axe";

/**
 * FORA accessibility config — WCAG 2.2 AA tags plus best-practice rules.
 * Used by every Vitest a11y assertion and by the Playwright axe-core job.
 *
 * vitest-axe's `configureAxe` is the v0.1.x options shape; the type lives on
 * the function parameter to avoid an `AxeOptions` named import (not exported
 * from the v0.1.x typings).
 */
export const FORA_AXE_OPTIONS: Parameters<typeof configureAxe>[0] = {
  rules: {
    // Color-contrast is verified separately by the design tokens (Plan 3 §3.1).
    "color-contrast": { enabled: true },
  },
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
  },
};

/**
 * Configured axe instance. The explicit `ReturnType<typeof configureAxe>`
 * keeps the inferred type portable across the pnpm `.pnpm/...` store paths
 * (TS2742 portability warning fix).
 */
export const axe: ReturnType<typeof configureAxe> = configureAxe(FORA_AXE_OPTIONS);
