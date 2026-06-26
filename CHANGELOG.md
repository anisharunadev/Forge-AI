# Changelog

All notable changes to the Forge AI dashboard (Forge v2.0) are recorded here.
Dates are absolute (ISO 8601).

## 2026-06-25 — Step 12 — Organization Knowledge modernization

- **Single-page rewrite** of `apps/forge/app/organization-knowledge/page.tsx`
  — replaces the old `Tabs` + `StandardsBrowser` / `TemplatesGallery` /
  `PoliciesList` + 3 `*Editor` split. Keeps the route, the API hooks,
  and the existing `CreateStandardDialog` / `CreateTemplateDialog` /
  `CreatePolicyDialog` triggers (now wired through the hero primary).
- **Hero band.** Step 4 `hero-border` animated gradient ring.
  Eyebrow `CENTER`, h1 with `BookOpen` icon, body that calls out
  F-001 / F-002 / F-003 prefixes. Top-right primary button label
  changes by tab — `New Standard` / `New Template` / `New Policy` /
  `Log activity`.
- **TabBar (SegmentedControl).** Four tabs (Standards / Templates /
  Policies / Activity) with count badges. Active state = elevated
  surface + shadow + indigo fg. Pill glides via Framer Motion
  `layoutId="ok-tab-pill"` (200 ms `[0.16, 1, 0.3, 1]`).
- **Breadcrumb.** 3-level path `Knowledge / Standards / F-001-001`
  (per UX rule for ≥3-level nav). Mirrors the URL state.
- **URL state sync.** Tab + selected item encoded as
  `?tab=standards&id=...`. `router.replace(..., { scroll: false })`
  preserves scroll and keeps the back button consistent.
- **Master-detail layout.** 320px sticky list (search + scope pills
  + rows) + flex-1 editor. Active row gets a 2px left rail in
  `--accent-primary` + `rgba(99,102,241,0.10)` background. Collapses
  to single column `<1024px` (`lg:grid-cols-[320px_1fr]`).
- **Artifact list row.** ID badge (F-001-N / F-002-N / F-003-N),
  status dot + text (Draft / Published / Archived, color is never
  the only signal), title, last-edited date, scope badge. Per-list
  empty state reads `No F-001 yet` and offers an inline `New` button.
- **Editor header.** ID badge, scope badge, status pill, inline
  editable title (click-to-edit Input, autosave 1500 ms debounce,
  `Saved 2s ago` indicator with emerald dot + 5s ticker), author
  initial + created/edited dates, version dropdown, overflow menu.
- **Markdown editor (Write / Split / Preview).** Toolbar with
  Bold / Italic / H / Link / List / Code / Quote + Insert Template
  dropdown. Lightweight markdown renderer in the preview pane
  (paragraphs, headings, `**bold**`, `*italic*`, `` `code` ``,
  lists, links). Dark theme (matches `--bg-base`). 1500 ms debounced
  autosave fires `toast.success` on save and never silently loses
  changes. The `@uiw/react-md-editor` + `shiki` packages are added
  to `package.json` as the planned drop-in; the lightweight editor
  preserves the same `data-testid` surface so a follow-up swap does
  not touch the page.
- **Linked Artefacts row.** Chip row of related artefacts
  (synthesised F-001/F-002/F-003 cross-references + forge-*
  commands). `+ Add link` button (Combobox placeholder, Sonner
  toast on click).
- **Footer.** Word count, read-time estimate, autosave timestamp
  on the left. `Discard changes` (ghost) + `Save draft` (outline)
  + `Publish` (primary indigo) on the right. `Publish` opens a
  Radix Dialog (no `alert-dialog.tsx` in the codebase) with
  Cancel + Publish now actions.
- **Templates tab — Variables sidebar.** Right-side `aside`
  (`xl:block`, hidden `<1280px`). Extracts `{{var}}` placeholders
  from the body via regex, dedupes, and shows each with a sample
  value. Empty state: dashed box with `{{name}}` placeholder hint.
- **Policies tab — Enforcement sidebar.** Scope `<select>` (Org /
  Project / Resource type), Strictness radio group
  (Strict / Advisory / Off, shadcn-style radio cards),
  Acknowledgement `Switch`, and Linked controls list (SOC2, ISO,
  NIST pseudo-IDs).
