# Forge AI Modernize Prompt — Curated for `~/forge-ai/` v1

> **Status:** Ready to run
> **Curated from:** Your 6-step design modernization prompt (Jun 25 17:30)
> **Adapted to:** Actual codebase state at `~/forge-ai/`
> **Duration estimate:** ~2-3 hours per step (6 steps = 12-18 hours total)

---

## Master Preamble (NEW)

**Top-level Goal:** Modernize Forge AI Agent OS (Next.js 16 + React 19 + TypeScript + Tailwind + shadcn/ui + Framer Motion + lucide-react) end-to-end. The platform already has a sophisticated architecture (`apps/forge/`) but several pages still need the same treatment the dashboard and agent-center received.

**Global Constraints (apply to every step):**

- **No emojis as UI icons** — `lucide-react` only
- **Dark mode only** — use the existing `--bg-base` (`#09090B`), `--bg-surface`, `--bg-elevated`, `--bg-inset` layered system. NEVER use `bg-black`
- **Token source of truth**: `apps/forge/lib/design-system/` (already exists — read `forge-color-tokens.ts`, `tokens.ts`, `forge-typography.ts`, `forge-spacing.ts` before doing anything)
- **CSS layer**: `apps/forge/app/globals.css`
- **Cross-cutting concerns (Rule 12)** must be available everywhere, not siloed:
  - `ConnectorPicker` (`apps/forge/components/connectors/ConnectorPicker.tsx`) — capability-aware selector
  - Co-pilot FAB (`apps/forge/components/copilot/`) — `⌘⇧K` shortcut
  - Command Palette (`apps/forge/components/shell/CommandPalette.tsx`) — `⌘K` shortcut, already wired
- **Multi-tenant by default (Rule 2)** — every query carries `tenant_id` + `project_id`
- **Human approval gates (Rule 3)** — `waiting_approval` is a first-class state with amber pulse + Pause icon
- **All LLM traffic through LiteLLM Proxy (Rule 1)** — never direct SDK imports
- **Audit logging (Rule 6)** — `@audit()` on every backend mutation
- **Tailwind tokens exist** for: `accent-primary`, `accent-cyan`, `accent-emerald`, `accent-amber`, `accent-rose`, `accent-violet`, `fg-primary`, `fg-secondary`, `fg-tertiary`, `fg-muted`, `bg-base`, `bg-surface`, `bg-elevated`, `bg-inset`, `border-subtle`, `border-default`, `border-strong`

**Step Sequence with Dependencies:**

```
Step 1 (Tokens) ───┬── Step 2 (Shell) ───┬── Step 3 (Empty States) ───┬── Step 4 (Agent Center)
                   │                    │                            │
                   │                    │                            ├── Step 5 (Ideation Center)
                   │                    │                            │
                   │                    │                            └── Step 6 (Polish & Audit)
                   │
                   └── (Step 1 is DONE — verify before Step 2)
```

