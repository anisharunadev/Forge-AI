/**
 * Vitest setup — global polyfills for jsdom.
 *
 * `recharts` `ResponsiveContainer` (and `cmdk`) both rely on
 * `ResizeObserver` which jsdom does not provide. We install a
 * minimal no-op polyfill so those components can render without
 * throwing in the test environment.
 */

class ResizeObserverPolyfill {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver
}