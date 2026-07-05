/**
 * Connector Center E2E tests.
 *
 * The Connector Center is a tabbed view over mock connectors and a
 * marketplace catalog. Tabs: Connected (default), Marketplace, Health,
 * Activity. Detail panel opens when a connector card is clicked.
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

test.describe('Connector Center', () => {
  test('connector center loads', async ({ page }) => {
    await navigateTo(page, '/connector-center');
    await expect(page.getByTestId('connector-center-m2')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Connector Center/i }),
    ).toBeVisible();
  });

  test('connector center connected tab is default', async ({ page }) => {
    await navigateTo(page, '/connector-center');
    await expect(page.getByTestId('tab-connected')).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  test('connector center health badges are visible', async ({ page }) => {
    await navigateTo(page, '/connector-center');
    // At least one health badge (one of the status pills on a card).
    const badge = page.locator('[data-testid^="health-badge-"]').first();
    await expect(badge).toBeVisible({ timeout: 5_000 });
  });

  test('connector center marketplace tab', async ({ page }) => {
    await navigateTo(page, '/connector-center');
    await page.getByTestId('tab-marketplace').click();
    await expect(page.getByTestId('tab-marketplace')).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  test('connector center add connector wizard opens', async ({ page }) => {
    await navigateTo(page, '/connector-center');
    const addBtn = page
      .getByRole('button', { name: /Add Connector|Add Integration/i })
      .first();
    await addBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  test('connector center detail panel opens on click', async ({ page }) => {
    await navigateTo(page, '/connector-center');
    // The first connector card has a "View" / "Open" button or is
    // itself clickable. Look for any actionable card.
    const firstCard = page
      .locator('[data-testid^="connector-card-"]')
      .first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
    } else {
      // Fallback: click the first "Open" / "Details" button on the page.
      await page
        .getByRole('button', { name: /Open|Details|View/i })
        .first()
        .click();
    }
    // Detail panel is a dialog.
    await expect(page.getByRole('dialog').first()).toBeVisible({
      timeout: 5_000,
    });
  });

  // ==========================================================================
  // M3-G22 — Playwright e2e extend to 7 cases (one per tab). Each test
  // verifies the tab loads without error and shows either real data or
  // a Rule-15 empty state, never just an offline banner.
  // ==========================================================================

  test('connector center credentials tab shows real data or empty state', async ({ page }) => {
    await navigateTo(page, '/connector-center');
    await page.getByTestId('tab-credentials').click();
    await expect(page.getByTestId('tab-credentials')).toHaveAttribute(
      'data-state',
      'active',
    );
    // Either at least one credential card, or the Rule-15 empty-state copy.
    const cardCount = await page.locator('[data-testid^="credential-"]').count();
    const emptyVisible = await page
      .getByText(/No credentials saved|no credentials configured/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(cardCount > 0 || emptyVisible).toBe(true);
  });

  test('connector center webhooks tab shows real data or empty state', async ({ page }) => {
    await navigateTo(page, '/connector-center');
    await page.getByTestId('tab-webhooks').click();
    await expect(page.getByTestId('tab-webhooks')).toHaveAttribute(
      'data-state',
      'active',
    );
    const rowCount = await page.locator('[data-testid^="webhook-"]').count();
    const emptyVisible = await page
      .getByText(/No webhooks configured/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(rowCount > 0 || emptyVisible).toBe(true);
  });

  test('connector center activity tab shows ≥1 event or empty state', async ({ page }) => {
    await navigateTo(page, '/connector-center');
    await page.getByTestId('tab-activity').click();
    await expect(page.getByTestId('tab-activity')).toHaveAttribute(
      'data-state',
      'active',
    );
    const eventCount = await page.locator('[data-testid^="activity-event-"]').count();
    const emptyVisible = await page
      .getByText(/No activity yet/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(eventCount > 0 || emptyVisible).toBe(true);
  });
});
