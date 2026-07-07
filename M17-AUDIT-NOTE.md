# M17 — Audit Note (back-merge traceability)

> This document is the audit-trail companion to the direct-to-main
> merge of `feat/M16-sprint-1-workflow-shell` for Sprint 3 (Direction
> B — production-grade the seven workflow stages). GitHub does not
> allow 0-commit back-merge PRs, so this file exists to give the
> back-merge PR one substantive addition.

## Merge that this PR back-merges

- **Source branch:** `feat/M16-sprint-1-workflow-shell`
- **Merged into:** `main` at commit `9932ce0f`
- **Squash commit:** `859c35ef` (feat(workflow-shell): M17 — production-grade each stage with state surface)
- **PR title (back-merge):** M17 audit note — production-graded stages back-merge traceability

## Sprint 3 (Direction B) summary

Per the CTO audit + Head of Product assessment, the workflow shell
needed to meet the production checklist on every stage. Sprint 3 ships:

- A typed five-state data-source machine (`live / cached / demo /
  error / loading`) replacing ad-hoc banners.
- A typed INTERNAL_ERROR envelope renderer that mirrors the backend's
  `Phase4Error.to_envelope()` exactly — pilot users always see what
  failed, when, and why.
- An `InternalErrorBoundary` that catches uncaught render-time errors
  and renders the typed envelope.
- A `StagePanel` wrapper composing banner + boundary + skeleton +
  empty + content, used by every `/workflow/[stage]` page.
- `useStageData` composes existing center hooks into a per-stage
  discriminated payload.
- `useStageSideEffects` wires audit + analytics + RBAC; all three are
  best-effort and never crash the page render.

## Files changed in the squash commit

18 files changed, 1570 insertions(+), 65 deletions(-)

```
M17-PRODUCTION-GRADED-STAGES.md                                  (integration report)
apps/forge/lib/workflow-shell/states.ts                          (NEW — five-state machine)
apps/forge/lib/workflow-shell/use-stage-data.ts                  (NEW — per-stage data)
apps/forge/lib/workflow-shell/use-stage-side-effects.ts          (NEW — audit + analytics + RBAC)
apps/forge/lib/workflow-shell/index.ts                           (modified — barrel)
apps/forge/components/workflow-shell/CenterStateBanner.tsx       (NEW)
apps/forge/components/workflow-shell/StageLoadingSkeleton.tsx    (NEW)
apps/forge/components/workflow-shell/StageEmptyState.tsx         (NEW)
apps/forge/components/workflow-shell/StageErrorFallback.tsx      (NEW)
apps/forge/components/workflow-shell/InternalErrorBoundary.tsx   (NEW)
apps/forge/components/workflow-shell/StagePanel.tsx              (NEW)
apps/forge/components/workflow-shell/index.ts                    (modified — barrel)
apps/forge/app/workflow/layout.tsx                               (modified — Suspense)
apps/forge/app/workflow/[stage]/page.tsx                         (modified — StagePanel)
apps/forge/tests/workflow-shell/states.test.ts                  (NEW — 14 cases)
apps/forge/tests/workflow-shell/center-state-banner.test.tsx     (NEW — 8 cases)
apps/forge/tests/workflow-shell/stage-panel.test.tsx             (NEW — 5 cases)
apps/forge/tests/e2e/16-workflow-shell.spec.ts                   (modified — 2 state cases)
```

## Why this PR exists

Per `docs/standards/git-workflow.md`, every milestone that merges
directly to `main` is followed by a back-merge PR for traceability.
This PR exists to:

1. **Surface the merge in the GitHub PR list.** Direct-to-main merges
   don't show up as PRs, which makes audit trails harder.
2. **Provide a single reviewable summary** of what shipped, with links
   to the integration report.
3. **Close cleanly.** This PR is intended to be closed (not merged) —
   the actual merge already happened on `main`.

## Verification

- `tsc --noEmit` — pre-existing 253 errors unchanged; **0 new errors in
  production code**; 2 pre-existing test-only `toHaveAttribute` issues
  inherited.
- Direct Node.js verification — 14/14 pure-function tests in
  `states.test.ts` pass.

Component + e2e tests are deferred to the user's local env, per the
M14 + M16 pattern (sandbox has a vite/plugin-react version mismatch).

## See also

- `M17-PRODUCTION-GRADED-STAGES.md` — full integration report.
- `M16-WORKFLOW-SHELL.md` — Sprint 1 integration report (the workflow
  shell itself).
- `apps/forge/docs/architecture/workflow-shell.md` — architecture
  decision record.
- CTO Production Readiness Audit — the source of the production
  checklist that this milestone implements.