import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vitest configuration for apps/forge (Phase 1).
//
// Contract (mirrors apps/forge/CLAUDE.md):
//   - pnpm test discovers tests/**/*.test.{ts,tsx} ONLY.
//   - Tests outside tests/ (e.g. lib/__tests__/foo.test.ts) are silently
//     skipped, then caught by scripts/check-test-location.sh in CI.
//   - Playwright E2E specs (.spec.ts) live under tests/e2e/ and are
//     excluded from this config; they run under pnpm test:e2e.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      // Defense in depth: tests/e2e/ is strictly Playwright. Any future
      // vitest file accidentally placed there would not run under
      // pnpm test (it would fail loud, not silent).
      'tests/e2e/**',
      'tests/**/*.d.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/*.test.{ts,tsx}', 'tests/**'],
      // Thresholds captured in docs/plan/phase-1-coverage-baseline.md.
      // Edit both together.
      thresholds: {
        lines: 0,
        statements: 0,
        functions: 0,
        branches: 0,
      },
    },
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
