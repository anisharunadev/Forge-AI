# M19 — Audit Note (back-merge traceability)

> Audit-trail companion to the direct-to-main merge of
> `feat/M19-architecture-decompose`. The actual merge happened on
> `main` at `9c9132bb`.

## What this PR back-merges

- **Source branch:** `feat/M19-architecture-decompose`
- **Merged into:** `main` at `9c9132bb`
- **Squash commit:** `7bfc4182` (refactor(architecture): M19 — decompose god-page into per-tab routes)
- **PR title (back-merge):** M19 audit note — architecture decomposition traceability

## The decomposition

| File | Before | After |
|---|---:|---:|
| `app/architecture/page.tsx` | 2,936 LoC god-page | 37 LoC overview entry |
| `app/architecture/[tab]/page.tsx` | (didn't exist) | 81 LoC dynamic route |
| `components/architecture/ArchitectureCenter.tsx` | (didn't exist) | 2,966 LoC shared client component (logic unchanged) |
| `components/architecture/inline/Pill.tsx` | (didn't exist) | First of the extracted inline helpers |

The split is **structural** (separate routes + a shared client
component) rather than **behavioral** (the rendering logic is
unchanged). Per-tab URLs preserve the existing `?tab=` query
semantics so any old bookmark to `/architecture?tab=adrs` still
works.

## Per-tab URLs

- `/architecture/adrs` → ADRs tab
- `/architecture/contracts` → API contracts
- `/architecture/tasks` → Task breakdowns
- `/architecture/risks` → Risk registers
- `/architecture/trace` → Traceability matrix
- `/architecture/versions` → Versions
- `/architecture/radar` → Tech radar
- `/architecture/diagrams` → Diagrams
- `/architecture/security` → Security report

## See also

- `M19-ARCHITECTURE-DECOMPOSITION.md` (this M19 integration report)
- `/workspace/audit/FORGE_AI_PRODUCT_AUDIT_2026_07.md`
- `/workspace/audit/FORGE_AI_PRODUCT_STRATEGY_2026_07.md` (Phase C — Experience)
- `M18-PRODUCT-TRANSFORMATION-CUT.md` (the cut that preceded this)
- `M16-WORKFLOW-SHELL.md` (the workflow shell this integrates with)