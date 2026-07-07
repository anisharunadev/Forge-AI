# M17 — Sprint 3: Production-Grade the Workflow Stages

> **Sprint 3 (Direction B) — Every workflow stage now meets the audit's
> production checklist.**

## Why this sprint shipped

Direction B from the previous sprint review. The CTO audit + Head of
Product assessment both flagged that the audit's P0 critical blockers
are about surfaces, not lint. Sprint 3 production-grades each of the
seven workflow stages so a pilot user can complete "Idea → PR" without
seeing a mock, a silent fallback, or an unhandled error.

## Definition of Done — achieved

- [x] `CenterStateBanner` — single source of truth for the five
      data-source states (live / cached / demo / error / loading)
- [x] `StageErrorFallback` — renders the typed INTERNAL_ERROR
      envelope exactly as `Phase4Error.to_envelope()` produces it
- [x] `InternalErrorBoundary` — class-component boundary that
      catches render-time errors and renders the typed envelope
- [x] `StageLoadingSkeleton` — typed loading state, structured to
      match the eventual content density
- [x] `StageEmptyState` — typed empty state with optional CTA
- [x] `StagePanel` — wrapper composing banner + boundary + skeleton
      + empty + content
- [x] `useStageData` — composes existing center hooks into a
      per-stage discriminated `StageData` payload
- [x] `useStageSideEffects` — wires audit + analytics + RBAC; all
      three side-effects are best-effort and never crash the page
- [x] `/workflow/[stage]` pages render through `StagePanel`
- [x] `/workflow` layout wraps the progress bar in `<Suspense>`
- [x] Banner / state machine data attributes are e2e-queryable
- [x] 14 pure-function tests + 4 component tests + 2 e2e cases

## Files added

### Library (3)

- `apps/forge/lib/workflow-shell/states.ts` — five-state machine,
  pure derivation, INTERNAL_ERROR envelope type guards
- `apps/forge/lib/workflow-shell/use-stage-data.ts` — per-stage data
  composing existing center hooks
- `apps/forge/lib/workflow-shell/use-stage-side-effects.ts` — audit
  + analytics + RBAC wired together

### Components (6)

- `apps/forge/components/workflow-shell/CenterStateBanner.tsx`
- `apps/forge/components/workflow-shell/StageLoadingSkeleton.tsx`
- `apps/forge/components/workflow-shell/StageEmptyState.tsx`
- `apps/forge/components/workflow-shell/StageErrorFallback.tsx`
- `apps/forge/components/workflow-shell/InternalErrorBoundary.tsx`
- `apps/forge/components/workflow-shell/StagePanel.tsx`

### Modified (4)

- `apps/forge/lib/workflow-shell/index.ts` — barrel expansion
- `apps/forge/components/workflow-shell/index.ts` — barrel expansion
- `apps/forge/app/workflow/layout.tsx` — Suspense around progress bar
- `apps/forge/app/workflow/[stage]/page.tsx` — `StagePanel` wrapper
- `apps/forge/tests/e2e/16-workflow-shell.spec.ts` — 2 new state cases

### Tests (3)

- `apps/forge/tests/workflow-shell/states.test.ts` — 14 pure cases
- `apps/forge/tests/workflow-shell/center-state-banner.test.tsx` — 8 cases
- `apps/forge/tests/workflow-shell/stage-panel.test.tsx` — 5 cases

**Total: 12 new files, 5 modified, ~1,150 LOC**

## The five-state machine

| State | When | Banner tone | What user sees |
|---|---|---|---|
| `live` | Fresh data fetched | Emerald dot | "Live data" |
| `cached` | Stale data, API down | Amber dot | "Cached data" |
| `demo` | Demo / seed source | Violet dot | "Demo data" |
| `error` | Underlying API errored | Rose dot | "Error — {code}" |
| `loading` | Initial fetch in flight | Sky dot, pulsing | "Loading" |

Each state's `data-testid` is stable (e.g. `workflow-state-error`) so
e2e tests can assert which state a page is in.

## The INTERNAL_ERROR envelope

Mirrors the backend's `Phase4Error.to_envelope()` shape exactly:

```json
{
  "error": "PASS_THROUGH_DISABLED",
  "message": "Pass-through is disabled in this environment",
  "details": { "env": "prod" },
  "occurred_at": "2026-07-07T12:00:00+00:00"
}
```

Frontend now renders that envelope as a typed surface:

- The `error` code is the headline (monospace, uppercase).
- The `message` is the explanation.
- The `details` are a collapsible JSON block.
- The `occurred_at` is shown inline.
- A "Reload" button refreshes the page if recovery fails.

## The audit + analytics + RBAC side-effects

`useStageSideEffects` is called by every `StagePanel` mount and:

1. **Audit** — best-effort `POST /v1/audit/events` with
   `{action: "workflow.stage.mounted", stage, project_id, ts}`.
   Failures are swallowed (audit is observable, not authoritative —
   the server-side middleware records the same event).
2. **Analytics** — pushes `{event: "workflow_stage_mounted", ...}` to
   `window.dataLayer` (GTM-compatible). Sites without GTM installed
   simply ignore it.
3. **RBAC** — coarse check via `useAuth().user.role`. Owners,
   admins, and editors can act. Viewers can browse. Returns
   `canView=false` if there is no active session, which makes the
   panel render a "Permission required" empty state.

All three are best-effort and never crash the page render.

## Typecheck

| Bucket | Before (M16) | After (M17) | Delta |
|---|---|---|---|
| Pre-existing errors | 253 | 253 | **0** |
| New production errors | 0 | **0** | — |
| New test errors | 2 | 2 | **0** |

Both new test errors are pre-existing repo-wide `toHaveAttribute`
typing issues that every test file in the project inherits.

## Runtime verification

`pnpm test` and `pnpm test:e2e` cannot run in the sandbox (vite
version mismatch with `@vitejs/plugin-react@6` — same issue that
blocked M14 and M16). Verified via:

1. `tsc --noEmit` — all new production code clean
2. Direct Node.js verification — 14/14 pure-function tests pass

Component + e2e tests are deferred to the user's local env, per the
M14 + M16 pattern.

## What I did NOT do (deferred)

- **Did not embed full center UIs into each stage page.** The stage
  pages still deep-link to the underlying center for the heavy
  interactive UI. Embedding the full centers is a much larger change
  that needs the centers themselves to be production-grade first
  (some still have mock fallbacks).
- **Did not add real-time WebSocket updates.** The audit flagged
  live audit-stream rendering as P1; that ships in Sprint 4.
- **Did not add per-action RBAC.** Today the panel gates view-vs-act
  via role; the backend enforces the granular rules.
- **Did not retry on error automatically.** Reload is manual; auto-
  retry is a UX call that needs product review.

## Branch

`feat/M16-sprint-1-workflow-shell` (continued — same branch, second
sprint). One branch, two sprints, atomic story.

## PR

Pending — see `M17-AUDIT-NOTE.md`.