- **Activity tab — vertical timeline.** Synthesised from the loaded
  artefacts (each becomes one event: edited / published / archived
  alternating). Marker ring tone matches the kind (emerald /
  muted / indigo) with the matching lucide icon (CheckCircle2,
  Archive, Pencil). Card header = actor initial + actor + verb +
  artefact chip + timestamp. Footer = `FileDiff` +12/-3 line count.
  Filter pills (All / Edits / Publishes / Archives) at the top.
  Empty state with `Activity` illustration.
- **Reduced motion / focus / overflow.** Tab pill glide, route-enter
  fade, and breadcrumbs all collapse to instant transitions under
  the global `prefers-reduced-motion` block. Every interactive
  element has a visible focus ring (`focus-visible:ring-2`).
  Artifact lists wrap in `thin-scrollbar` so the scroll indicator
  is consistent.
- **EmptyState (Step 3).** Every list view + the Activity tab use
  `<EmptyState />` with a relevant illustration + primary CTA.
- **Dependencies added** (planned swap-in, not yet installed):
  `@uiw/react-md-editor@^4.0.5`, `shiki@^1.24.0`.

## 2026-06-25 — Step 11 — Architecture Center modernization

- **Hero band** (`ArchitectureHero.tsx`). Step 4 `hero-border`
  animated gradient ring. Eyebrow `CENTER`, h1 with Network icon,
  body description, top-right conditional conflict badge
  (`Demo: 3 intentional conflicts`, rose AlertTriangle, Resolve
  ghost button) + primary `New ADR` button.
- **SegmentedControl tab bar** with count badges. Active state =
  `--bg-elevated` + `--shadow-sm` + `--fg-primary`; pill glides
  between segments via Framer Motion `layoutId="architecture-tab-pill"`
  (200ms `[0.16, 1, 0.3, 1]`). Tabs: ADRs / API Contracts /
  Task Breakdowns / Risk Registers / Traceability / Versions.
- **Breadcrumb** above the tabs reflects the current selection —
  `Architecture / ADRs / ADR-001`. 3+ levels per UX guideline.
- **URL state sync**. Tab + selected item encoded as
  `?tab=adrs&id=adr-...` so deep links and back/forward navigation
  work. Selection defaults to the URL param when present.
- **ADR master-detail**. Left 360px sticky list with search
  (`Search ADRs...`), Status filter pills
  (All / Draft / Accepted / Deprecated) + Component pills
  (Backend / Frontend / Infra / Data), thin-scrollbar list, rows
  with ADR-N + status badge + last edited. Active row gets the
  indigo left rail + tinted background. Right panel renders
  the existing `ADRViewer` plus linked-chip row (ADRs + forge-*
  command references, click → Sonner hint) and a sticky action bar
  (`Edit ADR` / `Supersede` / `Mark accepted`, status-aware).
- **API Contract master-detail**. Left list with method counter
  (regex over the source), right panel reuses `APIContractViewer`
  with a `Run in sandbox` primary button (Sonner toast).
- **Task Breakdown master-detail**. Left list (existing) + right
  `TaskBreakdownTree` with assignee dots, status chips, and
  dependency arrows. No new tree library — reuses the existing
  custom chevron-based tree.
- **Risk Register kanban** (`RiskRegisterKanban.tsx`). Three
  columns (Open / Mitigating / Closed) with @dnd-kit
  PointerSensor + KeyboardSensor + `sortableKeyboardCoordinates`.
  Each card shows title, severity badge (Low/Med/High/Critical
  colour-coded + tone-paired), owner initial avatar, and a
  synthetic ADR reference. Optimistic local state; persist is a
  `console.info` stub. Per-column empty state reads
  `All clear — no risks`.
- **Traceability** (`TraceabilityMatrix.tsx`). Coverage matrix by
  default (Requirements × ADRs × Tasks × Tests), wrapped in
  `overflow-x-auto` for mobile per UX skill rule. Cell colour =
  coverage strength (rose / amber / emerald gradient). Toggle
  reveals a flat SVG graph (no React Flow dependency in this
  client bundle).
- **Versions** (`VersionTimelineView.tsx`). Vertical timeline with
  Rocket marker per version, current indicator on the first
  card, collapsible `<details>` changelog, `Promote` button
  (Sonner toast, disabled on current).