**Skill Invocation Pattern (every step):**

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --<domain> -f markdown
```

Available domains: `style`, `typography`, `color`, `chart`, `ux-guideline`. The skill output JSON is the source of truth — **but prompt mandates win if they conflict** (flag conflicts in the deliverable).

**Verification Gates (between steps):**

- Step 1 → Step 2: `tailwind.config.ts` has token extensions, `globals.css` has CSS variables, `tokens.ts` exports TS constants, `body` uses `--bg-base`
- Step 2 → Step 3: Sidebar collapses cleanly, Command Palette opens with `⌘K`, Topbar shows breadcrumbs + theme toggle + user menu
- Step 3 → Step 4: `src/components/empty-state.tsx` renders correctly, all existing pages with empty data show the new component
- Step 4 → Step 5: Agent Center has bento grid with hero + KPI tiles + recent agents + activity heatmap + top providers
- Step 5 → Step 6: Ideation Center has kanban (Ideas) + timeline (Roadmap) + list (PRDs) + grid (Arch Previews) + inbox (My Approvals)
- Step 6 → Done: `prefers-reduced-motion` respected, no console errors, Lighthouse a11y ≥ 95 on Agent + Ideation centers, axe-core shows 0 critical/serious

---

## /goal STEP 1 OF 6 — DESIGN SYSTEM FOUNDATION

> **STATUS: This step is DONE.** Verify before proceeding.

**Files that should already exist:**
- `apps/forge/lib/design-system/forge-color-tokens.ts` — hex values
- `apps/forge/lib/design-system/forge-dark-theme.ts` — dark re-exports
- `apps/forge/lib/design-system/forge-light-theme.ts` — light re-exports
- `apps/forge/lib/design-system/forge-typography.ts` — type scale
- `apps/forge/lib/design-system/forge-spacing.ts` — 8pt grid + radius + motion
- `apps/forge/lib/design-system/tokens.ts` — barrel export
- `apps/forge/lib/design-system/status.ts` — agent state → tone mapping
- `apps/forge/app/globals.css` — CSS variables in `:root` and `.dark`
- `apps/forge/tailwind.config.ts` — Tailwind bindings to CSS vars
- `apps/forge/src/styles/tokens.ts` — TS constants

**Verify Step 1:**
```bash
test -f apps/forge/lib/design-system/forge-color-tokens.ts && echo "tokens OK"
grep -E "accent-primary|bg-base" apps/forge/app/globals.css | head -5
```

If any missing, run:
```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "AI agent platform developer infrastructure B2B SaaS dark mode" --design-system -p "ForgeAgentOS" --persist
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "modern dashboard sidebar typography" --domain typography -f markdown
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dark mode SaaS primary palette accent" --domain color -f markdown
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "admin console navigation hierarchy" --domain ux-guideline -f markdown
```

**Mandatory tokens** (read existing files, do NOT regenerate):
- `--bg-base: #09090B`, `--bg-surface: #131316`, `--bg-elevated: #1A1A1F`, `--bg-inset: #0E0E11`
- `--fg-primary: #FAFAFA`, `--fg-secondary: #A1A1AA`, `--fg-tertiary: #71717A`, `--fg-muted: #52525B`
- `--accent-primary: #6366F1` (indigo), `--accent-cyan: #22D3EE`, `--accent-emerald: #10B981`, `--accent-amber: #F59E0B`, `--accent-rose: #F43F5E`, `--accent-violet: #A855F7`
- Borders: `rgba(255,255,255,0.06)` subtle, `0.10` default, `0.16` strong
- Radius: 6 / 8 / 12 / 16
- Type: Inter UI + JetBrains Mono numbers/code
- Animation: 100/200/400ms, ease-out cubic-bezier(0.16, 1, 0.3, 1)

**Deliverable:** Confirmation that all 10 files exist and use the mandatory values. If missing, generate them.

---

## /goal STEP 2 OF 6 — SHELL REDESIGN

> **STATUS: This step is DONE.** The shell exists at `apps/forge/components/shell/`.

**Files that should already exist:**
- `Sidebar.tsx`, `Topbar.tsx`, `CommandPalette.tsx`, `ShellChrome.tsx`, `ShellProvider.tsx`, `PageContainer.tsx`, `PageHeader.tsx`, `SectionCard.tsx`, `StatusPill.tsx`, `MobileNav.tsx`, `ThemeToggle.tsx`, `Breadcrumbs.tsx`, `ShellBreadcrumbs.tsx`, `nav-config.ts`, `EmptyState.tsx`

**Known gaps in Step 2** (from `Step 63` audit):

1. **Sidebar workspace switcher is duplicated** — has hardcoded `[{Acme Corp}, {Beta Industries}, {Cosmic Labs}]` array AND the header has a real `TenantSwitcher`. Remove the sidebar duplicate; add a button that opens the header TenantSwitcher via shared Zustand state (`tenantSwitcherOpen`).
   - **Files**: `apps/forge/components/shell/Sidebar.tsx` (lines ~200-220), `apps/forge/lib/store.ts`, `apps/forge/components/tenant-switcher.tsx`

