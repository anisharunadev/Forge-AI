import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Accessibility test config (FORA-393-F1, FORA-393 Plan 3 §5).
 * Runs vitest-axe against the rendered primitives + a11y helpers.
 * Excluded from the default `test` script so axe runs are explicit (`test:a11y`).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    include: ["__tests__/a11y/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "playwright"],
    setupFiles: ["./__tests__/setup.ts"],
  },
});