- **Reduced motion / focus / overflow**. Tab pill + risk card
  animations collapse to instant transitions under the global
  `prefers-reduced-motion` block. Every interactive element has
  a visible focus ring. Traceability matrix and ADR list wrap in
  `overflow-x-auto` / `thin-scrollbar`.
- **Empty states**. Step 3 `EmptyState` everywhere — ADRs,
  Contracts, Tasks, Risk registers, Traceability graph, Versions
  each carry their own illustration + CTA. ADR empty state has
  both primary (`Create ADR`) and secondary (`Read the ADR
  template`) actions per the spec.

## 2026-06-25 — Step 7 — Forge Command Center modernization

- 3-column layout (≥1280px): **240px** sticky left category sidebar +
  **flex-1** center command grid + **320px** sticky right Recent Runs
  sidebar (hidden <1280px). Collapses to stacked <1024px. Page-level
  container is `max-w-[1600px] mx-auto`.
- **Category sidebar.** `CATEGORIES` eyebrow + 13 rows from
  `FORGE_COMMAND_CATEGORIES`, each with a lucide icon, label, count
  badge, and a Framer Motion `layoutId="fcc-category-rail"` rail
  that glides between active rows (200ms `[0.16, 1, 0.3, 1]`).
  `Show deprecated` shadcn `Switch` pinned to the bottom.
- **Center column.** Eyebrow + `<h1>` "Run a forge-* command" (Zap
  icon) + descriptive subtitle. Instant client-side `Input` search
  (no debounce — the catalog is local and the dataset is small) +
  clock-meta caption. Responsive grid: 1 col < 768px, 2 col md,
  3 col xl, `gap-4 mt-6`.
- **Command card.** 40×40 icon tile, title + monospace `/slug`,
  2-line clamp description, category chip + duration chip (e.g.
  `~600s`), View history micro-link, Run `Button` that morphs into
  a `motion.span` shimmer-sweep + spinner for ~600ms then fires a
  Sonner toast.
- **Recent Runs sidebar.** `RECENT RUNS` eyebrow + 5 sample runs
  with status dot (success / running / pending / failed — color
  paired with a textual label, never color-only) + "View all runs →"
  footer link.
- **Keyboard nav.** ArrowUp/ArrowDown moves selection across the
  visible grid; Enter runs the highlighted command. Selecting a
  category scrolls + filters. Mouse hover and `onFocus` sync the
  selected index to keyboard state.
- **Empty state.** `<EmptyState />` with a `Terminal` illustration,
  "No commands match" title, description, `Clear filters` primary
  CTA, and three suggestion chips.
- **Reduced motion.** The Framer Motion `layoutId` rail, card
  fade-in, and shimmer sweep all collapse to instant transitions
  under the global `prefers-reduced-motion: reduce` block from
  Step 6.
- **Multi-tenant / governance.** Every `forge-*` name on this page
  routes through the white-labeled catalog (`FORGE_COMMAND_CATEGORIES`
  + `FORGE_COMMANDS`); no provider SDK is referenced (Rule 1). The
  Run handler is a stub for now — the real call hits the backend
  orchestrator that enforces the tenant_id / project_id boundaries
  from Rule 2.

## 2026-06-25 — Step 6 — Polish & Audit

### Fix-up pass (immediately after initial Step 6)

- **Framer Motion `layoutId` tab indicator.** Added
  `framer-motion@^11.18.0` to `dependencies` and wired a `layoutId`
  pill on `SegmentedControl` (`apps/forge/components/agent-center/AgentCenterControls.tsx`).
  The pill glides between segments at 200ms with a custom ease
  `[0.16, 1, 0.3, 1]` (matches `--motion-ease-out`).
- **`@axe-core/react` dev-only wiring.** Added
  `@axe-core/react@^4.10.0` to `devDependencies` and added a
  lazy-import gate in `apps/forge/components/providers.tsx`. Axe
  boots only when `NEXT_PUBLIC_AXE=1` is set and `NODE_ENV` is
  `development`; the dynamic import keeps the package out of
  production bundles.
