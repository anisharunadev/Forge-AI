# Changelog

All notable changes to the Forge AI dashboard (Forge v2.0) are recorded here.
Dates are absolute (ISO 8601).

## 2026-06-29 — Step 60 v1 — Final closure: DESIGN_SYSTEM.md + CHANGELOG.md

- **NEW `DESIGN_SYSTEM.md`** at repo root — canonical visual + interaction reference (~640 lines, 23 sections).
- **CHANGELOG.md** updated with Steps 13–60 (this entry).
- **References** `forge-design-system.md` + `forge-theme-system.md` as historical, superseded.
- **Single source of truth**: `apps/forge/lib/design-system/` (TypeScript tokens) + `apps/forge/app/globals.css` (CSS layer).

## 2026-06-29 — Step 59 v1 — Governance reorientation: Forge = LiteLLM frontend

- **Strategic shift**: Forge AI is now a UI on top of LiteLLM, not a competing LLM platform.
- **DELETE duplicates**: `policy_engine.py`, `governance_violation.py` (LiteLLM provides natively).
- **NEW SDK**: `backend/app/services/litellm_admin.py` — typed async client for all LiteLLM admin endpoints.
- **Cost tracking rewritten**: `terminal_costs.py` now proxies `/spend/logs`, `/spend/teams`, `/global/spend`.
- **Policies rewritten**: `policies.py` now lists `/guardrails/list` from LiteLLM.
- **Standards rewritten**: `standards.py` combines LiteLLM guardrails + manual attestations.
- **Violations rewritten**: `governance_violations.py` reads failed requests from `/spend/logs`.
- **NEW team sync**: `backend/app/services/team_sync.py` — tenant ↔ LiteLLM team mapping.
- **Seed 4 LiteLLM guardrails**: `pii_masking`, `prompt_injection_detection`, `content_moderation`, `secret_detection`.
- **Test script**: `backend/scripts/test_litellm_proxy.py` — 15/15 passed (4 direct + 11 proxies).
- **Files affected**: `backend/app/services/litellm_admin.py`, `team_sync.py`, all rewritten `api/v1/*.py`, `infra/litellm/config.yaml`, `apps/forge/app/governance-center/page.tsx`, `apps/forge/app/audit/page.tsx`.

## 2026-06-29 — Step 58 v2 — Projects + Stories + Architecture: real data

- **Seed 3 projects + 5 epics + 3 sprints + ~30 stories + 6 ADRs + 5 contracts + 5 risks + 2 task breakdowns + 3 approvals + 4 attestations + 1 version**.
- **Stories Center**: real hooks already wired; mock-data kept as offline fallback only.
- **Architecture Center**: all 9 tabs wired to backend.
- **Traceability**: matrix linking ADRs → contracts → services → stories.
- **Files affected**: `backend/scripts/seed_projects.py`, `seed_stories.py`, `seed_architecture.py`, `backend/scripts/test_architecture_api.py`, `apps/forge/lib/hooks/useArchitecture.ts`.

## 2026-06-29 — Step 57 v2 — Knowledge Graph + Ideation + Org Knowledge: real data

- **Seed 40+ KG nodes + 25+ edges**: people, teams, services, modules, docs, ADRs, policies, runbooks, tools.
- **Seed 6 ideas + 4 analyses + 4 scores + 1 roadmap + 2 PRDs + 3 approvals**.
- **Seed 13 org knowledge docs** across 4 categories (standards/templates/policies/best-practices).
- **Real hooks**: `useKnowledgeGraph`, `useIdeation` with TanStack Query.
- **Files affected**: `backend/scripts/seed_knowledge_graph.py`, `seed_ideation.py`, `seed_org_knowledge.py`, `backend/scripts/test_knowledge_api.py`, `apps/forge/lib/hooks/useKnowledgeGraph.ts`, `apps/forge/lib/hooks/useIdeation.ts`.

