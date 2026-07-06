import { test, expect } from '@playwright/test';

/**
 * Sprint 3 — Crash #5 regression test (E2E side).
 *
 * Contract: the audit live panel must always render once the route is
 * reachable, regardless of WS state. The panel carries a data-status
 * attribute so tests / observability can distinguish "connecting",
 * "open", "reconnecting", and "closed" without scraping the DOM. A
 * Retry button appears when status is reconnecting/closed.
 *
 * We don't skip when the route is mounted but the WS endpoint is
 * unavailable — instead, the panel renders with `data-status` and the
 * Retry button so the user always knows why the feed isn't streaming.
 */
test('audit live panel always renders with data-status attribute', async ({ page }) => {
  const res = await page.goto('/admin/audit').catch(() => null);
  if (!res) {
    test.skip(true, 'route not mounted in this env');
    return;
  }
  if (res.status() === 404) {
    test.skip(true, 'audit route returns 404 — feature pending');
    return;
  }

  const liveTab = page.getByRole('tab', { name: /live/i });
  await liveTab.click();

  // Panel must always be present with a data-status attribute.
  const panel = page.getByTestId('audit-live-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-status', /connecting|open|reconnecting|closed/);

  // Status indicator always visible.
  await expect(page.getByTestId('audit-live-status')).toBeVisible();
});

test('audit live panel shows Retry button when WS is reconnecting or closed', async ({ page }) => {
  const res = await page.goto('/admin/audit').catch(() => null);
  if (!res || res.status() === 404) {
    test.skip(true, 'audit route not available');
    return;
  }

  const liveTab = page.getByRole('tab', { name: /live/i });
  await liveTab.click();

  // Wait for the WS to settle into a non-open state (offline backend
  // means status will land on reconnecting/closed within a few seconds).
  const panel = page.getByTestId('audit-live-panel');
  await expect(panel).toBeVisible();

  // Either the Retry button is visible now (status landed on a non-open
  // state) or we wait briefly for it to appear.
  const retry = page.getByTestId('audit-live-retry');
  await expect(retry).toBeVisible({ timeout: 5000 });
});