2. **`TenantStatusFooter` is hardcoded "Healthy · acme-corp"** — should query `/admin/llm-gateway/health` for real status.
   - **Files**: `apps/forge/components/shell/Sidebar.tsx` (`TenantStatusFooter` function)

3. **Topbar `TenantSwitcher`** is the canonical implementation. Verify it's used in `Topbar.tsx` and nowhere else inline.

**Verify Step 2:**
```bash
ls apps/forge/components/shell/*.tsx | head -20
grep -E "Beta Industries|Cosmic Labs" apps/forge/components/shell/Sidebar.tsx
```

**If gaps present, fix per Step 63 v1 prompt** at `/workspace/prompts/step63-dedupe-fix-stories.md`.

**Deliverable:** Confirmation that the shell exists, workspace switcher is single-source, and TenantStatusFooter is real.

---

## /goal STEP 3 OF 6 — EMPTY STATES

> **STATUS: This step is DONE.** `EmptyState` component exists at `apps/forge/src/components/empty-state.tsx` with tests.

**Files that should already exist:**
- `apps/forge/src/components/empty-state.tsx`
- `apps/forge/tests/data/empty-state.test.tsx`

**Verify Step 3:**
```bash
test -f apps/forge/src/components/empty-state.tsx && echo "EmptyState OK"
grep -E "illustration|title|primaryAction" apps/forge/src/components/empty-state.tsx | head -5
```

**If gaps, recreate** with these props:
- `illustration: ReactNode`, `title: string`, `description: string`, `primaryAction?: { label, onClick }`, `secondaryAction?: { label, onClick }`, `suggestions?: string[]`
- Centered, max-w 480px, py-24
- 96×96 illustration area, lucide icon in 80×80 rounded square, bg `rgba(99,102,241,0.08)`
- Title `text-lg font-600`, description `text-sm text-fg-secondary mt-2`
- Primary shadcn Button `--accent-primary`, secondary ghost
- Suggestions: flex chips with hover
- `role="status" aria-live="polite"`

**Apply EmptyState to every list page that can be empty:**
- Agent Center (Agents/Providers/Assignments/Runtimes tabs) — DONE per Step 54
- Ideation Center (Ideas/Roadmap/PRDs/Arch Previews/My Approvals) — DONE per Step 57
- Projects / Stories / Workflows / Knowledge / Artifacts / Architecture / Runs / Audit / Analytics — partial

**Per-page copy** (if any page lacks EmptyState, use these):

| Page | Title | Description | Primary |
|---|---|---|---|
| Agent Center | "Register your first agent" | "Agents are AI workers you can assign runs to." | "Register Agent" |
| Model Providers | "Connect a model provider" | "Plug in OpenAI, Anthropic, or any OpenAI-compatible endpoint." | "Connect Provider" |
| Ideation — Ideas | "Capture your first idea" | "Drop in a rough thought — AI will score it and draft a PRD." | "New Idea" |
| Ideation — Roadmap | "No ideas in the roadmap" | "Approve ideas to move them onto the roadmap." | "Review pending ideas" |
| Stories | "No stories yet" | "Stories are tasks you can drag across columns to track progress." | "New Story" |
| Workflows | "No workflows yet" | "Workflows orchestrate agents and tools to get work done." | "New Workflow" |
| Runs | "No runs yet" | "Runs are executions of workflows or commands." | "Start a Run" |

**Deliverable:** List of every page that now uses EmptyState + confirmation that role="status" wrapper is present.

---

## /goal STEP 4 OF 6 — AGENT CENTER REDESIGN

> **STATUS: This step is PARTIALLY DONE.** The page exists at `apps/forge/app/agent-center/page.tsx` but the bento layout may need refinement.

