/**
 * Ambient type augmentation for the Vitest matchers used in this package.
 *
 * Vitest's `setupFiles` runs at test time only; `tsc --noEmit` does not execute
 * setup files, so the runtime matcher augmentations from `vitest-axe/matchers`
 * and `@testing-library/jest-dom` must be re-imported here as side-effect
 * type imports so the compiler sees them during typecheck.
 */
import "@testing-library/jest-dom";
import "vitest-axe/extend-expect";
import "vitest-axe/matchers";
