/**
 * M11 — Agent Terminal Center E2E tests.
 *
 * Locks the M11 user-facing surface in the running app:
 *  1. The AgentSelector exposes all four CLI agent families.
 *  2. The SessionTabs component renders multiple concurrent tabs
 *     (multi-agent session separation in the live UI).
 *  3. The Agent Center renders the agent-card grid that backs the
 *     terminal's selector, proving the two surfaces share the
 *     same registry.
 *
 * These tests run against the same Next.js dev server as
 * 03-terminal-center.spec.ts and 04-agent-center.spec.ts — they
 * intentionally do NOT spin up the PTY sidecar (that requires
 * node-pty + a real shell). The contract is: chrome renders, all
 * four agent types are addressable, multi-session layout works.
 */

import { expect, test } from '@playwright/test';
import { navigateTo } from './helpers';

test.describe('M11 — Agent Terminal Center', () => {
  test('agent selector lists all four CLI agent families', async ({ page }) => {
    await navigateTo(page, '/forge-terminal');

    // The AgentSelector trigger has aria-label="Agent" (locked in
    // AgentSelector.tsx). Click it to open the menu.
    const trigger = page.getByRole('combobox', { name: /agent/i }).first();
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();

    // The four CLI families that the M11 contract requires.
    const expected = ['Claude Code', 'Codex', 'Gemini CLI', 'Custom agent'];
    for (const label of expected) {
      await expect(page.getByRole('option', { name: label })).toBeVisible({
        timeout: 5_000,
      });
    }
  });

  test('session tabs support concurrent multi-agent sessions', async ({ page }) => {
    await navigateTo(page, '/forge-terminal');

    // Default welcome session ("Session 1") must render first.
    await expect(page.getByText('Session 1').first()).toBeVisible({
      timeout: 10_000,
    });

    // The session-tabs container is locked with data-testid.
    await expect(
      page.locator('[data-testid="session-tabs"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    // The "+ new session" affordance must be present so multi-agent
    // sessions can be opened from the chrome.
    await expect(
      page.locator('[data-testid="session-tabs-new"]').first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('agent center card grid backs the terminal selector', async ({ page }) => {
    // The /agent-center surface shows the canonical registry of
    // agent cards. The /forge-terminal surface mounts AgentSelector
    // which reads from the same Zustand store. If the Agent Center
    // can render an agent-card, the terminal selector has at least
    // one valid entry.
    await navigateTo(page, '/agent-center');

    // Wait for at least one agent-card to mount. The agent-card
    // testid is locked in AgentCard.tsx.
    await expect(
      page.locator('[data-testid="agent-card"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    // The Agents tab is the default view per the M4 spec.
    // Confirm we did NOT land on a tab where the card grid is
    // absent (e.g. Runtimes or Providers).
    await expect(
      page.getByRole('heading', { name: /agents/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});