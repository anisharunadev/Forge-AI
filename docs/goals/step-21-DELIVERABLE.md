# Step 21 — Stories Center — Deliverable

> Goal: Modernize the Stories page in Forge AI Agent OS. Tokens, shell, empty/error states, and Steps 7–20 are done.

## Files modified

| Path | Change |
|---|---|
| `apps/forge/app/project-intelligence/stories/page.tsx` | Rebuilt as the Stories Center entry — wraps the orchestrator with `max-w-[1800px]` container + Suspense + page metadata. |
| `apps/forge/app/project-intelligence/stories/_components/StoriesCenter.tsx` | New orchestrator that holds the in-memory store, sprint scope, filter state, view toggle, drawer, new-story dialog, and the empty / loading / error states. |
| `apps/forge/app/project-intelligence/stories/_components/HeroBand.tsx` | New animated gradient hero (`hero-border`), eyebrow + h1 + body, sprint picker combobox, segmented view toggle, primary CTA. |
| `apps/forge/app/project-intelligence/stories/_components/KPIStrip.tsx` | New 5-tile strip (Total in sprint / Backlog / In progress / In review / Done), sparkline + velocity bar. |
| `apps/forge/app/project-intelligence/stories/_components/FilterBar.tsx` | New search + 4 pill groups + active-count badge + Clear filters link with `aria-live="polite"`. |
| `apps/forge/app/project-intelligence/stories/_components/KanbanBoard.tsx` | New 5-column (optional 6th Blocked) kanban with `@dnd-kit/core` (`PointerSensor` + `KeyboardSensor`), sticky headers, WIP limits (rose when exceeded), drag handle, quick-add inputs, aria-live announcements. |
| `apps/forge/app/project-intelligence/stories/_components/StoryCard.tsx` | New card — priority dot, identifier, title (clamp 3 lines), label chips, assignee avatar with online dot, estimate, comment/attachment counts, age, subtask progress, drag handle, done/blocked visual states. |
| `apps/forge/app/project-intelligence/stories/_components/ListView.tsx` | New virtualized-ready table with sortable headers, row select, floating bulk-action bar (Assign / Move / Delete). |
| `apps/forge/app/project-intelligence/stories/_components/TimelineView.tsx` | New horizontal swimlanes per assignee, day grid, today indicator (cyan vertical line). |
| `apps/forge/app/project-intelligence/stories/_components/StoryDrawer.tsx` | New 720px right-slide-in drawer, 4 tabs (Detail / Activity / Attachments / Analytics), focus management, Esc-to-close, sticky footer with status / assignee / save indicator. |
| `apps/forge/app/project-intelligence/stories/_components/NewStoryDialog.tsx` | New dialog — Title (required, validated) + Description + Epic + Sprint + Priority + Estimate + Labels + Assignee; Create + Create-and-add-another. |
| `apps/forge/app/project-intelligence/stories/_components/BoardSkeleton.tsx` | New loading skeleton with 3 placeholder cards per column using the global `.shimmer` utility (Step 6 motion primitives). |
| `apps/forge/lib/stories/types.ts` | New canonical `Story` type plus all dependent shapes (`AcceptanceCriterion`, `Subtask`, `DefinitionOfDone`, `Comment`, `Attachment`, `LinkedItem`, `ActivityEvent`, `Assignee`, `Sprint`, `StoryFilter`). |
| `apps/forge/lib/stories/mock-data.ts` | New fixtures — 6 assignees, 4 sprints (incl. Backlog + current Sprint 25.13), 18 stories across all statuses, sample comments. |

Existing routes preserved: `apps/forge/app/project-intelligence/stories/[id]/page.tsx` (the per-story detail page) was not touched and remains reachable from the drawer footer "Open in full page" link.

## Story type (canonical shape, shared across all views)

