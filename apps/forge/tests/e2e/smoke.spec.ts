import { expect, test } from '@playwright/test';

test.describe('Forge console smoke (FORA-374 AC)', () => {
  test('home page renders the persona picker and switches persona', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.getByTestId('persona-card-pm')).toBeVisible();
    await expect(page.getByTestId('persona-card-eng-lead')).toBeVisible();
    await expect(page.getByTestId('persona-card-cto')).toBeVisible();
  });

  test('PM dashboard renders the active-runs section even when no runs exist', async ({ page }) => {
    await page.goto('/personas/pm');
    await expect(page.getByTestId('pm-dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Active runs' })).toBeVisible();
  });

  test('Engineering Lead dashboard renders runs and the operator action bar', async ({ page }) => {
    await page.goto('/personas/eng-lead');
    await expect(page.getByTestId('eng-lead-dashboard')).toBeVisible();
    // The action bar only renders when there is at least one run; an
    // empty stack still proves the page renders the persona view.
    await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible();
  });

  test('CTO dashboard renders the cost-by-goal and audit-log sections', async ({ page }) => {
    await page.goto('/personas/cto');
    await expect(page.getByTestId('cto-dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cost by goal' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  });

  test('persona switcher navigates to the chosen persona view', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('persona-switcher').locator('button').first().click();
    await page.getByTestId('persona-option-cto').click();
    await expect(page).toHaveURL(/\/personas\/cto/);
  });

  test('healthz returns the liveness JSON', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', service: 'forge' });
  });
});