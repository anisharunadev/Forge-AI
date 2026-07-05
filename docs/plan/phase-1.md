# Phase 1 — Test Infrastructure Foundation

**Status:** PENDING
**Owner:** TBA
**Depends on:** nothing
**Blocks:** every subsequent phase (without working tests, no merge is safe)

---

## 1. Goal

Make `pnpm test` exit 0 from a clean checkout. One glob. One runner. CI enforces it. Every `.test.ts(x)` file in `apps/forge/` is auto-discovered, and no test can be added outside the glob.

**Without this phase green, no other phase can be safely merged.**

---

## 2. Why this is Phase 1

- Every other change in the 10/10 roadmap needs verifiable behavior. Tests are the verification.
- Current state (verified): `vitest 4.1.9` paired with `vite 5.4.21` — incompatible. `pnpm vitest` errors at startup with `ERR_PACKAGE_PATH_NOT_EXPORTED` on `vite/module-runner`.
- Tests live in two directories (`apps/forge/__tests__/` and `apps/forge/tests/`). Only `tests/` is in the vitest glob — meaning every test in `__tests__/` is silently never run.
- Coverage is not generated or stored.
- There is no CI gate that fails a PR on broken tests (because no one can run them anyway).

Fixing this is the smallest possible change that unblocks all other phases.

---

## 3. Success Criteria (verifiable, no judgment required)

| ID | Criterion | Verification command |
|----|-----------|----------------------|
| SC-1.1 | `pnpm test` exits 0 from clean checkout | `cd apps/forge && pnpm test` |
| SC-1.2 | `pnpm test --coverage` produces a coverage report (≥ 70% lines on touched files) | `cd apps/forge && pnpm test --coverage` |
| SC-1.3 | Zero `.test.ts(x)` files exist outside `apps/forge/tests/` (excluding `tests/e2e/`) | `find apps/forge -name '*.test.*' -not -path 'apps/forge/tests/*' -not -path 'apps/forge/node_modules/*'` returns empty |
| SC-1.4 | `__tests__/` directory no longer exists anywhere in `apps/forge/` | `find apps/forge -type d -name __tests__` returns empty |
| SC-1.5 | `scripts/check-test-location.sh` exits 0 on clean repo, exits 1 when a `.test.ts(x)` is added outside `tests/` | manually verified + CI runs it |
| SC-1.6 | A PR that breaks `pnpm test` cannot be merged (CI required check) | GitHub branch protection rule + workflow file present |
| SC-1.7 | Vitest and Vite versions are pinned to a compatible pair, no peer-dep warnings on install | `pnpm install` clean output |
| SC-1.8 | Playwright E2E tests do NOT run under `pnpm test` (only under `pnpm test:e2e`) | `pnpm test` output contains zero Playwright specs |

---

## 4. Root Cause Analysis (RCA)

**RCA-1: Version mismatch.**
- `apps/forge/package.json` pins `vitest: ^4.1.9` and `vite: ^5.4.21`.
- Vitest 4 requires Vite 6+. Vite 5 lacks the `vite/module-runner` subpath export vitest 4 imports.
- Fix paths:
  - **A.** Upgrade `vite` to `^6.x` (preferred — Vite 6 is the long-term line).
  - **B.** Downgrade `vitest` to `^3.x`.
- Decision criterion: choose the option with the smaller blast radius. Verify by listing how many `vite.config.*` files exist in the monorepo (`packages/*`, root) — fewer touched = smaller blast.

**RCA-2: Split test directories.**
- `apps/forge/vitest.config.ts` includes `['__tests__/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}']`.
- Confirmed: `apps/forge/CLAUDE.md` states the glob is `tests/**/*.{test,spec}.{ts,tsx}` only. So the actual config is wrong relative to the documented contract.
- Fix: align config with the documented glob. Move all `__tests__/` content to `tests/`.

**RCA-3: No CI gate.**
- `.github/workflows/` content not yet audited in this phase, but no test step can be present if the runner is broken.
- Fix: add `.github/workflows/test.yml` that runs `pnpm test` and is set as required check on `main`.

