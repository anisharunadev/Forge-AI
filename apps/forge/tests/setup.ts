/**
 * Vitest setup — global polyfills for jsdom + jest-dom matchers.
 *
 * `recharts` `ResponsiveContainer` (and `cmdk`) both rely on
 * `ResizeObserver` which jsdom does not provide. We install a
 * minimal no-op polyfill so those components can render without
 * throwing in the test environment.
 *
 * `@testing-library/jest-dom` registers the custom matchers
 * (`toBeInTheDocument`, `toHaveAttribute`, etc.) on vitest's
 * expect so the DOM assertions type-check and run.
 */
import '@testing-library/jest-dom/vitest';

class ResizeObserverPolyfill {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver
}