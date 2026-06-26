# Step 7 — Forge Command Center layout

> Run date: 2026-06-25.
> Scope: rebuild `apps/forge/app/forge-command-center/page.tsx` as a
> 3-column workspace. Reuses the existing `forge-commands.ts` catalog
> and the Step 1–6 primitives (tokens, EmptyState, Sonner, Framer
> Motion, prefers-reduced-motion).

## Text sketch of the layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ AdminShell (existing top bar + sidebar rail)                              │
├──────────────────────────────────────────────────────────────────────────┤
│  max-w-[1600px] mx-auto  flex  gap-6  (lg:flex-row, base:flex-col)        │
│ ┌────────────┐ ┌──────────────────────────────────┐ ┌─────────────────┐ │
│ │ 240px      │ │ flex-1 center                    │ │ 320px           │ │
│ │ (≥lg)      │ │                                  │ │ (≥xl)           │ │
│ │            │ │ Eyebrow FORGE COMMAND CENTER     │ │                 │ │
│ │ CATEGORIES │ │ H1  ⚡ Run a forge-* command     │ │ ▣ RECENT RUNS   │ │
│ │            │ │ p  subtitle                      │ │ ─────────────── │
│ │ ▣ Onboarding│ ┌────────────────────────────┐    │ │ • forge-review  │ │
│ │ ▣ Project I│ │ 🔍 Search forge-* cmds ⌘/  │    │ │ • forge-test    │ │
│ │ ▣ Ideation │ └────────────────────────────┘    │ │ • forge-arch    │ │
│ │ ▣ Arch ←●  │ ⏱ History is captured per cmnd    │ │ • forge-deploy  │ │
│ │ ▣ Dev      │                                   │ │ • forge-ideation│ │
│ │ ▣ Testing  │ ┌──────┐ ┌──────┐ ┌──────┐         │ │                 │ │
│ │ ▣ Security │ │ Card │ │ Card │ │ Card │         │ │ View all runs → │ │
│ │ ▣ Review   │ │ 40×40│ │      │ │      │         │ │                 │ │
│ │ ▣ Deploy   │ │ +Run │ │      │ │      │         │ │                 │ │
│ │ ▣ Milestone│ └──────┘ └──────┘ └──────┘         │ │                 │ │
│ │ ▣ Learning │                                   │ │                 │ │
│ │ ▣ Workflow │ (responsive: 1/2/3 cols)           │ │                 │ │
│ │ ▣ Env      │                                   │ │                 │ │
│ │            │                                   │ │                 │ │
│ │ ─────────  │                                   │ │                 │ │
│ │ Show depre │                                   │ │                 │ │
│ └────────────┘ └──────────────────────────────────┘ └─────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## Files touched

| Path | Change |
| --- | --- |
| `apps/forge/app/forge-command-center/page.tsx` | Replaced Tabs-based page with 3-column layout. Adds `CategorySidebar`, `CommandCard`, `RecentRunsSidebar`, `ForgeCommandCenterPage` (`'use client'`). |
| `apps/forge/types/dnd-kit-sonner.d.ts` | Extended the `framer-motion` shim so `motion.span` accepts `animate` + `aria-hidden` (Step 6 shim was too narrow). |
| `CHANGELOG.md` | Step 7 entry above the Step 6 block. |
| `docs/architecture/step-7-forge-command-center.md` | This file. |

No new dependencies. Reuses the Step 1 token system, Step 2 AdminShell,
Step 3 EmptyState, Step 5 Sonner `toast.success`, Step 6 Framer Motion
`motion.span` + global `prefers-reduced-motion` block.

## Rationale — how skill rules shaped the decisions

The three skill queries I ran before this build (`command catalog CLI
reference developer documentation dark`, `search filter category sidebar
documentation pattern`, `developer tool command palette dark mode typography`)
all surfaced the same constraints that drove the final decisions:
(a) dark surfaces should be layered (`--bg-base` / `--bg-surface` /
`--bg-elevated`) and never use a raw `bg-black`/`bg-white` solid class
— that's why the cards use `bg-[var(--bg-surface)]` and the scrim
is the Step 6 `--scrim` token, not `bg-black/80`; (b) command
catalogs need a persistent category rail on the left with a visible
selection state — that's why the active row uses a Framer Motion
`layoutId` rail (Step 6 vocabulary) instead of a colored left border
that disappears on hover; (c) instant search on small local datasets
must NOT debounce — debouncing a 13-category lookup with ~100 commands
in total would feel laggy — so the search is a synchronous
`searchCommands(query)` call and the empty state offers a
`Clear filters` primary action rather than a "did you mean…" search
retry. The keyboard nav (↑↓ / Enter) and `prefers-reduced-motion`
gating on the `layoutId` rail + shimmer sweep come straight from
the Step 6 motion vocabulary so the page reads as part of the same
product as Agent Center and Ideation Center.