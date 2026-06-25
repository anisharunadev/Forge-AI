/**
 * Welcome → Load Demo E2E tests (Plan J commit 1 — covers Plan G).
 *
 * Flow under test:
 *   1. Fresh browser with no `forge.persona` cookie visits `/`.
 *   2. The home page server-redirects to `/welcome` (see
 *      `apps/forge/app/page.tsx` — the first-run check).
 *   3. The "Load Demo (Acme Corp)" card posts `apply` against
 *      `/api/v1/seeds/acme-corp`, polls status, then `router.push` to
 *      `/dashboard`.
 *   4. The sticky `DemoBanner` appears on every page with
 *      "Acme Corp Demo Tenant" and a row count >= 1000.
 *
 * Selectors are derived from the actual components:
 *   - `DemoLoader.tsx` exposes `data-testid="demo-loader-apply"` and
 *     renders the literal "Load Demo" label when idle.
 *   - `DemoBanner.tsx` is `role="status"` with a `data-testid` of
 *     `demo-banner-message` containing the tenant label and a
 *     `data-testid="demo-banner-row-count"` for the count.
 *
 * Requires the backend to be running (the demo seed must be present in
 * `backend/seeds/packages/acme-corp/`). The Playwright config starts
 * `pnpm dev`; the backend is started separately.
 */

import { expect, test } from '@playwright/test';

test.describe('Welcome → Load Demo flow', () => {
  test.beforeEach(async ({ context }) => {
    // Wipe the persona cookie so the home page hits the first-run path.
    await context.clearCookies();
  });

  test('redirects to /welcome when no persona cookie, loads demo, banner appears', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/welcome$/);

    // Sanity: the welcome page is rendering.
    await expect(
      page.getByRole('heading', { name: /Welcome to Forge/i }),
    ).toBeVisible();

    // Click the "Load Demo" button inside the DemoLoader card.
    const applyButton = page.getByTestId('demo-loader-apply');
    await expect(applyButton).toBeVisible();
    await applyButton.click();

    // The DemoLoader polls `status` every 2s and then `router.push`es
    // to `/dashboard`. Allow a generous window — applying 1247+ rows
    // in a fresh DB can take up to 60s on a cold CI runner.
    await page.waitForURL(/\/dashboard$/, { timeout: 90_000 });

    // The sticky DemoBanner should be visible on the dashboard.
    const banner = page.getByTestId('demo-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // Banner must show the tenant label.
    const bannerMessage = page.getByTestId('demo-banner-message');
    await expect(bannerMessage).toContainText(/acme corp demo tenant/i);

    // Banner must show a row count >= 1000. The count is rendered
    // inside a dedicated span; assert on the numeric text node.
    const countText = await page.getByTestId('demo-banner-row-count').textContent();
    expect(countText).not.toBeNull();
    const count = Number((countText ?? '0').replace(/[^0-9]/g, ''));
    expect(count).toBeGreaterThanOrEqual(1000);
  });

  test('welcome page renders both cards', async ({ page }) => {
    await page.goto('/welcome', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('welcome-load-demo-card')).toBeVisible();
    await expect(page.getByTestId('welcome-start-empty-card')).toBeVisible();
  });
});
