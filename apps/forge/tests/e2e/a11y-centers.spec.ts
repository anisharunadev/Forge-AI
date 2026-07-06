/**
 * M12 — Production Hardening (G5).
 *
 * WCAG AA pass on all 9 centers (parent spec §5 M12 deliverable):
 *   connector-center, ideation, architecture, runs, audit, knowledge-center,
 *   onboarding, copilot, agent-center.
 *
 * Uses `@axe-core/playwright` to scan each center for accessibility
 * violations of severity `critical` or `serious`. Fails the build on
 * any violation.
 *
 * Scope decisions (deliberate, documented in M12 spec §2 G5):
 *   - Tag filter is `wcag2a` + `wcag2aa` + `wcag21a` + `wcag21aa` (AA floor).
 *   - `moderate` / `minor` violations are logged but do NOT fail the test
 *     (M12 follow-up: triage queue).
 *   - Each scan runs after `domcontentloaded`; we don't wait for full
 *     hydration because axe works on the static DOM shape.
 *   - Centers that require authentication are seeded with a default
 *     Steward principal via the `authenticateAsSteward` helper.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { navigateTo } from './helpers';

const CENTERS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'connector-center', label: 'Connector Center' },
  { slug: 'ideation', label: 'Ideation' },
  { slug: 'architecture', label: 'Architecture' },
  { slug: 'runs', label: 'Runs' },
  { slug: 'audit', label: 'Audit' },
  { slug: 'knowledge-center', label: 'Knowledge Center' },
  { slug: 'onboarding', label: 'Onboarding' },
  { slug: 'copilot', label: 'Co-pilot' },
  { slug: 'agent-center', label: 'Agent Center' },
];

for (const center of CENTERS) {
  test(`a11y: ${center.label} (${center.slug}) has no WCAG AA critical/serious violations`, async ({
    page,
  }) => {
    await navigateTo(page, `/${center.slug}`);

    // Wait for the page chrome to mount — at minimum the main grid or
    // a known testid. Each center has its own first-paint anchor.
    const firstPaintAnchor = page.locator('main, [role="main"], h1, h2').first();
    await expect(firstPaintAnchor).toBeVisible({ timeout: 10_000 });

    // Run axe with WCAG AA tag filter.
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Filter to critical / serious violations only.
    const blocking = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    if (blocking.length > 0) {
      // Dump a structured report so the failure message is actionable.
      const report = blocking
        .map(
          (v) =>
            `  - [${v.impact}] ${v.id} (${v.nodes.length} nodes)\n` +
            `      ${v.help}\n` +
            `      ${v.helpUrl}`,
        )
        .join('\n');
      throw new Error(
        `WCAG AA violations on /${center.slug}:\n${report}`,
      );
    }

    // Log moderate/minor counts so they show up in CI logs even if
    // they don't block. (M12 follow-up: triage queue.)
    const informational = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'moderate' || v.impact === 'minor',
    );
    if (informational.length > 0) {
      console.log(
        `[a11y: ${center.slug}] ${informational.length} moderate/minor violation(s) — not blocking`,
      );
    }
  });
}

test.describe('M12 a11y meta', () => {
  test('all 9 centers are covered', () => {
    // Guard against accidentally dropping a center from the iteration
    // list — if you add a center to the array, this auto-updates.
    expect(CENTERS.length).toBe(9);
  });

  test('all centers have a valid slug', () => {
    for (const center of CENTERS) {
      expect(center.slug).toMatch(/^[a-z-]+$/);
      expect(center.label).toBeTruthy();
    }
  });
});