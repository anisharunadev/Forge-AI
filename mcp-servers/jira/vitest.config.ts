import { defineConfig } from 'vitest/config';

/**
 * `forge-ai/mcp-jira` test runner.
 *
 * Only `router-smoke.test.ts` lives here for now (FORA-48 AC #4); the
 * stdio child-process smoke flow is in `test/smoke.mjs` and runs via
 * `pnpm smoke`. The router smoke runs the same logic through
 * `InMemoryMcpRouter.invoke` without spawning a child process.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
