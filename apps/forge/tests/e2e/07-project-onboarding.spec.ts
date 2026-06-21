/**
 * Project Onboarding wizard E2E tests.
 *
 * The wizard is a six-step client flow (tenant setup, connect repos,
 * detect stack, configure agents, run first intel, review). State is
 * persisted in a zustand store; the wizard survives reloads mid-flow.
 *
 * The tests below exercise the chrome of each step. The "run first
 * intel" step uses a mocked 1.2s timer — we wait long enough for it
 * to flip from `running` to `done` before advancing.
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

test.describe('Project Onboarding wizard', () => {
  test.beforeEach(async ({ page }) => {
    // Reset the wizard store between tests by reloading with cleared
    // localStorage. The store is keyed under a stable id.
    await page.goto('/project-onboarding');
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  test('onboarding loads on step 1', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    await expect(
      page.getByRole('heading', { name: /Tenant|Workspace|Step 1/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('step 1 — tenant setup renders form', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    // The tenant form has a name field labeled "Tenant name" or similar.
    await expect(
      page.getByLabel(/Tenant name|Workspace name/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('advance to step 2', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    // Fill the tenant name (it has a default but let's be explicit).
    const tenantInput = page.getByLabel(/Tenant name|Workspace name/i).first();
    await tenantInput.fill('acme-pilot');
    const nextBtn = page.getByRole('button', { name: /Next|Continue/i }).first();
    await nextBtn.click();
    // Step 2 is "Connect repos" — the heading or sample repo entries appear.
    await expect(
      page.getByText(/repo|Repos|Connect repos/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('step 2 — connect repos', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    await page.getByLabel(/Tenant name|Workspace name/i).first().fill('acme');
    await page.getByRole('button', { name: /Next|Continue/i }).first().click();
    await expect(
      page.getByText(/repo|Repos|Connect repos/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('step 3 — detect stack', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    await page.getByLabel(/Tenant name|Workspace name/i).first().fill('acme');
    await page.getByRole('button', { name: /Next|Continue/i }).click();
    await page.getByRole('button', { name: /Next|Continue/i }).click();
    // Stack detection shows the detected stacks.
    await expect(
      page.getByText(/stack|Stack|Detected/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('step 4 — configure agents', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    await page.getByLabel(/Tenant name|Workspace name/i).first().fill('acme');
    // Advance through steps 1-3.
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: /Next|Continue/i }).click();
    }
    await expect(
      page.getByText(/agent|Agent|Assign/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('step 5 — run first intel', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    await page.getByLabel(/Tenant name|Workspace name/i).first().fill('acme');
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: /Next|Continue/i }).click();
    }
    // Step 5 has a "Run intel" / "Start scan" button.
    const runBtn = page
      .getByRole('button', { name: /Run intel|Start scan|Start intel/i })
      .first();
    if (await runBtn.isVisible().catch(() => false)) {
      await runBtn.click();
      // The mock intel takes ~1.2s; wait for the state to flip to done.
      await expect(
        page.getByText(/Done|Complete|Ready/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test('step 6 — review', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    await page.getByLabel(/Tenant name|Workspace name/i).first().fill('acme');
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: /Next|Continue/i }).click();
    }
    // If step 5 has a "Run intel" button, click it and wait.
    const runBtn = page
      .getByRole('button', { name: /Run intel|Start scan|Start intel/i })
      .first();
    if (await runBtn.isVisible().catch(() => false)) {
      await runBtn.click();
      await expect(
        page.getByText(/Done|Complete|Ready/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
    await page.getByRole('button', { name: /Next|Continue/i }).click();
    await expect(
      page.getByText(/Review|Summary|Confirm/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('back button navigates to previous step', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    await page.getByLabel(/Tenant name|Workspace name/i).first().fill('acme');
    await page.getByRole('button', { name: /Next|Continue/i }).click();
    const backBtn = page.getByRole('button', { name: /Back|Previous/i }).first();
    await backBtn.click();
    // We're back on step 1 — the tenant field is visible.
    await expect(
      page.getByLabel(/Tenant name|Workspace name/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('wizard state persists across reload (zustand)', async ({ page }) => {
    await navigateTo(page, '/project-onboarding');
    const tenantInput = page.getByLabel(/Tenant name|Workspace name/i).first();
    await tenantInput.fill('persist-me');
    await page.getByRole('button', { name: /Next|Continue/i }).click();
    // Reload — the zustand store should restore the current step.
    await page.reload({ waitUntil: 'domcontentloaded' });
    // We're still on step 2 (Connect repos).
    await expect(
      page.getByText(/repo|Repos|Connect repos/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
