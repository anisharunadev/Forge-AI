/**
 * FORA-393-F2 / FORA-508 — Playwright keyboard navigation spec.
 *
 * Plan 2 §6: "Arrow keys move between connected nodes; Cmd/Ctrl+K opens
 * the node-typeahead picker." This spec exercises the picker via the
 * keyboard shortcut against a static demo route. The route lives in
 * apps/forge (FORA-374) and is documented as the CI entry point; until
 * that wiring lands, the spec is the documented contract — `pnpm
 * lint:a11y` runs it.
 */

import { test, expect } from "@playwright/test";

test.describe("graph keyboard nav (FORA-393-F2)", () => {
  test("role=application wrapper exists on the demo route", async ({ page }) => {
    await page.goto("/graph-demo");
    const canvas = page.getByRole("application", { name: /Knowledge Graph/i });
    await expect(canvas).toBeVisible();
  });

  test("Cmd/Ctrl+K focuses the picker", async ({ page }) => {
    await page.goto("/graph-demo");
    const picker = page.locator('[data-forge-graph-picker="true"]');
    // Trigger via the canvas's keydown handler.
    const canvas = page.getByRole("application", { name: /Knowledge Graph/i });
    await canvas.focus();
    await page.keyboard.press("Control+k");
    await expect(picker).toBeFocused();
  });
});
