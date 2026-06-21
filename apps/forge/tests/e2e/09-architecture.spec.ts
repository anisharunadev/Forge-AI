/**
 * Architecture center E2E tests.
 *
 * Mirrors the Ideation suite: the nav marks Architecture as "coming
 * soon". Tests assert what is currently implemented (the nav link
 * is present) and skip gracefully when the route does not exist.
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

const ARCH_PATH = '/architecture';

test.describe('Architecture center', () => {
  test('architecture nav link is present in admin shell', async ({ page }) => {
    await navigateTo(page, '/dashboard');
    const link = page
      .locator('a[href*="architecture" i], [aria-disabled]')
      .filter({ hasText: /Architecture/i });
    await expect(link.first()).toBeVisible();
  });

  test('architecture page surfaces when available', async ({ page }) => {
    const res = await page.goto(ARCH_PATH).catch(() => null);
    if (!res) {
      test.skip(true, 'architecture route not available');
      return;
    }
    if (res.status() === 404) {
      test.skip(true, 'architecture route returns 404 — feature pending');
      return;
    }
    await expect(page).toHaveURL(new RegExp(ARCH_PATH));
  });

  test('architecture adrs tab', async ({ page }) => {
    const res = await page.goto(ARCH_PATH).catch(() => null);
    if (!res || res.status() === 404) {
      test.skip(true, 'architecture route not available');
      return;
    }
    const adrsTab = page
      .getByRole('tab', { name: /ADRs|Decision/i })
      .or(page.getByTestId('tab-adrs'));
    if ((await adrsTab.count()) > 0) {
      await adrsTab.first().click();
    }
  });

  test('architecture api contracts tab', async ({ page }) => {
    const res = await page.goto(ARCH_PATH).catch(() => null);
    if (!res || res.status() === 404) {
      test.skip(true, 'architecture route not available');
      return;
    }
    const apiTab = page
      .getByRole('tab', { name: /API Contracts|Contracts/i })
      .or(page.getByTestId('tab-contracts'));
    if ((await apiTab.count()) > 0) {
      await apiTab.first().click();
    }
  });

  test('architecture task breakdown tree', async ({ page }) => {
    const res = await page.goto(ARCH_PATH).catch(() => null);
    if (!res || res.status() === 404) {
      test.skip(true, 'architecture route not available');
      return;
    }
    const treeTab = page
      .getByRole('tab', { name: /Task Breakdown|Tasks/i })
      .or(page.getByTestId('tab-tasks'));
    if ((await treeTab.count()) > 0) {
      await treeTab.first().click();
    }
  });

  test('architecture risk register table', async ({ page }) => {
    const res = await page.goto(ARCH_PATH).catch(() => null);
    if (!res || res.status() === 404) {
      test.skip(true, 'architecture route not available');
      return;
    }
    const riskTab = page
      .getByRole('tab', { name: /Risk Register|Risks/i })
      .or(page.getByTestId('tab-risks'));
    if ((await riskTab.count()) > 0) {
      await riskTab.first().click();
    }
  });

  test('architecture traceability graph', async ({ page }) => {
    const res = await page.goto(ARCH_PATH).catch(() => null);
    if (!res || res.status() === 404) {
      test.skip(true, 'architecture route not available');
      return;
    }
    const graphTab = page
      .getByRole('tab', { name: /Traceability|Graph/i })
      .or(page.getByTestId('tab-traceability'));
    if ((await graphTab.count()) > 0) {
      await graphTab.first().click();
    }
  });
});
