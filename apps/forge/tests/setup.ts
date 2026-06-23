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

// @ts-expect-error — attach the polyfill only when missing.
if (typeof globalThis.ResizeObserver === 'undefined') {
  // @ts-expect-error — see above.
  globalThis.ResizeObserver = ResizeObserverPolyfill
}