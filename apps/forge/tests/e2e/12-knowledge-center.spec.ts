/**
 * Knowledge Center E2E tests.
 *
 * The Knowledge Center is a server component that renders a file
 * browser, an injection map, and a graph view. URL search params
 * drive the active view (files | map | graph) and filters
 * (folder, type).
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

test.describe('Knowledge Center', () => {
  test('knowledge center loads', async ({ page }) => {
    await navigateTo(page, '/knowledge-center');
    await expect(page.getByTestId('knowledge-center')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Knowledge Center/i }),
    ).toBeVisible();
  });

  test('knowledge center graph view renders', async ({ page }) => {
    await navigateTo(page, '/knowledge-center?view=graph');
    await expect(page.getByTestId('knowledge-center')).toBeVisible();
    // The graph tab is marked active.
    const graphTab = page.getByTestId('tab-graph');
    await expect(graphTab).toHaveAttribute('data-active', 'true');
  });

  test('knowledge center file view shows node inspector', async ({ page }) => {
    // Pick a known file from the manifest and deep-link to it.
    await navigateTo(page, '/knowledge-center?file=memory%2Fcoding.md');
    // The selected file renders the KnowledgeFileView component.
    const main = page.getByTestId('knowledge-center-main');
    await expect(main).toBeVisible();
    // The main element receives data-selected-path when a file is
    // selected.
    await expect(main).toHaveAttribute('data-selected-path', /coding\.md/);
  });

  test('knowledge center search via folder filter works', async ({ page }) => {
    await navigateTo(page, '/knowledge-center');
    // Click the "memory" folder pill.
    const memoryPill = page.getByTestId('filter-folder-memory');
    await memoryPill.click();
    await expect(memoryPill).toHaveAttribute('data-active', 'true');
    // The result count line updates to reflect the new filter.
    await expect(
      page.getByTestId('knowledge-center-result-count'),
    ).toBeVisible();
  });
});
