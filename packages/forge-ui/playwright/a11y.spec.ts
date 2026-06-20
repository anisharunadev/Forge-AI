import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Smoke axe-core check on the FORA Forge UI demo route. The route ships
 * inside apps/forge (the FORA-374 console) and exercises the brand tokens,
 * the theme switcher, and one of each primitive. Run from the package:
 *   pnpm --filter @fora/forge-ui lint:a11y
 */
test("FORA Forge UI demo route passes WCAG 2.2 AA (axe-core)", async ({ page }) => {
  await page.goto("/_demo/forge-ui");
  await expect(page.getByRole("heading", { name: /FORA Design System/i })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});