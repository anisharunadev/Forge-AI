/**
 * Forge workflow shell e2e (M16, Sprint 1 revised).
 *
 * Verifies the workflow shell's headline behaviors:
 *
 *   - `/` routes authenticated users to `/workflow` (not `/dashboard`)
 *   - `/workflow` redirects to the first stage (`/workflow/idea`)
 *   - The progress bar shows all seven stages
 *   - Each stage page deep-links to its underlying center
 *   - Stage navigation works (next / open)
 *
 * This spec is the regression guard for the workflow shell. If it
 * fails, the home page has regressed to the legacy nine-center grid.
 */

import { expect, test } from '@playwright/test';
import { navigateTo, setup } from './helpers';

const SEVEN_STAGE_IDS = [
  'idea',
  'prd',
  'architecture',
  'tasks',
  'approval',
  'develop',
  'pr',
] as const;

test.describe('Forge workflow shell', () => {
  test('authenticated home routes to /workflow', async ({ page }) => {
    await setup(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/workflow/);
  });

  test('/workflow redirects to the first stage', async ({ page }) => {
    await setup(page);
    await page.goto('/workflow', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/workflow\/idea/);
  });

  test('progress bar renders all seven stage chips', async ({ page }) => {
    await navigateTo(page, '/workflow/idea');
    const bar = page.getByTestId('workflow-progress-bar');
    await expect(bar).toBeVisible();
    for (const id of SEVEN_STAGE_IDS) {
      await expect(
        bar.getByTestId(`workflow-stage-chip-${id}`),
      ).toBeVisible();
    }
  });

  test('idea stage deep-links to /ideation', async ({ page }) => {
    await navigateTo(page, '/workflow/idea');
    const cta = page.getByTestId('workflow-stage-open-idea');
    await expect(cta).toHaveAttribute('href', '/ideation');
  });

  test('architecture stage deep-links to /architecture', async ({ page }) => {
    await navigateTo(page, '/workflow/architecture');
    const cta = page.getByTestId('workflow-stage-open-architecture');
    await expect(cta).toHaveAttribute('href', '/architecture');
  });

  test('pr stage deep-links to /connector-center?tab=pulls', async ({ page }) => {
    await navigateTo(page, '/workflow/pr');
    const cta = page.getByTestId('workflow-stage-open-pr');
    await expect(cta).toHaveAttribute('href', '/connector-center?tab=pulls');
  });

  test('idea stage surfaces a Skip-to-PRD CTA', async ({ page }) => {
    await navigateTo(page, '/workflow/idea');
    const next = page.getByTestId('workflow-stage-next-idea');
    await expect(next).toHaveAttribute('href', '/workflow/prd');
  });

  test('pr (final) stage does not surface a Skip CTA', async ({ page }) => {
    await navigateTo(page, '/workflow/pr');
    await expect(page.getByTestId('workflow-stage-final-pr')).toBeVisible();
    await expect(page.getByTestId(/workflow-stage-next-/)).toHaveCount(0);
  });

  test('unknown stage id returns 404', async ({ page }) => {
    await setup(page);
    const response = await page.goto('/workflow/not-a-stage', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(404);
  });
});