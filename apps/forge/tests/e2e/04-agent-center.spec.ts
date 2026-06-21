/**
 * Agent Center E2E tests.
 *
 * The Agent Center is a tabbed view over mock data — agents, model
 * providers, assignments, and runtimes. All flows are client-side.
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

test.describe('Agent Center', () => {
  test('agent center loads', async ({ page }) => {
    await navigateTo(page, '/agent-center');
    await expect(page.getByTestId('agent-center')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Agent Center/i }),
    ).toBeVisible();
  });

  test('agent center agents tab is default', async ({ page }) => {
    await navigateTo(page, '/agent-center');
    const agentsTab = page.getByTestId('tab-agents');
    await expect(agentsTab).toHaveAttribute('data-state', 'active');
  });

  test('agent center switches to providers tab', async ({ page }) => {
    await navigateTo(page, '/agent-center');
    await page.getByTestId('tab-providers').click();
    await expect(page.getByTestId('tab-providers')).toHaveAttribute(
      'data-state',
      'active',
    );
    // The Model Provider section heading should appear.
    await expect(
      page.getByRole('heading', { name: /Model Provider/i }).first(),
    ).toBeVisible();
  });

  test('agent center switches to assignments tab', async ({ page }) => {
    await navigateTo(page, '/agent-center');
    await page.getByTestId('tab-assignments').click();
    await expect(page.getByTestId('tab-assignments')).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  test('agent center switches to runtimes tab', async ({ page }) => {
    await navigateTo(page, '/agent-center');
    await page.getByTestId('tab-runtimes').click();
    await expect(page.getByTestId('tab-runtimes')).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  test('agent center create dialog opens', async ({ page }) => {
    await navigateTo(page, '/agent-center');
    const createBtn = page.getByRole('button', { name: /Create Agent|Register/i });
    await createBtn.first().click();
    // Dialog opens — assert by the dialog role or a heading.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });
});
