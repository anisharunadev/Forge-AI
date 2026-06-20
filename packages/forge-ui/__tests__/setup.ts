import "@testing-library/jest-dom/vitest";
import "vitest-axe/extend-expect";

/**
 * jsdom does not implement `window.matchMedia` (used by ThemeProvider to read
 * `prefers-color-scheme` and by some Radix primitives). The stub returns
 * `matches: false` and supports the add/remove listener API so React effects
 * + the matchMedia change handler can run without throwing.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/**
 * Radix Select uses ResizeObserver on its trigger. jsdom does not ship one.
 * No-op stub keeps tests focused on our renderers, not layout geometry.
 */
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}
