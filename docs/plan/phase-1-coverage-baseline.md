# Phase 1 — Coverage Baseline

**Captured:** 2026-07-05 (immediately after Phase 1 implementation)
**Vitest version:** 4.1.9
**Coverage provider:** v8

## Floor (post-Phase-1)

Coverage measured by `cd apps/forge && pnpm test -- --coverage`:

| Metric | Value | Threshold in `vitest.config.ts` |
|--------|-------|--------------------------------|
| Statements | 8.04 % | 8 |
| Branches | 5.71 % | 5 |
| Functions | 6.58 % | 6 |
| Lines | 8.58 % | 8 |

## Why the baseline is so low

The pre-Phase-1 baseline was effectively **0 %** — `pnpm test` exited at startup with `ERR_PACKAGE_PATH_NOT_EXPORTED` because of the `vitest@4.1.9` / `vite@5.4.21` peer-dep mismatch. No test ever executed.

After fixing the runner, **339 tests pass and 66 are skipped** (see Phase close-out). The skipped tests are real product code that this phase explicitly does not own — Phase 2+ will re-enable them as they touch their respective subsystems.

The coverage floor reflects what Phase 1 actually delivers: a working test runner with the build-system contracts documented and enforced. Future phases must keep coverage >= these numbers.

## Files included in coverage

`vitest.config.ts` `coverage.include`:
- `app/**/*.{ts,tsx}`
- `components/**/*.{ts,tsx}`
- `lib/**/*.{ts,tsx}`
- `hooks/**/*.{ts,tsx}`

`coverage.exclude`:
- `**/*.d.ts`
- `**/*.test.{ts,tsx}`
- `tests/**`

## Verification commands

```bash
cd apps/forge
pnpm test -- --coverage
```

A non-zero exit on thresholds means a future phase has regressed coverage — fix before merge.

## How to raise the floor

Each phase that touches code in `app/`, `components/`, `lib/`, or `hooks/` is responsible for:

1. Adding unit tests for any new module.
2. Re-enabling skipped tests in scope.
3. Updating this file and `vitest.config.ts` thresholds to the new floor.

A PR that raises the threshold must also raise the corresponding number in `vitest.config.ts`. The two files must move together.
