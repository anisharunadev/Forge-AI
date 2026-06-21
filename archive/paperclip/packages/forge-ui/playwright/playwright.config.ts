import { defineConfig, devices } from "@playwright/test";

/**
 * FORA Forge UI Playwright config — axe-core in CI on the demo route.
 * The demo route lives in apps/forge/app/_demo for v1.0 (deferred to the
 * FORA-374 console integration child). Until then, this config is the
 * documented CI entry point that consumers wire into apps/forge.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env["FORA_FORGE_URL"] ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env["FORA_FORGE_URL"]
    ? undefined
    : {
        command: "pnpm --filter @fora/forge dev",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env["CI"],
        timeout: 120_000,
      },
});