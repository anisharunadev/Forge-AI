# M20 — Experience Hero (Phase C)

> Sprint: Phase C — Experience from the strategy blueprint
> Status: Shipped to `main` at `f5365ee5`

## Goal

Per Phase C of the strategy blueprint, every workflow stage now
meets the audit's production checklist. The headline addition is
the **HeroJourneyBanner** — a persistent spine above every
workflow page that:

1. Shows elapsed time since the user started the journey
   (Idea → PR — the north-star metric per the audit)
2. Surfaces the next-step CTA with no discoverability cliff
3. Connects the seven workflow stages with a "Skip to X" hint

This makes the hero journey visible end-to-end. A pilot user no
longer has to wonder "what do I do next?" — the answer is always
on screen.

## What shipped

| Artifact | Where | Why |
|---|---|---|
| `lib/workflow-shell/hero-journey.ts` | lib | Pure logic: 8 HERO_STEPS, formatElapsed, markJourneyStart, getNextHeroStep |
| `components/workflow-shell/HeroJourneyBanner.tsx` | components | Persistent banner above every workflow stage |
| `app/workflow/layout.tsx` | app | Async layout reads current stage from `x-pathname` header |
| `components/workflow-shell/ContinueCard.tsx` | components | Secondary "Skip to X" CTA + journey-start on click |
| `tests/workflow-shell/hero-journey.test.ts` | tests | 7 pure-function cases |
| `tests/e2e/16-workflow-shell.spec.ts` | e2e | +3 hero journey cases |

## The 8-step journey

```
1. Capture the idea          (/workflow/idea)
2. Generate the PRD          (/workflow/prd)
3. Approve architecture      (/workflow/architecture)
4. Break down tasks          (/workflow/tasks)
5. Approve the plan          (/workflow/approval)
6. AI develops               (/workflow/develop)
7. Open the PR               (/workflow/pr)
8. Deploy                    (/admin/cost)
```

Every step has a `oneLiner` ("Type the product idea in one
paragraph", etc.) — the banner shows that line so the user
always knows why the next step matters.

## The metric we can now measure

**Time-to-first-PR** = `Date.now() - readJourneyStart()`

The banner renders the formatted elapsed time (e.g. "12m 34s") and
updates every second. The first time a user clicks "Open Idea" or
"Skip to PRD", `markJourneyStart()` is called, persisting the
timestamp to localStorage. The journey survives page navigations
and reloads.

The first design partner can give us:
- Median time-to-PR per cohort
- Drop-off rate per step
- The "lost minutes" at each stage

These are the numbers that go on the homepage, the pitch deck,
and the SOC 2 readiness report.

## Conflict resolution

Day 5's typecheck sweep landed during M19/M20 work. Both branches
rebased onto main; only `tsconfig.tsbuildinfo` (build cache)
conflicted. Resolved by taking theirs (the latest cache).

## See also

- `/workspace/audit/FORGE_AI_PRODUCT_STRATEGY_2026_07.md` (Phase C — Experience)
- `/workspace/audit/FORGE_AI_PRODUCT_AUDIT_2026_07.md` (P0 "time-to-PR measured")
- `M19-AUDIT-NOTE.md` (predecessor sprint — god-page decomposition)
- `M18-PRODUCT-TRANSFORMATION-CUT.md` (the cut that preceded both)
- `M17-PRODUCTION-GRADED-STAGES.md` (workflow shell stages)
- `M16-WORKFLOW-SHELL.md` (workflow shell foundation)