```ts
interface Story {
  readonly id: string;
  readonly identifier: string;            // "S-123"
  readonly title: string;
  readonly status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3';
  readonly estimate: 'XS' | 'S' | 'M' | 'L' | 'XL';
  readonly labels: ReadonlyArray<'bug' | 'feature' | 'chore' | 'docs' | 'spike'>;
  readonly assignee: Assignee | null;
  readonly epicId: string | null;
  readonly sprintId: string | null;
  readonly description: string;
  readonly acceptanceCriteria: ReadonlyArray<AcceptanceCriterion>;
  readonly subtasks: ReadonlyArray<Subtask>;
  readonly definitionOfDone: ReadonlyArray<DefinitionOfDone>;
  readonly linkedItems: ReadonlyArray<LinkedItem>;
  readonly activity: ReadonlyArray<ActivityEvent>;
  readonly comments: ReadonlyArray<Comment>;
  readonly attachments: ReadonlyArray<Attachment>;
  readonly commentCount: number;
  readonly attachmentCount: number;
  readonly blocked: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly startDate?: string;
  readonly endDate?: string;
}
```

All `readonly`. Identifiers and timestamps are stable strings. The same `Story` is consumed by kanban, list, timeline, drawer, KPI strip, and filter bar — the views are pure projections.

## View layouts (text sketches)

**Hero band** — animated gradient border (`.hero-border` from globals.css) wraps a panel:
```
┌────────────────────────────────────────────────────────────────────────────┐
│ CENTER                                                                     │
│ ▣ Stories                                                                  │
│ Every user story across this project. Drag cards across columns…           │
│                       [📅 Sprint 25.13 · 2026-06-16 → 2026-06-29 ▾]        │
│                       [Kanban | List | Timeline]   [+ New story]           │
└────────────────────────────────────────────────────────────────────────────┘
```

**KPI strip** — five 120px tiles (indigo / muted / cyan / amber / emerald):
```
┌── Total in sprint ──┐ ┌── Backlog ──┐ ┌── In progress ──┐ ┌── In review ──┐ ┌── Done this sprint ──┐
│ 9  ↗ +3 this week  ↘│ │ 4 across 1 │ │ 2  ↗ +1 today  │ │ 2  ↘ -1 yes. │ │ 4  ↗ 10pts · 56%     │
│       /\/\/\ sparkline│ │            │ │                │ │             │ │ ████████░░ velocity   │
└────────────────────┘ └────────────┘ └────────────────┘ └─────────────┘ └─────────────────────┘
```

**Filter bar**:
```
🔍 Search stories…   Priority: •P0 •P1 •P2 •P3   Label: •bug •feature •chore •docs •spike
                     Estimate: •XS(1) •S(2) •M(3) •L(5) •XL(8)   Assignee: [AA] [MT] …
                                                                                              [3] [✕ Clear]
```

**Kanban board** — 5 (or 6 with Blocked) equal-width columns:
```
┌─ Backlog ────┐ ┌─ To Do ──────┐ ┌─ In Progress ┐ ┌─ In Review ┐ ┌─ Done ──────┐
│ ● Backlog  4 │ │ ● To Do  2/5│ │ ● In Prog 1/5│ │ ● In Rev 2 │ │ ● Done   4  │
│  8 pts   + ⊕ │ │  3 pts   + ⊕│ │  5 pts   + ⊕│ │  4 pts   + ⊕│ │ 10 pts  + ⊕ │
├──────────────┤ ├──────────────┤ ├──────────────┤ ├────────────┤ ├─────────────┤
│ ┌──────────┐ │ │ ┌──────────┐ │ │ ┌──────────┐ │ │ ┌────────┐ │ │ ┌─────────┐ │
│ │ • S-115  │ │ │ │ • S-104  │ │ │ │ • S-101  │ │ │ │ • S-103│ │ │ │ • S-105 │ │
│ │ Harden…  │ │ │ │ Bug: …   │ │ │ │ Stories… │ │ │ │ Filter…│ │ │ │ Sprint… │ │
│ │ chore    │ │ │ │ bug      │ │ │ │ feature  │ │ │ │ feature│ │ │ │ feature │ │
│ │ ? M  2d  │ │ │ │ [DR] S 0 │ │ │ │ [AA] L 4h│ │ │ │ docs/… │ │ │ │ 0d  ✓  │
│ └──────────┘ │ │ └──────────┘ │ │ └──────────┘ │ │ └────────┘ │ │ └─────────┘ │
│  Drop here   │ │  Drop here   │ │  Drop here   │ │  Drop here │ │  Drop here  │
│  + Add story │ │  + Add story │ │  + Add story │ │  + Add st. │ │  + Add story│
└──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ └─────────────┘
```

