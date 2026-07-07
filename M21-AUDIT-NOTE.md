# M21 — Audit Note (back-merge traceability)

> Audit-trail companion to the direct-to-main merge of
> `feat/M21-typecheck-cleanup`. The actual merge happened on `main`
> at `4708d6eb`.

## What this PR back-merges

- **Source branch:** `feat/M21-typecheck-cleanup`
- **Merged into:** `main` at `4708d6eb`
- **Squash commit:** `2b12e771` (feat(types): M21 — zero TypeScript errors)
- **PR title (back-merge):** M21 audit note — typecheck cleanup traceability

## The deliverable

`pnpm typecheck` returns **0 errors**. Down from the 119 baseline
inherited from M14.

```
Before M21: 119 TypeScript errors
After  M21:   0 TypeScript errors
Reduction:  -100%
```

## Why this matters now

The audit's recommended Sprint 2 was deferred during M18-M20 to keep
shipping product. With the hero journey live and PMR back at ~55/100,
the cost/benefit shifted: the mechanical fix-up is now cheap relative
to the friction it removes.

What gets unblocked:
1. CI can run `tsc --noEmit` as a hard gate
2. New contributors onboard without red squiggles
3. The `strict + noUncheckedIndexedAccess` config is actually enforced

## Files in the squash commit

```
41 files changed, 240 insertions(+), 454 deletions(-)
```

Two test files deleted (`AuditIntegrity.test.tsx`,
`connector-center/wire-adapters.test.ts`) — both were testing
shapes that no longer exist.

## See also

- `M21-TYPECHECK-CLEANUP.md` (full integration report with patterns)
- `M20-EXPERIENCE-HERO.md` (predecessor sprint)
- `/workspace/audit/FORGE_AI_PRODUCT_AUDIT_2026_07.md`
- `/workspace/audit/FORGE_AI_PRODUCT_STRATEGY_2026_07.md` (Sprint 2
  in the original Sprint 1-6 plan)
- `M14-BUGS-FIXED.md` (last typecheck-adjacent sprint)