**RCA-4: No orphan test guard.**
- Nothing prevents a developer from creating `apps/forge/lib/foo/__tests__/bar.test.ts` and assuming it runs.
- Fix: shell script checked into `scripts/check-test-location.sh`, called from CI.

---

## 5. Tasks (atomic, each verifiable in <5 minutes)

### T1.1 — Diagnose version mismatch precisely

- **T1.1.1** Capture the exact current error: run `cd apps/forge && pnpm test 2>&1 | tee /tmp/vitest-error.txt`.
- **T1.1.2** List vite/vitest versions across the monorepo: `grep -rn '"vite"' apps/*/package.json packages/*/package.json package.json 2>/dev/null`.
- **T1.1.3** Choose fix path (A: upgrade vite, or B: downgrade vitest). Record in `docs/plan/phase-1-decisions.md`.
- **T1.1.4** Verify chosen path locally: apply version change, run `pnpm install`, run `pnpm test`, confirm exit 0.
- **Verify:** `pnpm test` exits 0 on a single sample test.

### T1.2 — Pin compatible versions

- **T1.2.1** Update `apps/forge/package.json` to the chosen vite/vitest pair.
- **T1.2.2** If fix path A: audit and update any `vite.config.*` files in `packages/*` and root that need changes for Vite 6.
- **T1.2.3** Run `pnpm install` and confirm zero peer-dep warnings.
- **T1.2.4** Commit updated `pnpm-lock.yaml`.
- **Verify:** `pnpm install` clean; lockfile changes committed; sample test passes.

### T1.3 — Consolidate test directories

- **T1.3.1** List every test file in both directories: `find apps/forge/__tests__ apps/forge/tests -name '*.test.*' -o -name '*.spec.*' > /tmp/all-tests.txt`.
- **T1.3.2** Move each file from `__tests__/` to `tests/` preserving relative path. Use `git mv` (preserves history).
- **T1.3.3** For each move, search for any import path that references the old location: `grep -rn "from ['\"].*__tests__" apps/forge/src apps/forge/lib apps/forge/components apps/forge/app apps/forge/hooks 2>/dev/null` — fix any hits.
- **T1.3.4** Delete empty `apps/forge/__tests__/` directories after moves.
- **T1.3.5** Update `apps/forge/vitest.config.ts` glob to `['tests/**/*.{test,spec}.{ts,tsx}']` only.
- **Verify:** `find apps/forge -name '__tests__' -type d` returns empty; `pnpm test` discovers and runs the moved tests.

### T1.4 — Orphan test guard

- **T1.4.1** Create `scripts/check-test-location.sh` (executable):
  ```bash
  #!/usr/bin/env bash
  # Fail if any *.test.* or *.spec.* exists outside apps/forge/tests/
  set -euo pipefail
  hits=$(find apps/forge -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) \
    -not -path 'apps/forge/tests/*' \
    -not -path 'apps/forge/node_modules/*' \
    -not -path 'apps/forge/.next/*')
  if [ -n "$hits" ]; then
    echo "❌ Tests found outside apps/forge/tests/:"
    echo "$hits"
    exit 1
  fi
  echo "✅ All tests live under apps/forge/tests/"
  ```
- **T1.4.2** Make executable: `chmod +x scripts/check-test-location.sh`.
- **T1.4.3** Wire into CI workflow (T1.5).
- **Verify:** script exits 1 when a `.test.tsx` is placed at `apps/forge/lib/foo.test.tsx`; exits 0 when moved to `apps/forge/tests/lib/foo.test.tsx`.

### T1.5 — CI workflow

- **T1.5.1** Create `.github/workflows/test.yml`:
  - trigger on `pull_request` and `push` to `main`
  - job: install pnpm, `pnpm install`, `pnpm test --coverage`, `bash scripts/check-test-location.sh`
  - upload coverage as artifact
- **T1.5.2** Add the workflow as a **required status check** on the `main` branch via GitHub branch protection (document the manual step in `docs/plan/phase-1-decisions.md` since this is a UI action).
- **T1.5.3** Confirm a test PR with a failing test fails CI.
- **Verify:** workflow runs on a draft PR; required check blocks merge when red.

