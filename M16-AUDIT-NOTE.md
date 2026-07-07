# M16 — Audit Note (back-merge traceability)

> This document is the audit-trail companion to the direct-to-main
> merge of `feat/M16-sprint-1-workflow-shell`. GitHub does not allow
> 0-commit back-merge PRs, so this file exists to give the
> back-merge PR one substantive addition.

## Merge that this PR back-merges

- **Source branch:** `feat/M16-sprint-1-workflow-shell`
- **Merged into:** `main` at commit `fd7e8a96`
- **Squash commit:** `860e9e79` (feat(workflow-shell): M16 — Sprint 1 revised, golden workflow UI)
- **PR title (back-merge):** M16 audit note — workflow shell back-merge traceability

## Files changed in the squash commit

21 files changed, 1668 insertions(+), 15 deletions(-)

```
M16-WORKFLOW-SHELL.md                                              (integration report)
apps/forge/app/page.tsx                                            (modified — workflow-first home)
apps/forge/app/workflow/[stage]/page.tsx                           (new — 7 stage pages)
apps/forge/app/workflow/layout.tsx                                 (new — wraps with progress bar)
apps/forge/app/workflow/page.tsx                                   (new — alias to first stage)
apps/forge/components/workflow-shell/ContinueCard.tsx              (new)
apps/forge/components/workflow-shell/RecentActivityCard.tsx        (new)
apps/forge/components/workflow-shell/StageChip.tsx                 (new)
apps/forge/components/workflow-shell/StartProjectCard.tsx          (new)
apps/forge/components/workflow-shell/WorkflowHome.tsx              (new)
apps/forge/components/workflow-shell/WorkflowProgressBar.tsx       (new)
apps/forge/components/workflow-shell/index.ts                      (new — barrel)
apps/forge/docs/architecture/workflow-shell.md                     (new — architecture doc)
apps/forge/lib/workflow-shell/index.ts                             (new — barrel)
apps/forge/lib/workflow-shell/progress.ts                          (new — pure derivation)
apps/forge/lib/workflow-shell/stages.ts                            (new — 7 stages)
apps/forge/lib/workflow-shell/types.ts                             (new)
apps/forge/lib/workflow-shell/use-workflow-progress.ts             (new — hook)
apps/forge/tests/e2e/16-workflow-shell.spec.ts                     (new — 9 e2e cases)
apps/forge/tests/workflow-shell/components.test.tsx                (new — 8 component cases)
apps/forge/tests/workflow-shell/progress.test.ts                   (new — 10 pure-function cases)
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

## What changed (one-paragraph summary)

Replaces the nine-center grid home page with a single golden workflow
shell (`/workflow` + 7 stage pages). New users now see a progress bar
showing where they are in the Idea → PRD → Architecture → Tasks →
Approval → Develop → PR journey, plus a single "Continue" CTA pointing
to the next stage. Power users can still reach `/dashboard` and
`/centers/*` directly — no center was deleted.

## Verification

- `tsc --noEmit` — pre-existing 253 errors unchanged; **0 new errors in
  production code**; 2 pre-existing test-only `toHaveAttribute` issues
  inherited by the new tests (will be fixed in Sprint 2).
- Direct Node.js verification — all 10 pure-function tests in
  `progress.test.ts` pass.
- Component + e2e tests — deferred to user's local env per the M14
  pattern (sandbox has a vite/plugin-react version mismatch).

## See also

- `M16-WORKFLOW-SHELL.md` — full integration report with sprint
  metrics, file inventory, and next-step plan.
- `apps/forge/docs/architecture/workflow-shell.md` — architecture
  decision record for the workflow shell.
- CTO Production Readiness Audit (2026-07-06) — the source of the
  fragmentation finding that this milestone addresses.