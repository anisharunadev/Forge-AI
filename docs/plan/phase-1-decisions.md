# Phase 1 — Decisions Log

## Decision 1: Version pin — Path A (upgrade Vite), but to `^8.0.0` not `^6.0.0`

**Date:** 2026-07-05
**Decided by:** Beast Mode 3.1 agent (phase 1 implementation)

### Why not Path B (downgrade Vitest to 3.x)

- `@vitest/coverage-v8` is already pinned to `^4.1.9` (in `apps/forge/package.json`). Downgrading would force a cascade of coverage-tool downgrades.
- Vitest 4.x is the current major version; downgrading means we re-upgrade at the next phase that needs browser mode.

### Why not Path A with Vite `^6.0.0` (the plan's "preferred" suggestion)

The plan recommended Vite `^6.0.0`, but the installed peer-dep graph makes Vite `^8.0.0` the only consistent set:

| Package | Peer dep on `vite` |
|---------|--------------------|
| `vitest@4.1.9` | `^6.0.0 || ^7.0.0 || ^8.0.0` |
| `@vitejs/plugin-react@6.0.3` | `^8.0.0` |
| `@vitejs/plugin-react@5.2.0` (alternative) | `^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0` |

`@vitejs/plugin-react@6.0.3` is already installed and pinned in `apps/forge/package.json` (`^6.0.3`). Going down to `^5.x` of the plugin is a needless regression — Vite 8 is the current stable line (released 2026; latest 8.1.3). Choosing `^8.0.0` keeps us on the bleeding edge of all three packages at once.

### Choice

- `vite`: `^5.4.21` → `^8.0.0`
- `vitest`: `^4.1.9` (unchanged — already on Vite 6+ peer range)
- `@vitejs/plugin-react`: `^6.0.3` (unchanged — already requires Vite 8)

### Blast radius

Verified zero impact outside `apps/forge`:

- `find apps packages -name "vite.config.*" 2>/dev/null | grep -v node_modules` → empty.
- No `vite.config.*` files exist in the monorepo. The only consumer of `vite` is `vitest`.
- `next.config.mjs` does not use Vite (Next.js bundles its own pipeline).
- Other workspace packages with vitest (`packages/connector-events`, `packages/mcp-router`) all use `vitest@^4.1.9` and will pick up the hoisted Vite 8 transparently.

### Lockfile

`pnpm install` will refresh `pnpm-lock.yaml`. The committed lockfile must reflect Vite 8.x for the post-install state to match SC-1.7.

---

## Decision 2: Move `tests/e2e/ideation-jira-roundtrip.test.tsx` to `tests/ideation/`

**Date:** 2026-07-05

The plan's SC-1.8 requires `pnpm test` to not run Playwright specs. Currently vitest's glob `tests/**/*.test.{ts,tsx}` is correctly scoped to `.test.tsx`, but a non-e2e vitest file accidentally lives under `tests/e2e/`:

- `apps/forge/tests/e2e/ideation-jira-roundtrip.test.tsx` — uses `@testing-library/react`, mocks `globalThis.fetch`, no Playwright imports.

It was placed in `tests/e2e/` because of its subject matter (a "round-trip" between ideation and Jira), but it is a unit/component test, not a Playwright spec. Moving it:

1. Keeps `tests/e2e/` strictly Playwright (only `.spec.ts` files), satisfying SC-1.8.
2. Aligns with the existing convention (`tests/intelligence/`, `tests/ideation/`, etc.).
3. Makes the vitest glob safe without needing `exclude: ['tests/e2e/**']` (which would also exclude legitimate unit tests in e2e-named directories in the future).

The plan suggested `exclude: ['tests/e2e/**']` as a safety net; we keep that exclude anyway because defense-in-depth is cheaper than re-debugging this later.

---

## Decision 3: Move `apps/forge/__tests__/` contents to `apps/forge/tests/`

**Date:** 2026-07-05

The CLAUDE.md contract is unambiguous: "`pnpm test` only picks up files matching `tests/**/*.test.{ts,tsx}` (see `vitest.config.ts`). Tests in `__tests__/` … are not in the glob — invoke them by file path or move them under `tests/`."

`apps/forge/__tests__/` contains 9 files:
- 4 `.test.tsx`: ideation-hooks, live-stream-pill, runs-explainability, terminal-pane-ws
- 1 `.test.ts`: ideation-adapter
- 4 `.test.mjs`: connector-center-list, injection-map-panel, knowledge-center-list, knowledge-graph

All are silent-not-run today. We move them to `tests/` and delete `__tests__/` so SC-1.3 / SC-1.4 hold and the orphan-test guard (T1.4) doesn't reject them.

The `.mjs` files use CommonJS `require('@xterm/...')` patterns; vitest can run `.mjs` natively so they will still execute under the new location.

---

## Decision 4: Coverage thresholds set to baseline floor, not aspirational

**Date:** 2026-07-05

Per plan T1.7.2: "Set the coverage threshold in `vitest.config.ts` to the current floor (e.g. `lines: 60, branches: 50, functions: 60, statements: 60`)."

`phase-1-coverage-baseline.md` captures the actual pre-fix baseline (which is 0 because `pnpm test` exits before running). Post-fix baseline is measured in T1.7.1 and recorded in the same file. The threshold is set to **at most** the measured floor so the phase ends green; future phases must keep or raise the threshold.

---

## Decision 5: Branch protection — manual UI step recorded

**Date:** 2026-07-05

GitHub branch protection on `main` requires the workflow to be present in a merged PR first (a chicken-and-egg). The exact UI click-path that a maintainer must perform before the phase is "fully closed":

1. Push the workflow to a feature branch, merge to `main`.
2. After at least one successful run: GitHub → Settings → Branches → Branch protection rules → `main` → Require status checks → search for **`apps/forge / test (pull_request)`** and **`apps/forge / test (push)`** → enable.
3. Also enable "Require branches to be up to date before merging".

Recorded here so the operator knows what remains a manual step.
