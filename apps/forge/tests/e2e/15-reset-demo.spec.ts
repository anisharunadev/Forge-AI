/**
 * /admin/seeds reset flow E2E tests (Plan J commit 2 — covers Plan H).
 *
 * Validates the production-safety contract on the reset mutation:
 *   - Steward (forge.persona=steward) can reset scope=demo_only — the
 *     destructive action succeeds and the modal closes.
 *   - Non-Steward (forge.persona=pm) can open the modal and select
 *     scope=all (the warning is rendered), but the backend rejects
 *     the mutation with 403 and the destructive error message is
 *     surfaced inline.
 *
 * Selectors derived from `components/seeds/SeedResetModal.tsx`:
 *   - `data-testid="seed-reset-trigger"` — opens the modal
 *   - `data-testid="seed-reset-scope-trigger"` — scope <SelectTrigger>
 *   - `data-testid="seed-reset-warning"` — destructive warning panel
 *   - `data-testid="seed-reset-error"` — inline error on API failure
 *   - `data-testid="seed-reset-submit"` — destructive submit button
 *
 * Persona gating happens server-side via `hasPermission` in
 * `apps/forge/lib/auth.ts` (Plan H commit 5). The dev cookie stub reads
 * `forge.persona` directly off the request, so we set the cookie before
 * navigating.
 */

import { expect, test } from '@playwright/test';

const PERSONA_COOKIE = 'forge.persona';
const BASE_URL = 'http://localhost:3000';

test.describe('Admin /admin/seeds reset flow', () => {
  test('Steward can reset scope=demo_only', async ({ page, context }) => {
    await context.addCookies([
      {
        name: PERSONA_COOKIE,
        value: 'steward',
        url: BASE_URL,
      },
    ]);

    await page.goto('/admin/seeds', { waitUntil: 'domcontentloaded' });

    // The page exposes data-page-title="Seed Management" and a heading.
    await expect(
      page.getByRole('heading', { name: /Seed Management/i }),
    ).toBeVisible();

    // Open the reset modal. There is only one "Reset" trigger button
    // on the page (the destructive variant).
    const trigger = page.getByTestId('seed-reset-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();

    // Dialog rendered. Default scope is demo_only — confirm and submit.
    const dialog = page.getByTestId('seed-reset-dialog');
    await expect(dialog).toBeVisible();

    // The scope selector shows the demo_only label by default; no
    // warning panel is shown yet.
    await expect(page.getByTestId('seed-reset-warning')).not.toBeVisible();

    // Submit the reset. The dialog closes on success.
    await page.getByTestId('seed-reset-submit').click();

    // Mutation + refetch can take a few seconds; allow up to 30s.
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  });

  test('Non-Steward sees warning on scope=all and gets 403 on submit', async ({ page, context }) => {
    await context.addCookies([
      {
        name: PERSONA_COOKIE,
        value: 'pm',
        url: BASE_URL,
      },
    ]);

    await page.goto('/admin/seeds', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByRole('heading', { name: /Seed Management/i }),
    ).toBeVisible();

    const trigger = page.getByTestId('seed-reset-trigger');
    await trigger.click();

    const dialog = page.getByTestId('seed-reset-dialog');
    await expect(dialog).toBeVisible();

    // Switch the scope to "all" — clicking the trigger opens the
    // SelectContent which lists both options.
    await page.getByTestId('seed-reset-scope-trigger').click();
    await page.getByRole('option', { name: /all rows including non-demo/i }).click();

    // The destructive warning is now visible.
    const warning = page.getByTestId('seed-reset-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/all/i);

    // Submit. The backend (Plan C + Plan H) rejects with 403 because
    // the persona lacks `seeds:reset:all`. The dialog surfaces the
    // error inline.
    await page.getByTestId('seed-reset-submit').click();

    // Inline error message — the dialog stays open so the operator
    // can read the rejection reason.
    const errorPanel = page.getByTestId('seed-reset-error');
    await expect(errorPanel).toBeVisible({ timeout: 10_000 });
    await expect(errorPanel).toContainText(/forbidden|error|403|permission/i);
    // Dialog must still be open.
    await expect(dialog).toBeVisible();
  });
});
