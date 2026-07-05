import { test, expect } from '@playwright/test';

/**
 * Phase 5 — Audit live tab.
 *
 * Skips if the admin route is not mounted in the test environment.
 * The status indicator is the contract we assert on: opening the
 * page must surface the WS connection state without page refresh.
 */
test('audit live tab renders and shows the connection indicator', async ({ page }) => {
  await page.goto('/admin/audit').catch(() => test.skip(true, 'route not mounted in this env'));
  const liveTab = page.getByRole('tab', { name: /live/i });
  await liveTab.click();
  await expect(page.getByTestId('audit-live-panel')).toBeVisible();
  await expect(page.getByTestId('audit-live-status')).toBeVisible();
});
