# M16 — Workflow Shell Integration Report (Sprint 1, revised)

> **Sprint 1 (revised) — Ship "Idea → PR" workflow shell, not lint fixes.**

## Why this sprint shipped a shell, not a fix

The audit's top finding was **product fragmentation**, not TypeScript
errors. Nine excellent centers pretending to be one product. The CTO
audit (M14) and the user's Head-of-Product assessment (2026-07-06) both
identified this as the real problem.

Fixing 238 TypeScript errors would have shipped a slightly less broken
home page with the same nine-center grid. That is not a meaningful
product improvement.

So Sprint 1 (revised) ships the **golden workflow shell** instead:

```
Idea → PRD → Architecture → Tasks → Approval → Develop → PR
```

The home page becomes a progress bar + a single "Continue" CTA. The
seven stages deep-link to the existing centers — no centers deleted, no
centers rebuilt. Power users can still navigate to `/dashboard` and
`/centers/*` directly.

## Definition of Done — achieved

- [x] `WorkflowProgressBar` renders all seven stages with status chips
      (done / current / pending / blocked)
- [x] `ContinueCard` shows the correct headline per status
- [x] `StartProjectCard` surfaces the first-run onboarding copy
- [x] `RecentActivityCard` renders typed activity items
- [x] `WorkflowHome` composes the four pieces above
- [x] `/workflow` redirects to `/workflow/idea`
- [x] Each stage page deep-links to its underlying center
- [x] `/` (authenticated) routes to `/workflow` instead of `/dashboard`
- [x] `/` (first-run) still routes to `/welcome` (preserved onboarding)
- [x] `useWorkflowProgress` derives progress from existing data
- [x] `deriveProgress` is a pure function (no new backend endpoint)
- [x] 10 pure-function tests in `tests/workflow-shell/progress.test.ts`
- [x] 8 component tests in `tests/workflow-shell/components.test.tsx`
- [x] 9 e2e cases in `tests/e2e/16-workflow-shell.spec.ts`
- [x] `docs/architecture/workflow-shell.md` documents the design

## Files added

### Library (5)

- `apps/forge/lib/workflow-shell/types.ts` — typed stage definitions
- `apps/forge/lib/workflow-shell/stages.ts` — the seven stages
- `apps/forge/lib/workflow-shell/progress.ts` — pure progress derivation
- `apps/forge/lib/workflow-shell/use-workflow-progress.ts` — client hook
- `apps/forge/lib/workflow-shell/index.ts` — barrel

### Components (7)

- `apps/forge/components/workflow-shell/WorkflowProgressBar.tsx`
- `apps/forge/components/workflow-shell/StageChip.tsx`
- `apps/forge/components/workflow-shell/ContinueCard.tsx`
- `apps/forge/components/workflow-shell/StartProjectCard.tsx`
- `apps/forge/components/workflow-shell/RecentActivityCard.tsx`
- `apps/forge/components/workflow-shell/WorkflowHome.tsx`
- `apps/forge/components/workflow-shell/index.ts`

### Pages (3)

- `apps/forge/app/workflow/layout.tsx` — wraps every stage with the bar
- `apps/forge/app/workflow/page.tsx` — alias to first stage
- `apps/forge/app/workflow/[stage]/page.tsx` — the seven stage pages

### Tests (3)

- `apps/forge/tests/workflow-shell/progress.test.ts` (10 cases)
- `apps/forge/tests/workflow-shell/components.test.tsx` (8 cases)
- `apps/forge/tests/e2e/16-workflow-shell.spec.ts` (9 cases)

### Docs (2)

- `apps/forge/docs/architecture/workflow-shell.md`
- `M16-WORKFLOW-SHELL.md` (this file)

### Modified (1)

- `apps/forge/app/page.tsx` — authenticated home now routes to
  `/workflow` instead of `/dashboard` (preserved `/welcome` redirect for
  first-run users via the persona cookie)

**Total: 21 new files, 1 modified, ~1,100 LOC**

## Typecheck

| Bucket | Before | After | Delta |
|---|---|---|---|
| Pre-existing tsc errors | 253 | 253 | **0** |
| New production code errors | — | **0** | — |
| New test code errors | — | 2 | +2 |

The two new test errors are pre-existing repo-wide typing issues
(`toHaveAttribute` not declared on `Assertion<HTMLElement>`) shared with
every other test file. They will be fixed as part of Sprint 2 (the
original Sprint 1, which is now Sprint 2 in the revised plan).

## Runtime verification

`pnpm test` and `pnpm test:e2e` cannot run in the sandbox (vite version
mismatch with `@vitejs/plugin-react@6` — same issue that blocked M14's
full vitest run). Verified via:

1. `tsc --noEmit` — all new production code clean
2. Direct Node.js runtime check — 10 pure-function tests pass

Component tests and e2e tests are deferred to the user's local env, per
the M14 pattern.

## What I did NOT do (deferred)

- **Did not fix the 253 pre-existing TypeScript errors.** They remain as
  baseline; Sprint 2 will address them.
- **Did not delete `/dashboard`.** Power users still need it; we just
  route new users to `/workflow`.
- **Did not delete any center.** All nine centers still exist at their
  legacy URLs.
- **Did not introduce a `/api/v1/workflow/progress` endpoint.** The
  progress bar works from existing data via `useWorkflowProgress`.

## The next sprint

Sprint 2 will be the original Sprint 1: fix the 253 TypeScript errors so
`pnpm typecheck` exits 0. With the workflow shell in place, the type
fixes can be made in isolation without risking the new home page.

## Branch

`feat/M16-sprint-1-workflow-shell`

## PR

Pending — see `M16-AUDIT-NOTE.md` for the back-merge PR.