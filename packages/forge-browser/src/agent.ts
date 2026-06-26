/**
 * Browser agent — opens URLs, navigates, takes actions.
 *
 * Stub delegates to a fixed in-memory session so the UI can develop
 * against a stable contract. The real implementation will dispatch to
 * a Playwright/Puppeteer worker pool inside the backend.
 */

import type { BrowserSession, Screenshot, TenantScopedContext } from './types';

let activeSession: BrowserSession | null = null;

export async function openBrowser(
  ctx: TenantScopedContext,
  options: { width?: number; height?: number } = {},
): Promise<BrowserSession> {
  activeSession = {
    ...ctx,
    session_id: `bs_${Date.now()}`,
    started_at: new Date().toISOString(),
    viewport: {
      width: options.width ?? 1280,
      height: options.height ?? 800,
    },
    user_agent: 'forge-browser/0.1 (stub)',
  };
  return activeSession;
}

export async function captureScreenshot(
  ctx: TenantScopedContext,
  url: string,
): Promise<Screenshot> {
  if (!activeSession) {
    await openBrowser(ctx);
  }
  // Deterministic 1×1 transparent PNG data URI — enough to satisfy the
  // type contract without storing real screenshots in source.
  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  return {
    ...ctx,
    screenshot_id: `ss_${Date.now()}`,
    url,
    width: activeSession?.viewport.width ?? 1280,
    height: activeSession?.viewport.height ?? 800,
    data_uri: tinyPng,
    captured_at: new Date().toISOString(),
  };
}