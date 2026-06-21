import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for FORA-393-F1 axe-core CI scan against the demo route.
 *
 * The demo route is `apps/forge/app/forge-ui-demo/page.tsx` (Next.js 15).
 * Run `pnpm --filter @fora/forge dev` in a separate process first, then:
 *   pnpm --filter @fora/forge-ui lint:a11y
 *
 * Per customer/standards.md §7: every PR that touches a customer-facing
 * surface must pass an axe-core check. This config ships the gate.
 */
export default defineConfig({
  testDir: "./playwright",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.FORGE_UI_DEMO_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
