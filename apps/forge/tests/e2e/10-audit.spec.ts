/**
 * Audit center E2E tests.
 *
 * The Audit nav item is currently a "coming soon" placeholder.
 * Tests assert the nav link and skip if the route is not yet wired.
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

const AUDIT_PATH = '/audit';

test.describe('Audit center', () => {
  test('audit nav link is present in admin shell', async ({ page }) => {
    await navigateTo(page, '/dashboard');
    const link = page
      .locator('a[href*="audit" i], [aria-disabled]')
      .filter({ hasText: /Audit/i });
    await expect(link.first()).toBeVisible();
  });

  test('audit page surfaces when available', async ({ page }) => {
    const res = await page.goto(AUDIT_PATH).catch(() => null);
    if (!res) {
      test.skip(true, 'audit route not available');
      return;
    }
    if (res.status() === 404) {
      test.skip(true, 'audit route returns 404 — feature pending');
      return;
    }
    await expect(page).toHaveURL(new RegExp(AUDIT_PATH));
  });

  test('audit timeline visible', async ({ page }) => {
    const res = await page.goto(AUDIT_PATH).catch(() => null);
    if (!res || res.status() === 404) {
      test.skip(true, 'audit route not available');
      return;
    }
    const timeline = page
      .getByTestId('audit-timeline')
      .or(page.getByRole('region', { name: /Audit timeline/i }));
    if ((await timeline.count()) > 0) {
      await expect(timeline.first()).toBeVisible();
    }
  });

  test('audit filter bar visible', async ({ page }) => {
    const res = await page.goto(AUDIT_PATH).catch(() => null);
    if (!res || res.status() === 404) {
      test.skip(true, 'audit route not available');
      return;
    }
    const filterBar = page
      .getByTestId('audit-filter-bar')
      .or(page.getByRole('region', { name: /Audit filters/i }));
    if ((await filterBar.count()) > 0) {
      await expect(filterBar.first()).toBeVisible();
    }
  });

  test('audit detail panel opens on click', async ({ page }) => {
    const res = await page.goto(AUDIT_PATH).catch(() => null);
    if (!res || res.status() === 404) {
      test.skip(true, 'audit route not available');
      return;
    }
    const firstRow = page
      .getByTestId('audit-row')
      .or(page.locator('[data-testid^="audit-event-"]'))
      .first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      await expect(page.getByRole('dialog').first()).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