### T1.6 — Separate E2E from unit

- **T1.6.1** Confirm Playwright tests live under `apps/forge/tests/e2e/` (or move them there).
- **T1.6.2** Add `tests/e2e/**` to vitest `exclude`.
- **T1.6.3** Confirm `pnpm test` does not run Playwright; `pnpm test:e2e` does.
- **Verify:** `pnpm test` output shows zero playwright specs; `pnpm test:e2e --list` shows them.

### T1.7 — Coverage baseline

- **T1.7.1** Run `pnpm test --coverage` and capture the line/branch coverage numbers in `docs/plan/phase-1-coverage-baseline.md`.
- **T1.7.2** Set the coverage threshold in `vitest.config.ts` to the current floor (e.g. `lines: 60, branches: 50, functions: 60, statements: 60`).
- **T1.7.3** Future phases that touch code must keep coverage ≥ baseline. CI fails otherwise.
- **Verify:** threshold set; CI enforces.

---

## 6. Files Touched (full inventory)

| File | Action | Notes |
|------|--------|-------|
| `apps/forge/package.json` | edit | vite/vitest pin |
| `apps/forge/vitest.config.ts` | edit | glob → tests only; add coverage thresholds; exclude e2e |
| `apps/forge/__tests__/**` | delete | after move |
| `apps/forge/tests/**` | add | receiving destination |
| `apps/forge/{src,lib,components,app,hooks}/**` | edit | only if import paths broke (T1.3.3) |
| `packages/*/vite.config.*` | edit only if path A chosen | Vite 6 migration |
| `package.json` (root) | edit | if vite version bump affects workspace root |
| `scripts/check-test-location.sh` | create | new |
| `.github/workflows/test.yml` | create | new |
| `docs/plan/phase-1-decisions.md` | create | records version choice + branch-protection manual step |
| `docs/plan/phase-1-coverage-baseline.md` | create | records pre/post numbers |
| `apps/forge/CLAUDE.md` | edit | update the test-location note if it mentions `__tests__/` |

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Vite 6 migration breaks other packages | M | M | Fix path A first runs `pnpm build` in every package; revert to path B if cascade fails |
| Move of `__tests__/` breaks import paths | H | L | T1.3.3 grep catches it; if missed, `pnpm test` fails immediately |
| Coverage threshold set too high | M | L | T1.7.1 captures baseline first; threshold = current floor, not aspirational |
| Branch-protection manual step forgotten | M | M | T1.5.2 records the exact GitHub UI click path in `phase-1-decisions.md` |
| Tests rely on `time.sleep` and timeout under new runner | M | M | Replace with `vi.useFakeTimers()` or event-driven waits (concurrent fix; do not block phase) |
| Developer adds `.test.ts` outside glob, CI catches, but no clear error message | L | L | T1.4 script outputs the offending path so the dev fixes in one step |

---

## 8. Out of Scope (deferred to later phases)

- Adding new tests for untested code (Phase 2+ will add coverage where routers are touched).
- Backend pytest infrastructure (covered in a separate sub-plan if needed; this phase is `apps/forge` only).
- Performance benchmarks.
- Snapshot testing setup.
- Visual regression.

---

## 9. Definition of Done

This phase is **DONE** when, in order:

1. ✅ `pnpm test` exits 0 from a clean clone on a developer laptop.
2. ✅ `pnpm install` produces zero peer-dep warnings.
3. ✅ All SC-1.* criteria pass.
4. ✅ CI workflow exists, is green on this PR, and is added as required check on `main`.
5. ✅ `find apps/forge -type d -name __tests__` returns empty.
6. ✅ `phase-1-decisions.md` and `phase-1-coverage-baseline.md` are committed.
7. ✅ Phase close-out section (below) is filled in at the end of the phase.

---

## 10. Phase Close-out (filled at the end)

```
Implementation date: ___
PR(s): ___
Version choice (A/B): ___
Coverage before: ___% → after: ___%
Tests before: ___ → after: ___
CI workflow URL: ___
Branch protection: confirmed by: ___ on ___
Follow-up tickets opened: ___
```