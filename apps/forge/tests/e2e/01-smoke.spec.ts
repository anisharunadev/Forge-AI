/**
 * Forge UI smoke tests (M18 — Product transformation cut).
 *
 * Verifies the app shell loads, the workflow shell renders, and the
 * authenticated home routes to `/workflow`. These are the first
 * tests CI should run — they fail fast if the app is not serving.
 *
 * Per M18, the legacy `/dashboard` route is replaced by the workflow
 * shell (`/workflow`). Bookmarks redirect (see `next.config.mjs`).
 */

import { expect, test } from '@playwright/test';
import { navigateTo, setup } from './helpers';

test.describe('Forge smoke (shell + workflow navigation)', () => {
  test('authenticated home routes to /workflow', async ({ page }) => {
    await setup(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/workflow/);
  });

  test('workflow shell loads', async ({ page }) => {
    await setup(page);
    await expect(page.getByTestId('workflow-progress-bar')).toBeVisible();
  });

  test('workflow shell shows the idea stage', async ({ page }) => {
    await navigateTo(page, '/workflow/idea');
    await expect(
      page.getByTestId('workflow-stage-panel-idea'),
    ).toBeVisible();
  });

  test('workflow shell shows the architecture stage', async ({ page }) => {
    await navigateTo(page, '/workflow/architecture');
    await expect(
      page.getByTestId('workflow-stage-panel-architecture'),
    ).toBeVisible();
  });
});