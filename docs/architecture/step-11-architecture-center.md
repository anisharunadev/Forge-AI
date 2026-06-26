# Step 11 — Architecture Center modernization

> Run date: 2026-06-25.
> Scope: rebuild `apps/forge/app/architecture/page.tsx` and
> split the heaviest panels into four co-located components
> under `apps/forge/components/architecture/`. Tabs preserved,
> master-detail behaviour hardened, breadcrumb + URL sync added.

## Skill sources

| Query (domain) | Top rules extracted |
| --- | --- |
| `documentation tabs ADR architecture decision records dark` (style) | Swiss Modernism 2.0 — 12-col grid, mathematical spacing, single accent. Dark Mode (OLED) — layered `--bg-*` surfaces, neon accents for status. |
| `tab navigation documentation viewer markdown table` (ux) | Tables on mobile → `overflow-x-auto` wrapper. Sticky nav → `pt-20` compensation. Breadcrumbs on 3+ levels. |
| `table list filter search empty state documentation` (ux) | Empty states must pair illustration + action. No results → suggest alternate searches. |

> Note on `--domain ux-guideline`: the script's `--help` enumerates
> only `style / color / chart / landing / product / ux / typography /
> icons / react / web`. `--domain ux-guideline` raises
> `invalid choice`, so `--domain ux` is the correct flag.

## Layout sketch

```
┌────────────────────────────────────────────────────────────────────────┐
│ AdminShell                                                             │
│ max-w-[1440px] mx-auto                                                  │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────┐    │
│ │  HERO BAND  (hero-border gradient)                             │    │
│ │  CENTER  ⚡ Architecture Center                       [+New ADR]│   │
│ │  ADRs, API contracts, …                       [⚠ Demo: 3 conflicts]│ │
│ └────────────────────────────────────────────────────────────────┘    │
│                                                                        │
│  Architecture › ADRs › ADR-0001              ← breadcrumb (3 levels) │
│                                                                        │
│ ┌─[ADRs 14]──[API Contracts 9]──[Tasks 5]──[Risks 4]──[Trace]──[Ver 3]┐│
│ │  ▲ layoutId="architecture-tab-pill"  Framer Motion 200ms ease  ▲  ││
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ ┌──────────────── 360px ──────────────┐ ┌───── flex-1 detail ──────┐  │
│ │ 🔍 Search ADRs...                    │ │ ADR-0001  [Accepted]     │  │
│ │ [All][Draft][Accepted][Deprecated]   │ │ Use Redis streams…       │  │
│ │ [All][Backend][Frontend][Infra][Data]│ │ 🧑 Sara Kim · 2026-06-25 │  │
│ │                                      │ │ ─────────────────────── │  │
│ │ ▌ADR-0001 Use Redis streams   ✓     │ │ ## Context …             │  │
│ │  ADR-0002 Use pgvector         ◑     │ │ ## Decision …            │  │
│ │  ADR-0003 Resolve drift        ○     │ │ ## Consequences …        │  │
│ │  ADR-0004 Multi-tenant RLS     ✕     │ │                          │  │
│ │  …                                   │ │ Linked: [ADR-002][ADR-4] │  │
│ │ (sticky top-4)                       │ │ [forge-api-contracts]    │  │
│ │                                      │ │ ─────────────────────── │  │
│ │                                      │ │ [Edit ADR] [Supersede]   │  │
│ │                                      │ │ [Mark accepted] (sticky) │  │
│ └──────────────────────────────────────┘ └──────────────────────────┘  │
│                                                                        │
│ Tabs collapse to single-column <1024px (lg:grid-cols-[360px_1fr])      │
└────────────────────────────────────────────────────────────────────────┘
```

## Files modified / created

| Path | Change |
| --- | --- |
| `apps/forge/app/architecture/page.tsx` | Rewritten as a tab + master-detail orchestrator. Adds `TabBar`, `Breadcrumb`, `Pill`, `ADRMasterDetail`, `APIContractMasterDetail`, `TaskBreakdownMasterDetail`. URL sync via `useSearchParams` + `router.replace`. |
| `apps/forge/components/architecture/ArchitectureHero.tsx` | NEW. Step 4 `hero-border` ring + eyebrow + h1 + body + conditional conflict badge + New ADR primary. |
| `apps/forge/components/architecture/RiskRegisterKanban.tsx` | NEW. 3-column @dnd-kit kanban (Open / Mitigating / Closed). Severity badge, owner avatar, synthetic ADR chip. |
| `apps/forge/components/architecture/TraceabilityMatrix.tsx` | NEW. Coverage matrix (default) + flat SVG graph toggle. `overflow-x-auto` wrapper per UX skill rule. |
| `apps/forge/components/architecture/VersionTimelineView.tsx` | NEW. Vertical timeline, `<details>` collapsibles, Promote Sonner toast. |
| `CHANGELOG.md` | Step 11 entry above Step 7. |
| `docs/architecture/step-11-architecture-center.md` | This file. |

No new dependencies. Reuses the Step 1 tokens, Step 3 EmptyState,
Step 5 Sonner + @dnd-kit, Step 6 motion primitives + Framer Motion
`layoutId` pill, and the existing `ADRViewer` / `APIContractViewer`
/ `TaskBreakdownTree` viewers.

## Rationale — how skill rules shaped the decisions

The three skill queries returned converging constraints that drove
every decision in this rebuild. **Style** (`Swiss Modernism 2.0` +
`Dark Mode OLED`) fixed the foundation: a single indigo accent
(`--accent-primary`), mathematical 24/32/48px spacing scale,
layered `--bg-base` / `--bg-surface` / `--bg-elevated` surfaces
instead of raw `bg-black` / `bg-white` solids, and a 12-column
`max-w-[1440px]` container that gives the hero + tabs + master-
detail grid the calm, architectural feeling the style guide asks
for. **UX** surfaced the three rules that show up everywhere on this
page: tables (and matrices) on mobile must wrap in
`overflow-x-auto` (the traceability matrix does this), sticky
navigation needs to leave room for content (the ADR list + detail
panels use `lg:sticky lg:top-4` and never push the hero out of
view), and breadcrumbs belong on every page with three or more
levels of depth (the breadcrumb above the tabs renders
`Architecture / ADRs / ADR-0001` from the URL state). The
no-results and empty-state rules drove the two `EmptyState` arms
on every tab (illustrations + primary CTA + secondary CTA on the
ADR variant), and the ADR list adds an inline `No ADRs match —
try a different search.` hint inside the sticky list itself so a
filter empty result is distinguishable from "no data yet." **Focus
+ keyboard** (high-severity rules) drove the visible `focus-visible:
ring-2 ring-[var(--accent-primary]` on every interactive element,
the Framer Motion `layoutId` pill (so the active tab indicator
animates without disturbing focus order), and the keyboard-friendly
@`dnd-kit` PointerSensor + KeyboardSensor + sortable keyboard
coordinate getter on the risk kanban. The `@dnd-kit` package was
already added in Step 5, so no new dependency. **Multi-tenant /
Rule 2** is preserved implicitly — every `ADR`, `APIContract`,
`TaskBreakdown`, `RiskRegister` flows through the existing
`useApiData` hooks that hit `/v1/architecture/*`, which the
backend stubs as `tenant_id`-scoped. No provider SDK is imported
(Rule 1), and the new `Resolve` button + linked-chip clicks fire
Sonner toasts rather than mutating state directly — the real
resolve/follow calls are tracked against the ADR-003 ("resolve
drift before merge") workflow.