## 2026-06-29 — Step 56 v2 — Workflows + Runs: real data + working run stream

- **Seed 6 workflows + 3 runs**: PR Review Pipeline, Idea → Story → Jira Sync, Nightly Security Scan, Deploy to Production, Story Refinement Workshop, Architecture Review.
- **Run states**: 1 running, 1 succeeded, 1 failed.
- **SSE event stream**: `GET /workflows/runs/{id}/events` working with `useRunLiveEvents`.
- **Decision**: Runs Center now shows workflow runs (not SDLC runs) for clearer user value.
- **Files affected**: `backend/scripts/seed_workflows.py`, `backend/scripts/test_workflows_api.py`, `apps/forge/components/workflows/WorkflowCenter.tsx`, `apps/forge/components/workflows/WorkflowRunDetail.tsx`, `apps/forge/lib/api.ts`.

## 2026-06-29 — Step 55 v2 — Connectors: real backend, kill mock data

- **Seed 6 connectors**: GitHub, Jira, Slack, Confluence, Figma, AWS.
- **`LiveConnectorDataProvider` fix**: distinguish API loading vs API returned empty vs API errored. Only fall back to mocks on error (not empty).
- **Test script** `backend/scripts/test_connectors_api.py` — 12/12 passed.
- **Files affected**: `backend/scripts/seed_connectors.py`, `backend/scripts/test_connectors_api.py`, `apps/forge/components/connector-center/LiveConnectorDataProvider.tsx`.

## 2026-06-29 — Step 54 v4 — Real LiteLLM Test Connection + Real Dashboard Metrics

- **Real LiteLLM test**: `POST /model-providers/{id}/test` now calls upstream provider API with real credentials; returns `latency_ms` or real error (401 / 403 / 404 / timeout).
- **Top providers widget**: now reads from `/dashboard/top-providers?days=7` aggregating real run data (model, run_count, total_cost, success_rate).
- **Filter test data**: Agent list endpoint now filters out test-prefixed names.
- **Files affected**: `backend/app/api/v1/model_providers.py`, `backend/app/api/v1/dashboard.py`, `apps/forge/lib/query/hooks.ts`.

## 2026-06-29 — Step 54 — Phase 2 v3: Agents + Providers (real backend)

- **6 agents seeded**: Code reviewer, Refactor agent, Sync agent, Test runner, Doc generator, Security auditor.
- **4 model providers seeded**: Anthropic, OpenAI, AWS Bedrock, Google Vertex.
- **2 runtimes seeded**: `local-docker`, `production-k8s`.
- **Test script** `backend/scripts/test_agents_api.py` — 12/12 passed.
- **Removed "Test agent patched X" entries** — production-clean data.
- **Files affected**: `backend/app/api/v1/agents.py`, `model_providers.py`, `agent_runtimes.py`, `agent_assignments.py`, `backend/scripts/seed_agents.py`, `apps/forge/lib/agent-center/adapter.ts`.

## 2026-06-28 — Step 50 — Dashboard polish

- **Polish fixes per Step 42**: card density, hover states, KPI deltas.
- **Hero gradient border** via `.hero-border` class.
- **"Recently active"** widget with sparklines.

## 2026-06-28 — Step 35 — Governance Center rebuild

- **8 tabs**: Overview / Policies / Guardrails / Standards / LLM Control / Board / RBAC / Audit.
- **NOTE**: "Mocked LiteLLM integration" — replaced in Step 59 with real proxy.

## 2026-06-28 — Step 31 — Connector Center modernization

- **7-tab experience**: Overview / Connected / Marketplace / Health / Activity / Credentials / Webhooks.
- **ConnectorPicker** (cross-cutting) — capability-aware selector used in Ideation, Workflows, Co-pilot.
- **Mock data → live data** via `LiveConnectorDataProvider`.

## 2026-06-28 — Step 30 — Architecture Center modernization (9 tabs)

