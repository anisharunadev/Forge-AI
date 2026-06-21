/**
 * Organization Knowledge E2E tests.
 *
 * Org Knowledge is a tabbed editor over standards, templates, and
 * policies (F-001 / F-002 / F-003). All data is local React state —
 * no backend calls required.
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

test.describe('Organization Knowledge', () => {
  test('org knowledge loads', async ({ page }) => {
    await navigateTo(page, '/organization-knowledge');
    await expect(page.getByTestId('organization-knowledge')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Organization Knowledge/i }),
    ).toBeVisible();
  });

  test('org knowledge standards tab is default', async ({ page }) => {
    await navigateTo(page, '/organization-knowledge');
    await expect(page.getByTestId('tab-standards')).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  test('org knowledge templates tab', async ({ page }) => {
    await navigateTo(page, '/organization-knowledge');
    await page.getByTestId('tab-templates').click();
    await expect(page.getByTestId('tab-templates')).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  test('org knowledge policies tab', async ({ page }) => {
    await navigateTo(page, '/organization-knowledge');
    await page.getByTestId('tab-policies').click();
    await expect(page.getByTestId('tab-policies')).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  test('org knowledge create standard dialog opens', async ({ page }) => {
    await navigateTo(page, '/organization-knowledge');
    const createBtn = page
      .getByRole('button', { name: /Create Standard|New Standard/i })
      .first();
    await createBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });
});