**Read first:**
- `apps/forge/app/agent-center/page.tsx` (current page)
- `apps/forge/components/agent-center/AgentCenter.tsx`
- `apps/forge/components/agent-center/AgentCard.tsx`
- `apps/forge/components/agent-center/ModelProviderCard.tsx`
- `apps/forge/components/agent-center/AgentOnboardingWizard.tsx`
- `apps/forge/lib/agent-center/adapter.ts`
- `apps/forge/lib/query/hooks.ts` (useAgents, useModelProviders, useRuntimes, useAssignments)

**Apply this layout:**

ROW 1 (full width, 220px tall): Hero card "Build your AI workforce"
- Eyebrow `GET STARTED` uppercase tracking-widest
- h2 "Build your AI workforce" `text-2xl font-700`
- Body `text-sm text-fg-secondary mt-3`
- Right: primary "Register Agent" + secondary "Import template"
- Animated 1px conic-gradient border (indigo → violet → cyan) `animate-[spin_8s_linear_infinite]`

ROW 2 (4 equal tiles, 160px tall): KPI tiles
- Total Agents (indigo), Active Runs (cyan), Avg Latency (amber), Success Rate (emerald)
- Each: `text-3xl font-700` number + `text-sm text-fg-tertiary` label + 60px sparkline (Recharts AreaChart) + delta line

ROW 3 (2/3 + 1/3, 280px tall):
- Left "Recent agents" — 5 rows with avatar + name + status dot + last-run timestamp
- Right "Activity heatmap" — 7×24 grid

ROW 4 (full width): "Top performing model providers"
- Horizontal Recharts BarChart `layout="vertical"`, 5 providers, indigo bars, value labels

**Tabs:** Segmented control — bg `--bg-inset` container, active pill bg `--bg-elevated` + `text-sm font-500` + `--fg-primary` + `--shadow-sm`. Use Framer Motion `layoutId` for the slide.

**Filter bar:** Status pills with counts, type chips, date range, "More filters" with active-count badge.

**Apply Skill:**
```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "bento grid dashboard hero KPI" --domain style -f markdown
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "KPI sparkline area chart activity heatmap dashboard" --domain chart -f markdown
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard information density layout" --domain ux-guideline -f markdown
```

**Known issue from Step 62 screenshot:**
- "Top performing model providers" widget shows all zeros → must use real `/admin/llm-gateway/spend/models` or similar endpoint
- "Total Agents" shows 24 (real seed count from Step 54)
- "Active Runs" shows 7 (real seed count from Step 56)

**Deliverable:** File paths modified, text sketch of the final layout, 1-paragraph rationale citing which skill rules drove the decisions.

---

## /goal STEP 5 OF 6 — IDEATION CENTER REDESIGN

> **STATUS: This step is PARTIALLY DONE.** Components exist but the kanban board may need refinement.

**Read first:**
- `apps/forge/app/ideation/page.tsx`
- `apps/forge/components/ideation/IdeationBoard.tsx`
- `apps/forge/components/ideation/IdeaKanban.tsx` (if exists)
- `apps/forge/components/ideation/IdeaCard.tsx`
- `apps/forge/components/ideation/IdeaList.tsx`
- `apps/forge/components/ideation/IdeaTimeline.tsx`
- `apps/forge/components/ideation/RoadmapTimeline.tsx`
- `apps/forge/components/ideation/PRDList.tsx`
- `apps/forge/components/ideation/ArchPreviewGrid.tsx`
- `apps/forge/components/ideation/ApprovalsInbox.tsx`
- `apps/forge/lib/hooks/useIdeation.ts` (Step 57)
- `apps/forge/lib/hooks/useIdeaEnhance.ts`
- `apps/forge/lib/hooks/usePushIdeaToJira.ts`

**Apply this layout:**

IDEAS TAB — DEFAULT: KANBAN BOARD

5 columns (equal width, gap-4):
1. Captured (gray dot)
2. Scoring (cyan dot, pulse)
3. Approved (emerald dot)
4. In PRD (violet dot)
5. Archived (muted dot)