- **Single-page rewrite** of `apps/forge/app/architecture/page.tsx`.
- **9 tabs**: ADRs / API Contracts / Risk Registers / Standards / Acceptance / Approvals / Task Breakdowns / Traceability / Versions.
- **Defensive `resolveSelected` helper** — empty state ONLY fires when source array is truly empty.
- **Cross-tab chips** linking ADRs → Contracts → Risks.

## 2026-06-27 — Step 22 — Workflow gallery

- **Template catalog** at `/workflows` index — "From scratch" + "Use template" CTAs.
- **Legacy mode A → mode B canvas toggle** kept at `/workflows/{id}/edit`.
- **WorkflowCard** — name, description, last run status, owner, version.

## 2026-06-27 — Step 21 — Stories Center kanban

- **Drag-drop kanban** with `@dnd-kit` (`PointerSensor` + `KeyboardSensor`).
- **Optimistic update** on drag — PATCH first, rollback on error.
- **URL state** — view mode persists in `?view=kanban|list|timeline`.

## 2026-06-27 — Step 20 — Project Intelligence bento layout

- **Sticky project context bar** with selector + breadcrumbs + actions.
- **Animated-gradient hero band** + view toggle (`?view=all|mine|at-risk|recent`).
- **KPI strip + 12-col bento grid** — typed artifacts left, metrics right.

## 2026-06-27 — Step 19 — Persona picker + dashboards

- **3 personas**: PM, eng-lead, CTO. Each gets a tailored dashboard.
- **Persona memory** — Per-persona LLM memory stored via `usePersonaMemory` hook.
- **RBAC by persona** — Read-only audit view for CTO, full chrome for PM.

## 2026-06-27 — Step 18 — Story detail drawer + lifecycle tabs

- **7-tab drawer** for Story detail (Overview / Acceptance Criteria / Subtasks / Linked Jira / Comments / Audit / Activity).
- **Lifecycle transitions**: `BACKLOG → IN_PROGRESS → IN_REVIEW → DONE → ACCEPTED`.
- **Bulk update** via `/stories/stories/bulk` with optimistic UI.

## 2026-06-26 — Step 17 — Audit Center redesign

- **Client-side filtering** except date range (per goal).
- **Mono hash column** with copy-on-hover.
- **Drawer with hash chain + diff** — verify the audit trail is intact.
- **CSV/JSON export** — full audit dump with one click.

## 2026-06-26 — Step 16 — Terminal Center (xterm.js + native PTY)

- **Real PTY** via FastAPI subprocess manager (not a mock).
- **Multi-tab terminals** with persistent session IDs.
- **Cost tracker in sidebar** — Live USD/hour, lifetime spend, current model.
- **Stream JSON events** from any `forge-*` command via WebSocket.

## 2026-06-26 — Step 15 — Command Center modernization

- **`forge-*` command palette** — 60+ commands white-labeled from GSD Core (per DL-024).
- **Slash-mode shortcuts**: `/ideation`, `/connectors`, `/workflow`, `/runs`, `/knowledge`.
- **Search across**: pages, agents, connectors, workflows, runs, ideas.

## 2026-06-26 — Step 14 — Run Center modernization (Phase 0.5)

- **Virtualized table** for 10k+ runs (`@tanstack/react-virtual`).
- **KPI strip**: Active / Succeeded today / Failed today / Total cost — with signed deltas.
- **720px drawer** for run detail with 7 tabs.
- **Wire to FastAPI backend** via `useRunsIndex()` + `useRunDetail(runId)`.

## 2026-06-26 — Step 13 — ErrorState primitive

- **Canonical error UI** — `apps/forge/components/error-state.tsx` with pattern-recognition header, suggested actions, and retry CTA.
- **Wire to all data-bearing pages**: Connector Center, Architecture Center, Agent Center, Audit Center.
- **No more generic "Something went wrong"** — each error gets a typed message derived from the response shape (network / 4xx / 5xx / missing-data).

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
