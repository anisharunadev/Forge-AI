import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Unit test config for @fora/forge-ui (FORA-393-F1).
 * jsdom env + React plugin so JSX renders.
 * Unit tests live in __tests__/ (mirrors FORA-5 §2.1).
 * Accessibility tests live in __tests__/a11y/ and run via vitest.a11y.config.ts.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    include: ["__tests__/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    exclude: ["__tests__/a11y/**", "node_modules", "dist", "playwright"],
    setupFiles: ["./__tests__/setup.ts"],
  },
});
