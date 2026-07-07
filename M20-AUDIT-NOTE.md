# M20 — Audit Note (back-merge traceability)

> Audit-trail companion to the direct-to-main merge of
> `feat/M20-experience-hero`. The actual merge happened on `main`
> at `f5365ee5`.

## What this PR back-merges

- **Source branch:** `feat/M20-experience-hero`
- **Merged into:** `main` at `f5365ee5`
- **Squash commit:** `7ae7ff07` (feat(workflow): M20 — hero journey banner)
- **PR title (back-merge):** M20 audit note — experience hero journey traceability

## The deliverable

The **HeroJourneyBanner** is a persistent UI element above every
`/workflow/*` page. It:

1. Tracks elapsed time from `markJourneyStart()` (first user
   interaction) — the audit's north-star metric.
2. Surfaces the next hero step with a single CTA. No
   discoverability cliff.
3. Shows a one-line hint explaining why the next step matters.

## What this unblocks

Per the strategy blueprint, the design-partner pilot needs:

- **Median time-to-PR** — now measurable
- **Drop-off rate per step** — measurable via audit + analytics
- **The "lost minutes" at each stage** — measurable via the same
  hooks

These numbers become the homepage, the pitch deck, and the SOC 2
readiness report.

## Files changed in the squash commit

```
M apps/forge/app/workflow/layout.tsx
M apps/forge/components/workflow-shell/ContinueCard.tsx
A apps/forge/components/workflow-shell/HeroJourneyBanner.tsx
M apps/forge/components/workflow-shell/index.ts
A apps/forge/lib/workflow-shell/hero-journey.ts
M apps/forge/lib/workflow-shell/index.ts
M apps/forge/tests/e2e/16-workflow-shell.spec.ts
A apps/forge/tests/workflow-shell/hero-journey.test.ts
```

## Conflict resolution

`apps/forge/tsconfig.tsbuildinfo` (build cache) conflicted with
M19's branch. Resolved by taking "theirs" (latest cache).

## Verification

- `tsc --noEmit` — 0 new production errors
- 18 pure-function tests pass via direct Node.js verification
- Component + e2e tests deferred to user's local env per the
  M14/M16/M17 pattern (sandbox has a vite/plugin-react version
  mismatch)

## See also

- `M20-EXPERIENCE-HERO.md` (full integration report)
- `M19-AUDIT-NOTE.md` (predecessor sprint — god-page decomposition)
- `/workspace/audit/FORGE_AI_PRODUCT_AUDIT_2026_07.md` (P0 "time-to-PR measured")
- `/workspace/audit/FORGE_AI_PRODUCT_STRATEGY_2026_07.md` (Phase C)