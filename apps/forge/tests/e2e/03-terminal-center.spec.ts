/**
 * Forge Terminal Center E2E tests.
 *
 * The Terminal Center renders a multi-pane terminal UI driven by the
 * local zustand store (no backend needed for layout assertions). The
 * actual xterm.js component is loaded via `next/dynamic` with
 * `ssr: false`, so we wait for the chrome (selectors, panels, status
 * bar) to appear rather than the terminal canvas itself.
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

test.describe('Forge Terminal Center', () => {
  test('terminal center loads', async ({ page }) => {
    await navigateTo(page, '/forge-terminal');
    await expect(
      page.getByRole('heading', { name: /Live terminal sessions/i }),
    ).toBeVisible();
  });

  test('terminal center shows default welcome session', async ({ page }) => {
    await navigateTo(page, '/forge-terminal');
    // The page auto-creates "Session 1" — its tab should be present.
    await expect(page.getByText('Session 1').first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('terminal center agent selector shows agents', async ({ page }) => {
    await navigateTo(page, '/forge-terminal');
    const agentSelector = page.locator('[data-testid="agent-selector"]').first();
    if (await agentSelector.isVisible().catch(() => false)) {
      await agentSelector.click();
      await expect(
        page.getByRole('option').first(),
      ).toBeVisible({ timeout: 5_000 });
    } else {
      // Fallback: assert the AgentSelector trigger is on screen via its
      // accessible name.
      await expect(
        page.getByRole('combobox', { name: /agent/i }).first(),
      ).toBeVisible();
    }
  });

  test('terminal center workspace selector', async ({ page }) => {
    await navigateTo(page, '/forge-terminal');
    const ws = page.locator('[data-testid="workspace-selector"]').first();
    if (await ws.isVisible().catch(() => false)) {
      await expect(ws).toBeVisible();
    } else {
      // Accept either a combobox or a button labelled "workspace".
      await expect(
        page.getByRole('combobox', { name: /workspace/i }).first(),
      ).toBeVisible();
    }
  });

  test('terminal center layout switcher is visible', async ({ page }) => {
    await navigateTo(page, '/forge-terminal');
    // The terminal layout can switch between split/grid via Toolbar
    // buttons. Assert the chrome is rendered (tabs row, status bar).
    await expect(page.locator('[data-testid="terminal-tabs"]').first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('terminal center audit panel is visible', async ({ page }) => {
    await navigateTo(page, '/forge-terminal');
    const audit = page.locator('[data-testid="audit-panel"]').first();
    await expect(audit).toBeVisible();
  });

  test('terminal center status bar is visible', async ({ page }) => {
    await navigateTo(page, '/forge-terminal');
    const status = page.locator('[data-testid="status-bar"]').first();
    await expect(status).toBeVisible();
  });
});
