import { defineConfig } from 'vitest/config';

// Integration suite — guarded by FORA_DB_INTEGRATION=1 + FORA_DATABASE_URL.
// Skipped silently on local dev so contributors do not need a Postgres instance.
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
