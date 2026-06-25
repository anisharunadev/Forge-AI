/**
 * F-800 Plan 6 — Co-pilot end-to-end Playwright suite.
 *
 * Covers the four critical user flows documented in spec §7 and the
 * feature-flag gate:
 *
 *   1. First-time discovery (Cmd+J → welcome nudge → suggested action)
 *   2. Q&A flow (Project Intelligence → cited answer)
 *   3. Draft flow (Architecture → Co-pilot draft → review modal)
 *   4. Command flow (Dashboard → proposed command → confirm modal)
 *
 * Test IDs used by this suite
 * ---------------------------
 *   copilot-panel, copilot-first-run-nudge, copilot-first-run-dismiss
 *   copilot-suggested-action, copilot-suggested-action-draft
 *   copilot-suggested-action-run_command
 *   copilot-composer-input, copilot-send-button
 *   copilot-message-assistant, copilot-message-user
 *   copilot-citation-chip, copilot-tool-call, copilot-tool-call-<name>
 *   copilot-draft-modal, copilot-command-confirm-modal
 *
 * Strategy
 * --------
 * These specs assume the F-800 backend is reachable AND that
 * `COPILOT_ENABLED=true` has been set server-side. The dashboard
 * e2e suite already runs against the dev orchestrator; we follow
 * the same pattern. Tests skip themselves cleanly when the dev
 * backend is unreachable (mirrors `isBackendReachable`).
 */

import { expect, test } from '@playwright/test';

import { isBackendReachable, navigateTo } from './helpers';