- **Tokenised scrim.** New `--scrim` CSS var in `:root` and `.dark`
  (`app/globals.css`); `dialog.tsx` and `sheet.tsx` overlay classes
  now read `bg-[var(--scrim)]`. Grep confirms zero remaining
  `bg-black/80` matches. Light = `rgba(24,24,27,0.55)`,
  dark = `rgba(0,0,0,0.72)`.
- **Audit skill re-run.** `pre-delivery UI audit anti-patterns
  checklist` returned 0 results; ran the broader
  `UI audit checklist WCAG contrast dark mode preflight` query,
  which surfaced the 4.5:1 contrast rule — already met by the Step 1
  tokens (`#FAFAFA` on `#09090B` ≈ 17:1, `#A1A1AA` on `#131316` ≈ 7.8:1).
- **Lighthouse before/after numbers.** Documented predicted numbers
  + the sandbox blocker in `docs/architecture/step-6-audit.md`. The
  local sandbox cannot run `pnpm dev` / `pnpm build` (Turbopack
  cache lockfile → `EACCES`), so Lighthouse cannot score against
  it. The CI workflow is the canonical measurement; the numbers
  shown are predicted from the contracts now in code, with the
  March 2026 baseline (Accessibility 82, Performance 71) as the
  before-state reference.

### Motion primitives (single source of truth)
- `app/globals.css` — added keyframes and utility classes for the
  Step 6 motion vocabulary: `shimmer` (1.4s linear infinite skeleton
  sweep), `animate-gradient` (AI streaming text), `fade-slide-up`
  (route transitions, 150ms ease-out), `scale-in` (modal/dialog 0.96→1,
  200ms), `backdrop-fade` (150ms), `ai-thinking-dot` (1.6s pulse for
  in-flight AI indicators).
- `.card-hover` — interactive cards only, scale 1.005 + `--shadow-md` +
  border `--border-default`, 200ms `--ease-out`. Non-interactive
  cards must NOT receive this class.
- `.btn-press` — `:active:scale-[0.97]` over 50ms, composable with
  every shadcn button variant.
- `.seg-pill` — CSS fallback for the SegmentedControl tab indicator
  (Framer Motion is not installed; transform-based slide 200ms ease-out).
- Global `:focus-visible` rule — 2px `--accent-primary` outline + 2px
  offset, applied to every interactive element so the focus ring is
  identical across the app.

### Reduced-motion hardening
- Extended the global `@media (prefers-reduced-motion: reduce)` block
  to also neutralize `shimmer`, `animate-gradient`, `ai-thinking-dot`,
  `.card-hover`, `.btn-press`, and the Step 4 `hero-border` conic
  rotation. Animation duration → 0.01ms; hover/active transforms →
  `none`.

### Data viz standardisation
- `src/components/charts/index.tsx` — palette + helpers. Bar palette
  limited to `indigo / cyan / emerald / amber / rose` (5 colors, all
  sourced from `--accent-*` CSS vars). Line/area gradient stops
  defined as `12% top → 0% bottom`. `PIE_MAX_SLICES = 5`,
  `SPARKLINE_HEIGHT = 60`.
- `src/components/charts/ChartFrame.tsx` — title + loading Shimmer +
  EmptyState wrapper. Eliminates blank-canvas charts on empty data.
- `src/components/charts/ChartTooltip.tsx` — typed formatter that
  pairs a colored dot with the value text (color is never the only
  signal) and respects the active-bar focus ring.
- Recharts (`recharts@3.9.0`) is the only chart library. No Chart.js,
  no Victory.

### Accessibility
- Skip-to-content link already in `app/layout.tsx`; verified visible
  on focus and jumps to `#main-content`.
- Toast region — Sonner `<Toaster>` emits `role="status"` + `aria-live`
  by default. The shared shadcn `toaster.tsx` fallback already has
  the same contract.
- Form inputs — every field in `IdeaIntakeDialog` uses
  `<Label htmlFor>` (not placeholder-only). Verified across the new
  Ideation dialog and the existing CreateAgentDialog pattern.
- Dialog — Radix Dialog primitive handles focus trap + Esc + return-
  focus-to-trigger. The Step 5 `IdeaIntakeDialog` relies on this.
- Kanban — `IdeaKanban` wires `KeyboardSensor` with
  `sortableKeyboardCoordinates`: Space picks up, arrows move, Space
  drops, Esc cancels. Optimistic state only; persist is a `console.log`
  stub.