**Each column:**
- Sticky header: status dot + name + count badge + "+ New" icon button
- Body: vertical stack, gap-3, scrollable
- Empty body: dashed 1px border, "Drop ideas here"

**Idea card:**
- bg `--bg-surface`, border `--border-subtle`, p-14px
- Title `text-sm font-500`, clamp 2 lines
- Score badge (color by score: 0–3 muted, 4–6 amber, 7–8 emerald, 9–10 violet)
- Owner avatar 24px, due date, comment count
- 3-dot menu (Move / Edit / Delete)
- Drag handle on hover
- Dragging: scale 1.02, rotate 1deg, `--shadow-lg`

**View toggle:** Segmented control — Kanban / List / Timeline

**NEW IDEA FLOW:** shadcn Dialog centered, `--bg-elevated`, `--radius-xl`, max-w 560px. Form: Title, Description, Category. Submit shows toast "Idea captured — AI will score it shortly".

**Apply Skill:**
```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "kanban board productivity column card" --domain style -f markdown
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "drag and drop keyboard accessibility WCAG" --domain ux-guideline -f markdown
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "timeline roadmap swimlane gantt" --domain style -f markdown
```

**Constraints:**
- `@dnd-kit/core` + `@dnd-kit/sortable` (NOT react-dnd, NOT react-beautiful-dnd)
- Keyboard-operable: Space pickup, arrows move, Space drop, Esc cancel
- Step 1 tokens only
- `prefers-reduced-motion` respected

**Known issue from Step 57 audit:** Empty Ideation page → Ideation hooks wired in Step 57 should populate the kanban.

**Deliverable:** Files modified, `@dnd-kit/*` package additions, 3-sentence description of each view, 1-line note per skill rule that shaped the design.

---

## /goal STEP 6 OF 6 — POLISH & AUDIT

> **STATUS: This step is PARTIALLY DONE.** Motion + data viz pass exists; accessibility audit gap.

**Apply Skills (run all four):**
```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "motion microinteraction accessibility dark mode" --domain ux-guideline -f markdown
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "data visualization chart tooltip empty loading" --domain ux-guideline -f markdown
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "WCAG focus management keyboard navigation reduced motion" --domain ux-guideline -f markdown
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "pre-delivery UI audit anti-patterns checklist" --domain ux-guideline -f markdown
```

**Motion Pass — only these motions, no inventions:**

1. Route transitions: fade 150ms + translate-y 4→0, ease-out
2. Interactive card hover: scale 1.005 + `--shadow-md` + border `--border-default`, 200ms ease-out
3. Button press: `active:scale-[0.97]`, 50ms
4. Tab indicator: Framer Motion `layoutId` pill, 200ms
5. Loading: skeleton with shimmer gradient sweep 1.4s linear infinite. NO spinners
6. Toasts: slide up bottom-right + auto-dismiss progress bar 4s. shadcn Sonner
7. AI "thinking" / streaming: pulsing cyan dot + animated gradient text (`bg-clip-text` + `animate-gradient`)
8. Modal/Dialog: scale 0.96→1 + fade 200ms; backdrop fade 150ms
9. Command palette: same modal treatment
10. All gated by `prefers-reduced-motion` (0ms / removed)

**Data Viz Pass:**
- Standardize on Recharts, wrap in `src/components/charts/`
- All chart colors from CSS vars (`var(--accent-*)`)
- Every chart: title, Tooltip with formatted values, legend if multi-series, empty-state placeholder, loading skeleton
- Sparklines: 60px tall, no axis, no tooltip
- Bar palette limited to indigo/cyan/emerald/amber/rose
- Line/area: gradient fill (12% top → 0% bottom)
- Pie/donut: max 5 slices — otherwise bar