**List view** — sortable virtualized table with sticky header + bulk action bar:
```
☐  ID      Title                  Status          Pri  Assignee  Est  Labels        Updated
☐  S-101   Stories Center…        ● In Progress   P0   Arun      L    feature       13:42
☑  S-103   Filter bar…            ● In Review     P2   Priya     M    feature,docs  11:20
…
                                                            ┌─────────────────────────────────┐
                                                            │ 2 selected  ✕  | Assign  Move  Delete│
                                                            └─────────────────────────────────┘
```

**Timeline view** — horizontal swimlanes per assignee, 14 days, today cyan line:
```
Assignee  Tue  Wed  Thu  Fri  Sat  Sun  Mon  Tue  Wed  Thu  Fri  Sat  Sun  Mon
                                   │
[AA]       ░░░░░░░░░░░░░░░ S-101 ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
[MT]                 S-102 ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
[PI]      S-103 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                                   ↑ today
```

**Story drawer** — 720px right-slide-in, 4 tabs, sticky footer:
```
┌──────────────────────────────────────────────────────────┐
│ S-101 • P0 • In Progress                            ✕    │
│ Stories Center kanban with @dnd-kit keyboard support     │
│ Created by Arun · Jun 19, 2026 · Last updated 5h ago     │
├──────────────────────────────────────────────────────────┤
│ Detail │ Activity │ Attachments │ Analytics              │
├──────────────────────────────────────────────────────────┤
│ DESCRIPTION                                              │
│ Build a full kanban center under …                       │
│                                                          │
│ ACCEPTANCE CRITERIA · 3/4 · 75%                          │
│ ☑ Kanban renders 5 columns                               │
│ ☑ Pointer drag works                                     │
│ ☑ Keyboard drag works (Space pickup…)                    │
│ ☐ WIP limit exceeds triggers rose highlight              │
│                                                          │
│ SUBTASKS                                                 │
│ ◐ Type + mock data   ◐ Hero + KPI strip   ◐ Filter bar   │
│                                                          │
│ DEFINITION OF DONE                                       │
│ ☑ Code reviewed  ☑ Tests pass  ☐ Docs  ☐ Deployed        │
│                                                          │
│ LINKED ITEMS                                             │
│ [epic] Forge OS  [adr] ADR-009 Provider Abstraction …    │
├──────────────────────────────────────────────────────────┤
│ Status ▾  Assignee ▾                  💾 Saved 5s ago  Open in full page ↗ │
└──────────────────────────────────────────────────────────┘
```

## Rationale (1 paragraph)

The Stories Center was built around the canonical `Story` type in `lib/stories/types.ts` so every view (kanban, list, timeline, drawer, KPI strip, filter bar) shares one shape — no view-specific data projection, no shape drift, and the Step 14 "all data shapes stable across views" rule holds by construction. Kanban uses `@dnd-kit/core` with both `PointerSensor` and `KeyboardSensor` (Space pickup, arrow-key move, Space drop, Esc cancel), the column body emits an `aria-live="polite"` announcement on drop, and every status is paired with both a colored dot and a text label so colorblind users still see the state — all rules surfaced by the `ui-ux-pro-max` searches (`drag and drop kanban keyboard accessibility` returned "All functionality accessible via keyboard" as High severity, and `user story management` returned "Always show label above input" as High). Visual depth uses the Phase-1 token stack (`--bg-surface`, `--bg-elevated`, `--bg-inset`, `--border-subtle`, `--accent-primary`, etc.) bound through Tailwind in `tailwind.config.ts`, the hero band reuses the `.hero-border` animated gradient from Step 4, and loading skeletons reuse the global `.shimmer` utility from Step 6 — so the new code reads as part of the existing system rather than a parallel one. Status icons sit alongside status dots on every card and column, the WIP counter turns rose and emits a soft console warn when exceeded (no hard block), the drawer traps focus while open and restores it to the originating card on close, and `prefers-reduced-motion` is respected globally through `app/globals.css` — the audit checklist from Step 6 stays green.