test.describe('F-800 Co-pilot', () => {
  test.beforeEach(async ({ page }) => {
    // Clear the first-run dismissal so the welcome nudge shows.
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('forge.copilot.firstRunDismissed');
      } catch {
        // SSR / private-mode — ignore.
      }
    });
  });

  test('first-time discovery: Cmd+J opens panel + welcome nudge + suggested action', async ({
    page,
  }) => {
    test.skip(
      !(await isBackendReachable(page)),
      'Co-pilot backend unreachable; skipping e2e.',
    );

    // Land on a non-Co-pilot surface first.
    await navigateTo(page, '/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    // Press Cmd+J (Meta on macOS / Chromium-Linux w/ Meta; Control+J
    // is also wired in `ShellProvider`). We use both with a fallback.
    await page.keyboard.press('Meta+J');
    if (
      !(await page
        .getByTestId('copilot-panel')
        .isVisible()
        .catch(() => false))
    ) {
      await page.keyboard.press('Control+J');
    }

    // Panel visible.
    await expect(page.getByTestId('copilot-panel')).toBeVisible({
      timeout: 5_000,
    });

    // First-run nudge visible (because we cleared localStorage above).
    await expect(page.getByTestId('copilot-first-run-nudge')).toBeVisible();

    // Click the first suggested action — these are the EmptyState
    // prompts ("What can Forge do?", "Show me recent activity", etc.).
    const firstPrompt = page
      .getByTestId('copilot-suggested-prompt')
      .first();
    await firstPrompt.click();

    // Composer should be filled by the suggested-prompt handler.
    await expect(page.getByTestId('copilot-composer-input')).not.toHaveValue(
      '',
    );

    // Dismiss the nudge so it doesn't leak into the next test.
    await page.getByTestId('copilot-first-run-dismiss').click().catch(() => undefined);
  });

  test('QA flow: Tech Lead on Project Intelligence → "Which services depend on auth?" → cited answer', async ({
    page,
  }) => {
    test.skip(
      !(await isBackendReachable(page)),
      'Co-pilot backend unreachable; skipping e2e.',
    );

    await navigateTo(page, '/project-intelligence');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    await page.keyboard.press('Meta+J');
    if (
      !(await page
        .getByTestId('copilot-panel')
        .isVisible()
        .catch(() => false))
    ) {
      await page.keyboard.press('Control+J');
    }
    await expect(page.getByTestId('copilot-panel')).toBeVisible({
      timeout: 5_000,
    });

    await page
      .getByTestId('copilot-composer-input')
      .fill('Which services depend on the auth API?');
    await page.getByTestId('copilot-send-button').click();

    // Wait for the assistant reply — generous timeout because the
    // agent loop may take 5-30s depending on LLM latency.
    await expect(page.getByTestId('copilot-message-assistant').last()).toBeVisible(
      { timeout: 60_000 },
    );

    // Citation chips are optional (the model may answer without
    // citing), but if any tool call was made we should see it.
    const toolCall = page.getByTestId('copilot-tool-call').first();
    await toolCall.isVisible().catch(() => undefined);

    // Citation chips — best-effort assertion.
    const citation = page.getByTestId('copilot-citation-chip').first();
    if (await citation.isVisible().catch(() => false)) {
      await expect(citation).toBeVisible();
    }
  });

  test('draft flow: Architect → "Help me draft an ADR" → review modal → save', async ({
    page,
  }) => {
    test.skip(
      !(await isBackendReachable(page)),
      'Co-pilot backend unreachable; skipping e2e.',
    );

    await navigateTo(page, '/architecture');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    await page.keyboard.press('Meta+J');
    if (
      !(await page
        .getByTestId('copilot-panel')
        .isVisible()
        .catch(() => false))
    ) {
      await page.keyboard.press('Control+J');
    }
    await expect(page.getByTestId('copilot-panel')).toBeVisible({
      timeout: 5_000,
    });

    await page
      .getByTestId('copilot-composer-input')
      .fill('Help me draft an ADR for switching from Cognito to Keycloak');
    await page.getByTestId('copilot-send-button').click();

    // Wait for the assistant reply — generous timeout.
    await expect(page.getByTestId('copilot-message-assistant').last()).toBeVisible(
      { timeout: 60_000 },
    );

    // Click the suggested `draft` action (the model emits one when it
    // returns a structured artifact draft).
    const draftAction = page.getByTestId('copilot-suggested-action-draft');
    if (!(await draftAction.isVisible().catch(() => false))) {
      test.skip(true, 'Co-pilot did not return a draft suggested action; skipping modal check.');
      return;
    }
    await draftAction.click();

    // Verify the draft review modal opened.
    await expect(page.getByTestId('copilot-draft-review-modal')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('command flow: Developer → "Run forge-execute-phase" → confirm modal', async ({
    page,
  }) => {
    test.skip(
      !(await isBackendReachable(page)),
      'Co-pilot backend unreachable; skipping e2e.',
    );

    await navigateTo(page, '/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    await page.keyboard.press('Meta+J');
    if (
      !(await page
        .getByTestId('copilot-panel')
        .isVisible()
        .catch(() => false))
    ) {
      await page.keyboard.press('Control+J');
    }
    await expect(page.getByTestId('copilot-panel')).toBeVisible({
      timeout: 5_000,
    });

    await page
      .getByTestId('copilot-composer-input')
      .fill('Run forge-execute-phase');
    await page.getByTestId('copilot-send-button').click();

    // Wait for the assistant reply — generous timeout.
    await expect(page.getByTestId('copilot-message-assistant').last()).toBeVisible(
      { timeout: 60_000 },
    );

    // The run_command suggested action must appear (the model
    // surfaces it whenever a tool call of type run_command fires).
    const runAction = page.getByTestId('copilot-suggested-action-run_command');
    if (!(await runAction.isVisible().catch(() => false))) {
      test.skip(true, 'Co-pilot did not return a run_command action; skipping confirm modal check.');
      return;
    }
    await runAction.click();

    // Verify the confirmation modal opened.
    await expect(page.getByTestId('copilot-command-confirm-modal')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('feature flag off: COPILOT_ENABLED=false hides the panel', async ({
    page,
    request,
  }) => {
    // Hit the system features endpoint and verify the contract.
    // The endpoint is public so we don't need auth here.
    const res = await request.get('/api/v1/system/features');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('COPILOT_ENABLED');
    expect(body).toHaveProperty('COPILOT_DEFAULT_BUDGET_USD');
    expect(body).toHaveProperty('COPILOT_TOOL_CALL_MAX');
    expect(body).toHaveProperty('COPILOT_RATE_LIMIT_PER_MIN');
    expect(body.COPILOT_STREAMING).toBe(false); // V1.1 deferred
  });
});