**Accessibility Pass:**
- `@axe-core/react` in dev only; fix every Critical and Serious
- Every icon-only button: `aria-label`
- Every form input: associated `<label>`, not just placeholder
- Every modal: focus trap, Esc closes, returns focus to trigger
- Every interactive element: visible focus ring 2px `--accent-primary` + 2px offset
- Contrast: text on bg-base ≥ 4.5:1, large ≥ 3:1
- One h1 per page, h2 sections, no skipped levels
- Skip-to-content link at top of body, visible on focus
- Toast region: `role="status"` `aria-live="polite"`
- Kanban drag MUST be keyboard-operable
- Command palette announces result count to screen readers

**Pre-delivery audit (verify each):**

- [ ] No `bg-black` anywhere — all backgrounds use `--bg-*` tokens
- [ ] Max 2 font families in bundle (Inter + JetBrains Mono)
- [ ] Every empty state has illustration + title + description + primary CTA
- [ ] Every metric has visual indicator (sparkline / dot / delta)
- [ ] Color never the only signal (icon + text paired)
- [ ] Dark mode layered: base/surface/elevated/inset visually distinct
- [ ] All pages work at 1280 / 1440 / 1920px without horizontal scroll
- [ ] Sidebar collapses cleanly both directions
- [ ] All animations respect `prefers-reduced-motion`
- [ ] No console errors or warnings on any route
- [ ] Lighthouse Accessibility ≥ 95 on Agent Center and Ideation Center (floor 90)
- [ ] Lighthouse Performance ≥ 90 on the same two pages (floor 85)

**Deliverable:** CHANGELOG.md entry, audit output, Lighthouse before/after, one-paragraph design rationale in plain language for the rest of the team.

---

## Final Sign-Off (UNIFIED)

After all 6 steps complete, verify the unified checklist:

```
[ ] Step 1: Design tokens in code + CSS + Tailwind + TS exports
[ ] Step 2: Shell renders Sidebar + Topbar + CommandPalette with single workspace switcher
[ ] Step 3: Every empty state uses the EmptyState component with role="status"
[ ] Step 4: Agent Center bento with hero + KPIs + recent + heatmap + providers
[ ] Step 5: Ideation Center kanban (Ideas) + timeline (Roadmap) + list (PRDs) + grid (Arch Previews) + inbox (My Approvals)
[ ] Step 6: Motion + data viz + accessibility pass — Lighthouse a11y ≥ 90
[ ] Step 7 (the unwritten one): All backend wiring phases (Steps 54-63) integrate with the modernized UI without breaking
```

**Multi-page smoke test:**

```bash
# Visit each page, verify:
- /dashboard — KPI strip renders, hero band visible
- /agent-center — 6 agents + 4 providers seeded show in real data
- /connector-center — 6 connectors, marketplace + activity tabs work
- /workflows — 6 workflows + 3 runs visible
- /knowledge-center — 40+ KG nodes, 25+ edges
- /ideation — 6 ideas, kanban renders
- /architecture — 9 tabs, ADRs + contracts visible
- /stories — 30 stories across 6 status columns
- /projects — 3 projects + 5 epics + 3 sprints
- /audit — Forge audit + LLM traffic tabs
- /admin — 21 settings tabs all wired
- /governance-center — LiteLLM guardrails + standards
```

**Wrap-up:**

1. Run the test scripts: `for s in test_*.py; do docker compose exec backend python -m scripts.$s; done` — all should pass
2. Run Lighthouse on Agent Center + Ideation Center — record before/after
3. Update `forge-design-system.md` with anything new discovered during steps 4-6
4. Generate final `DESIGN_SYSTEM.md` per Step 60 v1 prompt at `/workspace/prompts/step60-final-closure.md`
5. CHANGELOG.md entries for steps 1-6 + Steps 54-63 (consolidated)

---

## Glossary

