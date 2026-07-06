# Center Status — M15-2 Production-Ready Gate

> **Status:** 🚧 Gate live (M15-2 first pass). Hero pages 6/10.
> **Last verified:** 2026-07-07
> **Source of truth:** [`center-status.yaml`](./center-status.yaml)
> **Run:** `./scripts/check-page-dod.sh`

---

## What this file is

The single source of truth for "is this center done?" Per Rec #6
(finish one before starting another), a center is **DONE** when ≥ 3 of
its top routes score 10/10 on the 10-point Definition of Done.

## The 10-point DoD

| # | Check | Automated? | Notes |
|---|---|---|---|
| 1 | **Real API** — no mockData / MOCK_ / fixture-only branches in runtime | ✅ | Tab=`mock` whitelisted intentionally in architecture page |
| 2 | **Loading state** — `loading.tsx` co-located | ✅ | Cheapest signal to detect |
| 3 | **Error state** — `error.tsx` co-located OR bubble to `app/error.tsx` | ✅ | Walks parent chain |
| 4 | **Empty state** (R15) — icon + value prop + primary + secondary | 🟡 manual | Heuristic too false-positive-prone |
| 5 | **Permission** — RBAC + tenant scoping verified | 🟡 manual | Backend `require_permission()` + tenant helper presence |
| 6 | **Audit logging** (R6) — `@audit(...)` on artifact-emitting routes | ✅ | Probes `backend/app/core/audit.py` primitive presence |
| 7 | **Analytics event** — one typed event per primary action | 🟡 manual | Frontend `analytics.track(...)` presence |
| 8 | **Accessibility** (R18) — Lighthouse ≥ 90 + axe pass | 🟡 manual | Run in `pnpm test:a11y` |
| 9 | **Responsive** — mobile + tablet breakpoints | 🟡 manual | Visual review |
| 10 | **Test coverage** — ≥ 1 e2e + ≥ 1 unit | ✅ | Matches file name in `backend/tests` or `apps/forge/tests` |

## Current scores (M15-1 hero pages)

```
DoD gate — 2 page(s):
  ✗ /ideation                 score= 6.0/10 regressions=0 manual_remaining=4
  ✗ /architecture             score= 6.0/10 regressions=0 manual_remaining=4

=> avg score 6.0/10 | regressions 0 | manual checks remaining 8
```

**Both hero pages pass all 5 automated checks.** The 4 points lost on
each are the manual gates (empty state, permission, analytics, a11y,
responsive — bottom of stack). PR review must flip those to
`checked: pass` for a route to reach 10/10.

## Center-completion policy (Rec #6)

Per the audit, no new center work until existing centers reach DoD
≥ 80%. For M15-2 first pass:

- **Ideation Center:** top route 6/10. Manual gates pending. Continue
  hero-path work; defer new ideation features.
- **Architecture Center:** top route 6/10. Same posture.

Both centers need **4 of 4 manual gates signed off** before any new
work on either is acceptable.

## Adding a new page to the gate

```yaml
# In docs/product/center-status.yaml
  - center: MyCenter
    top_routes:
      - route: my-center           # path under apps/forge/app/
        component: apps/forge/app/my-center/page.tsx
        backend: backend/app/api/v1/mycenter.py:handler
        hook: apps/forge/lib/hooks/useMyCenter.ts:42
        test: backend/tests/test_my_center.py
        verdicts:
          # 5 manual gates (flip to `checked` after review):
          real_api:    unchecked
          loading:     unchecked
          error:       unchecked
          empty_state: unchecked
          permission:  unchecked
          audit:       unchecked
          analytics:   unchecked
          a11y:        unchecked
          responsive:  unchecked
          coverage:    unchecked
        dod_score: null
```

Then run `./scripts/check-page-dod.sh --verbose`. Gates that should
auto-pass will; manual ones stay `unchecked` until humans sign them off.

## Verification

```bash
# local
./scripts/check-page-dod.sh --verbose

# CI (one-liner):
./scripts/check-page-dod.sh --json > dod-report.json
```

The gate is **not built to fail CI on missing manual gates** — only on
**regressions** (a `pass` becomes `fail` when the code drifts). Manual
gates are a PR-review responsibility, not an automation responsibility.

## What M15-2 is NOT

- **Not a coverage tool** — it samples top routes, not every page.
- **Not a blocker for M15-3** — TTFS work proceeds with the same gate
  in place.
- **Not a rewrite** — does not replace the existing `scripts/check-*-*.sh`
  cohort (CLAUDE.md budget, raw-SQL, orphans, etc.). It complements.

## Change process

This file is **policy**. Changes to the 10-point DoD or the
completion threshold require an ADR per `docs/standards/git-workflow.md`.
Adding new entries to the center-status registry does not.
