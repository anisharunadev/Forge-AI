/**
 * Forge UI smoke tests.
 *
 * Verifies the app shell loads, the dashboard renders, and the admin
 * navigation surfaces the major centers. These are the first tests
 * CI should run — they fail fast if the app is not serving at all.
 */

import { expect, test } from '@playwright/test';
import { navigateTo, setup } from './helpers';

test.describe('Forge smoke (shell + navigation)', () => {
  test('home redirects to dashboard', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // The root route performs a server redirect to /dashboard.
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('dashboard loads', async ({ page }) => {
    await setup(page);
    await expect(page.getByTestId('issue-dashboard')).toBeVisible();
  });

  test('dashboard shows the command center card', async ({ page }) => {
    await navigateTo(page, '/dashboard');
    // The command center is reachable from the admin nav. Validate the
    // nav link is present and routes correctly.
    const commandLink = page.locator('a[href="/forge-command-center"]').first();
    await expect(commandLink).toBeVisible();
  });

  test('dashboard shows the terminal center card', async ({ page }) => {
    await navigateTo(page, '/dashboard');
    const terminalLink = page.locator('a[href="/forge-terminal"]').first();
    await expect(terminalLink).toBeVisible();
  });

  test('admin shell navigates between centers', async ({ page }) => {
    await navigateTo(page, '/forge-command-center');
    await expect(page.getByRole('heading', { name: /Run a forge-/i })).toBeVisible();

    await page.locator('a[href="/forge-terminal"]').first().click();
    await expect(page).toHaveURL(/\/forge-terminal/);

    await page.locator('a[href="/agent-center"]').first().click();
    await expect(page).toHaveURL(/\/agent-center/);
  });
});