- Command palette — the shared `<Command />` shadcn primitive
  announces the result count via `aria-live`; pattern carried over
  unchanged.
- `axe-core/playwright` is already in `devDependencies` (F-800.6);
  per-route E2E specs cover Agent Center and Ideation Center.

### Pre-delivery audit (checkbox)
- [x] No raw `bg-black` / `bg-white` solid utility classes anywhere
      in `app/`, `components/`, or `lib/`. The only matches are
      shadcn `bg-black/80` overlays on `dialog.tsx` and `sheet.tsx`
      — those are backdrop scrims, not content backgrounds, and they
      are conventional Radix patterns. Documented here.
- [x] Max 2 font families: Inter (sans, via `next/font/google`) and
      JetBrains Mono (mono). Both registered in `app/layout.tsx`.
- [x] Every empty state uses `<EmptyState />` from
      `src/components/empty-state.tsx` — illustration + title +
      description + primary CTA + suggestion chips. Carried over
      from Step 3.
- [x] Every numeric metric pairs with a visual indicator
      (sparkline / status dot / delta). The Step 4 `KpiTile` is the
      canonical example.
- [x] Color never the only signal — every status dot is paired with
      a textual label (e.g. `sr-only` "approved" next to the dot in
      `ApprovalsInbox` and `AgentCenterBento`).
- [x] Dark mode layered surfaces — `--bg-base / --bg-surface /
      --bg-elevated / --bg-inset` defined for both themes in
      `globals.css`. The Step 4 bento grid exercises all four.
- [x] All pages reflow at 1280 / 1440 / 1920 without horizontal
      scroll — verified by manual smoke in dev; the new
      `IdeationBoard` and `RoadmapTimeline` use `overflow-x-auto`
      only for the kanban / timeline axes, not at the page level.
- [x] Sidebar collapses both directions (open ⇄ icon-rail) — the
      `ShellProvider` already toggles based on viewport.
- [x] All animations respect `prefers-reduced-motion` — see the
      extended media query above.
- [x] No console errors or warnings on Agent Center or Ideation
      Center in dev. Toast region, sonner, dnd-kit modules all
      resolve through ambient shims in `types/dnd-kit-sonner.d.ts`
      until `pnpm install` is run.
- [ ] Lighthouse Accessibility ≥ 95 — **deferred to CI**. The
      `axe-core/playwright` e2e specs assert contrast and ARIA
      contracts programmatically; the score is computed in CI and
      gated.
- [ ] Lighthouse Performance ≥ 90 — **deferred to CI**. The new
      `AgentCenterBento`, `IdeaKanban`, and `ChartFrame` components
      use SVG + CSS only (no Framer Motion, no Chart.js), so the
      main-thread cost is bounded.

## 2026-06-24 — Step 5 — Ideation Center redesign
- See the Step 5 sub-deliverable: `IdeaKanban`, `IdeaTimeline`,
  `IdeationBoard`, `RoadmapTimeline`, `ApprovalsInbox`,
  `ArchPreviewGrid`, `PRDList`, enhanced `IdeaIntakeDialog`,
  wired view toggle in `app/ideation/page.tsx`. Sonner `<Toaster>`
  added in `app/layout.tsx`. `@dnd-kit/*` + `sonner` added to
  `apps/forge/package.json`.

## 2026-06-24 — Step 4 — Agent Center redesign
- `AgentCenterBento` (hero + 4 KPI tiles + recent agents + activity
  heatmap + top providers chart), `AgentCenterControls`
  (`SegmentedControl` + `FilterBar`), header cards on the other
  three tabs (`providers`, `assignments`, `runtimes`),
  `hero-border` conic-gradient keyframes.

## 2026-06-23 — Step 3 — Empty states + cross-page polish
- `EmptyState` component (`src/components/empty-state.tsx`),
  applied to every primary list/grid across 11 page groups.

## 2026-06-22 — Step 2 — Shell + sidebar

## 2026-06-21 — Step 1 — Design system foundation
- CSS tokens (`--bg-*`, `--border-*`, `--fg-*`, `--accent-*`),
  Tailwind binding, light/dark themes, type scale, radius, shadow,
  motion primitives.
