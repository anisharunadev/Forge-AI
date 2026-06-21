import { defineConfig } from '@playwright/test';

const PORT = process.env.FORA_FORGE_PORT ?? '3000';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['dot']] : 'html',
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: process.env.FORGE_NO_WEBSERVER
    ? undefined
    : {
        command: `pnpm dev`,
        url: `${BASE_URL}/healthz`,
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});