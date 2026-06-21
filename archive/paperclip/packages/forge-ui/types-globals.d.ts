/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />

/**
 * Local mirror of `vitest-axe/extend-expect`'s type augmentation.
 *
 * `vitest-axe` 0.1.0 ships its `.d.ts` at the package root but does not
 * declare a `types` / `exports` entry, so tsc only sees the augmentation via
 * the side-effect import in `__tests__/setup.ts` — a vitest-only setup file,
 * not a tsc-included source file. We re-declare the augmentation in a file
 * tsc compiles so `expect(...).toHaveNoViolations()` type-checks without
 * `@ts-expect-error` shims at every call site.
 *
 * Runtime registration remains in `__tests__/setup.ts`.
 */
import type AxeCore from "axe-core";

interface NoViolationsMatcherResult {
  pass: boolean;
  message: () => string;
  actual: AxeCore.Result[];
}

interface AxeMatchers {
  toHaveNoViolations(): NoViolationsMatcherResult;
}

declare global {
  namespace Vi {
    interface Assertion<T = unknown> extends AxeMatchers {}
    interface AsymmetricMatchersContaining extends AxeMatchers {}
  }
}

export {};
