/**
 * Shared helpers for Forge UI Playwright E2E tests.
 *
 * Provides a consistent entry point for the critical user flows exercised
 * across the suite. Tests must remain independent — never share state
 * via globals. The `setup` helper navigates to the dashboard and
 * dismisses any toast banners so each test starts from a clean canvas.
 */

import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface SetupOptions {
  /** Path to navigate to after the dashboard load. */
  startingPath?: string;
}

export interface SetupResult {
  page: Page;
}

/**
 * Navigate to the dashboard and dismiss any visible toast notifications.
 * Returns the page once the dashboard shell has rendered. Tests that
 * target a different surface can pass `startingPath`.
 */
export async function setup(
  page: Page,
  options: SetupOptions = {},
): Promise<SetupResult> {
  const target = options.startingPath ?? '/dashboard';
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await dismissToasts(page);
  return { page };
}

/**
 * Convenience wrapper around `page.goto` that always uses the configured
 * baseURL and waits for `domcontentloaded` to avoid race conditions in
 * dev-mode hydration.
 */
export async function navigateTo(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await dismissToasts(page);
}

/**
 * Wait for a toast (radix `<ol data-sonner-toaster>` region or a
 * `role="status"` element) to contain the given text. Fails the test
 * after `expect.timeout` if no matching toast is found.
 */
export async function expectToast(
  page: Page,
  text: string | RegExp,
): Promise<void> {
  const toast = page
    .locator('[data-sonner-toast], [role="status"], [role="alert"]')
    .filter({ hasText: text })
    .first();
  await expect(toast).toBeVisible({ timeout: 5_000 });
}

/**
 * Wrap `page.getByTestId` so tests can avoid the long namespace prefix
 * and so future changes to the testid strategy only touch this helper.
 */
export function getByTestId(page: Page, id: string): Locator {
  return page.getByTestId(id);
}

/**
 * Best-effort dismissal of any visible toast / notification banners.
 * Forge uses both radix toasts (on certain forms) and sonner (for
 * command runs). Either way the test should not be blocked by overlays.
 */
export async function dismissToasts(page: Page): Promise<void> {
  const closeButtons = page.locator(
    '[data-sonner-toast] button[aria-label*="lose" i], [data-sonner-toast] button[aria-label*="ismiss" i], [role="status"] button, [role="alert"] button',
  );
  const count = await closeButtons.count();
  for (let i = 0; i < count; i += 1) {
    const btn = closeButtons.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ trial: false }).catch(() => undefined);
    }
  }
}

/**
 * Determine whether the dev backend is reachable. The Forge UI tolerates
 * an unreachable orchestrator (it surfaces an "Orchestrator unreachable"
 * notice) so most flows still render. Tests that strictly require
 * backend data should call this and `test.skip()` accordingly.
 */
export async function isBackendReachable(page: Page): Promise<boolean> {
  try {
    const res = await page.request.get('/healthz');
    return res.ok();
  } catch {
    return false;
  }
}