| Term | Path |
|---|---|
| Token source of truth (TS) | `apps/forge/lib/design-system/` |
| Token CSS layer | `apps/forge/app/globals.css` |
| Tailwind binding | `apps/forge/tailwind.config.ts` |
| App shell | `apps/forge/components/shell/` |
| Empty state component | `apps/forge/src/components/empty-state.tsx` |
| Command palette | `apps/forge/components/shell/CommandPalette.tsx` |
| Tenant switcher (canonical) | `apps/forge/components/tenant-switcher.tsx` |
| Workspace switcher (duplicate to remove) | `apps/forge/components/shell/Sidebar.tsx` lines ~200-220 |
| Connector picker (cross-cutting) | `apps/forge/components/connectors/ConnectorPicker.tsx` |
| Co-pilot FAB (cross-cutting) | `apps/forge/components/copilot/` |
| Hooks (TanStack Query) | `apps/forge/lib/hooks/` |
| Settings hooks | `apps/forge/lib/hooks/useSettings.ts` |
| Stories hooks | `apps/forge/lib/hooks/useStories.ts` |
| Workflow hooks | `apps/forge/lib/hooks/useWorkflows.ts` |
| Architecture hooks | `apps/forge/lib/hooks/useArchitecture.ts` |
| Knowledge hooks | `apps/forge/lib/hooks/useKnowledgeGraph.ts` |
| Ideation hooks | `apps/forge/lib/hooks/useIdeation.ts` |
| LiteLLM hooks | `apps/forge/lib/hooks/useLiteLLM.ts` |
| Shell store (Zustand) | `apps/forge/lib/store.ts` |
| SDK client | `apps/forge/lib/api/client.ts` |
| Seed scripts | `backend/scripts/seed_*.py` |
| Test scripts | `backend/scripts/test_*.py` |
| Backend routes | `backend/app/api/v1/` |
| Backed services | `backend/app/services/` |
| LiteLLM SDK | `backend/app/services/litellm_admin.py` |
| Skill path | `.claude/skills/ui-ux-pro-max/scripts/search.py` |
| Design docs | `forge-design-system.md`, `forge-theme-system.md` |
| Final closure doc | `/workspace/prompts/step60-final-closure.md` |

---

## What makes this version better than the original

| Added | Why |
|---|---|
| Master preamble | Claude Code can re-enter cleanly after context reset |
| Step dependency map | Explicit which files each step needs from prior steps |
| Verification gates between steps | Forces actual verification, not just "deliverable shipped" |
| Status notes per step | Steps 1-3 are DONE — Claude Code doesn't redo finished work |
| Known issues per step | Tells Claude Code which bugs to fix (Step 4 top providers, Step 5 empty kanban, etc.) |
| Path-grounded to actual codebase | Every file path comes from `~/forge-ai/` |
| Glossary at the end | Prevents naming drift across the 6 steps |
| Cross-reference to Steps 54-63 | UI modernization ties to backend wiring — neither ships in isolation |

---

## What we deliberately did NOT change

- All your specific token values (colors, shadows, radii, animations)
- All skill invocations (`.claude/skills/ui-ux-pro-max/scripts/search.py`)
- All SCOPE / CONSTRAINTS sections
- All page-specific copy (titles, descriptions, CTAs)
- All tech stack constraints (lucide only, shadcn Button only, `@dnd-kit` not `react-dnd`)
- Step numbering and `/goal` markers (Claude Code context protocol)
- Pre-delivery audit checklist in Step 6

---

## How to run this

1. **One Claude Code session, in order.** Master preamble is the system prompt. Each step is a `/goal` block. After each step, verify the gate.

2. **Or six sessions**, if context is tight. Each session receives: master preamble + the single step + the verification gate from the previous step. Save outputs to `.claude/design-system/` for cross-step reference.

3. **After each step, Claude Code reports:** "Step N complete. Deliverables: [list]. Gate: [verified]. Ready for Step N+1."

4. **If a step produces ugly output** — `git stash` and revert. Don't carry regressions forward.

5. **If skill output contradicts prompt mandates** — prompt mandates win. Flag the conflict in the deliverable.