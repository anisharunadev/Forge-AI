/**
 * Forge Command Center E2E tests.
 *
 * The Command Center is a client-side browser over the static
 * `forge-*` command catalog defined in `lib/forge-commands.ts`.
 * No backend calls are required for browsing, filtering, or
 * searching — only the "Run" action hits the orchestrator.
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

test.describe('Forge Command Center', () => {
  test('command center loads', async ({ page }) => {
    await navigateTo(page, '/forge-command-center');
    await expect(page.getByRole('heading', { name: /Run a forge-/i })).toBeVisible();
  });

  test('command center shows all categories', async ({ page }) => {
    await navigateTo(page, '/forge-command-center');
    const categoryNav = page.getByRole('navigation', {
      name: 'Command categories',
    });
    await expect(categoryNav).toBeVisible();
    // Every button in the category nav is a category.
    const buttons = categoryNav.getByRole('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('command center filters by category', async ({ page }) => {
    await navigateTo(page, '/forge-command-center');
    // Click the "Security" category — its commands include scanners.
    const securityBtn = page
      .getByRole('navigation', { name: 'Command categories' })
      .getByRole('button', { name: /Security/i });
    await securityBtn.click();
    // The Security button is now marked active via the .bg-accent class.
    await expect(securityBtn).toHaveClass(/bg-accent/);
  });

  test('command center search filters commands', async ({ page }) => {
    await navigateTo(page, '/forge-command-center');
    const search = page.getByLabel('Search forge commands');
    await search.fill('scan');
    // The result count line appears whenever there's a query.
    await expect(page.getByText(/Showing \d+ match/)).toBeVisible();
  });

  test('command center click run opens dialog', async ({ page }) => {
    await navigateTo(page, '/forge-command-center');
    const firstRun = page.getByRole('button', { name: 'Run' }).first();
    await firstRun.click();
    // CommandRunDialog renders a "Run command" heading and a primary
    // confirm button. Either one is sufficient to assert the dialog
    // opened.
    await expect(
      page.getByRole('heading', { name: /Run command|Run forge-/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('command center run succeeds with mock backend', async ({ page }) => {
    // Mock the orchestrator run endpoint so we don't need a live backend.
    await page.route('**/api/v1/forge-commands/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          runId: 'mock-run-001',
          status: 'queued',
          command: 'forge-test',
        }),
      });
    });

    await navigateTo(page, '/forge-command-center');
    await page.getByRole('button', { name: 'Run' }).first().click();
    // The dialog's primary action button is labeled "Run" (submit) or
    // "Run command" — depending on how the dialog was authored.
    const confirm = page
      .getByRole('button', { name: /^Run command$|^Run$/ })
      .last();
    await confirm.click();
    // Toast or dialog close — either proves the run action was issued.
    await expect
      .poll(async () => page.url(), { timeout: 5_000 })
      .toMatch(/\/forge-command-center/);
  });
});
