# Step 60 v1 — Final Closure: DESIGN_SYSTEM.md + CHANGELOG.md

> **Status:** Ready to run
> **Workspace:** `~/forge-ai/`
> **Duration estimate:** ~30 minutes
> **Phase:** Final closure (Step 60 of 60)

---

## /goal

Consolidate the work from all 6 wiring phases (Steps 54-59) into two canonical artifacts:

1. **DESIGN_SYSTEM.md** — the canonical visual + interaction reference (new comprehensive doc)
2. **CHANGELOG.md** — append the phases (Steps 13-60) to the existing changelog

These aren't new code — they're the documentation layer that makes the work discoverable. After this step, anyone joining the project should be able to read these two files and understand:
- What the design system is (colors, type, spacing, motion, patterns)
- What shipped in each phase (from Phase 1 OIDC to Phase 6 governance reorientation)

---

## Files to read FIRST

Before writing anything, read these to understand existing structure and style:

- `CHANGELOG.md` (351 lines, format established)
- `forge-design-system.md` (374 lines, the existing design doc)
- `forge-theme-system.md` (theme architecture)
- `docs/design-system-curate.md` (281 lines, design vision)
- `apps/forge/lib/design-system/forge-color-tokens.ts` (color source of truth)
- `apps/forge/lib/design-system/tokens.ts` (token source)
- `apps/forge/lib/design-system/forge-dark-theme.ts`
- `apps/forge/lib/design-system/forge-light-theme.ts`
- `apps/forge/lib/design-system/forge-typography.ts`
- `apps/forge/lib/design-system/forge-spacing.ts`
- `apps/forge/app/globals.css` (CSS layer)
- `apps/forge/tailwind.config.ts` (Tailwind binding)
- `README.md` (project positioning)
- `implementation_plan.md` (rules + tech stack)
- `docs/ARCHITECTURE.md`
- `docs/CHARTER.md`

---

## INVOKE THE SKILL BEFORE WRITING

```
python3 -c "import webbrowser; webbrowser.open('https://www.markdownguide.org/basic-syntax/')"
python3 -c "import webbrowser; webbrowser.open('https://keepachangelog.com/en/1.1.0/')"
```

Read the "Keep a Changelog" conventions for the changelog format.

---

## Adopt every rule, then build in this order

### ZONE 1 — DESIGN_SYSTEM.md STRUCTURE

The file `forge-design-system.md` already exists (374 lines). The new `DESIGN_SYSTEM.md` (note: uppercase, no forge- prefix) is a CONSOLIDATED version that:

1. Absorbs everything from `forge-design-system.md` + `forge-theme-system.md` + `docs/design-system-curate.md`
2. Adds the new patterns from Steps 54-59 (live data wiring, real-time updates, approval gates)
3. Documents the cross-cutting concerns (ConnectorPicker, Co-pilot FAB, ⌘K Command)
4. Includes a section on Phase 6's reorientation (LiteLLM proxy pattern)

CREATE `DESIGN_SYSTEM.md` at the repo root (NOT inside apps/forge — this is a cross-cutting doc):

---

# Forge AI Design System

> **The canonical visual + interaction reference for Forge AI Agent OS.**
> Status: Living document — last updated 2026-06-29
> Source of truth: `apps/forge/lib/design-system/` (TypeScript tokens)
> CSS layer: `apps/forge/app/globals.css`

---

## 1. Positioning

Forge AI is the operating system that orchestrates agents, knowledge, governance, and delivery workflows. Its design system exists to make that orchestration **visible** — to answer at a glance:
- What agents are running (AgentCard on every list)
- What agents are thinking (AgentTimeline with reasoning summaries)
- What the cost is (CostTracker in sidebar, not buried in settings)
- What is blocked (waiting_approval badges, no silent stops)
- What is deployable (Build status with green/red pills)

**Visual references:** Linear × Vercel × GitHub × Cursor × Anthropic Console.

## 2. Brand personality

- **Intelligent** — every signal means something; no decoration
- **Technical** — built for engineers; no marketing flourish
- **Premium** — enterprise-grade spacing, motion, and detail
- **Fast** — every interaction feels instant
- **Autonomous** — users supervise agents rather than perform manual work
- **Futuristic** — without looking like science fiction

## 3. Constitutional design rules

These map to the constitutional rules in `CLAUDE.md` and `implementation_plan.md`. Every screen must honor them:

| # | Rule | Implementation |
|---|---|---|
| 1 | No emojis as UI icons | `lucide-react` only — every icon from the library |
| 2 | Multi-tenant by default | Tenant switcher in shell; project_id always visible |
| 3 | Human approval gates | `waiting_approval` state is a first-class visual primitive (amber pulse) |
| 4 | Typed artifacts only | Each artifact type has a dedicated icon + color |
| 5 | Layer isolation | Org Knowledge vs Project Intelligence boundaries visible in chrome |
| 6 | Mandatory auditability | Audit log accessible from every page (sidebar link) |
| 7 | Mandatory observability | OpenTelemetry traces linkable from any error state |
| 8 | Configurable everything | Provider pill in header (Anthropic / OpenAI / etc.) always editable |
| 9 | forge-core canonical | Skill/agent names prefixed `forge-*`, never `gsd-*` or `open-gsd-*` |
| 10 | forge-pi for product intelligence | Idea analysis lives in forge-pi, not in ad-hoc services |
| 11 | forge-browser for visual automation | Visual flows use forge-browser, never direct Playwright |
| 12 | Cross-cutting concerns everywhere | ConnectorPicker, Co-pilot FAB, ⌘K Command are global |

## 4. Color system

### 4.1 Brand palette

| Token | Hex | Usage |
|---|---|---|
| `--accent-primary` | `#6366F1` | Indigo — primary actions, active states, focus rings |
| `--accent-cyan` | `#22D3EE` | Cyan — secondary highlights, success states |
| `--accent-emerald` | `#10B981` | Emerald — success, healthy, completed |
| `--accent-amber` | `#F59E0B` | Amber — warnings, waiting_approval, pending |
| `--accent-rose` | `#F43F5E` | Rose — errors, failed, quarantined |
| `--accent-violet` | `#A78BFA` | Violet — special, persona, archived |

### 4.2 Layered surfaces

| Token | Hex | Usage |
|---|---|---|
| `--bg-base` | `#09090B` | Page background — near-black slate (NOT pure black) |
| `--bg-surface` | `#18181B` | Cards, panels — one layer above base |
| `--bg-elevated` | `#27272A` | Modals, popovers, hover states — one layer above surface |
| `--bg-overlay` | `#3F3F46` | Floating toolbars, command palette — one layer above elevated |

### 4.3 Text colors

| Token | Hex | Usage |
|---|---|---|
| `--text-primary` | `#FAFAFA` | Headings, primary content |
| `--text-secondary` | `#A1A1AA` | Body, descriptions |
| `--text-muted` | `#71717A` | Labels, captions, timestamps |
| `--text-disabled` | `#52525B` | Disabled states, placeholders |

### 4.4 Agent states (first-class primitive)

The 6 agent states are the heart of Forge's visual identity. Every place an agent appears renders with the corresponding state color:

| State | Color | Icon | Pulse? |
|---|---|---|---|
| `idle` | `--text-muted` | `Circle` | No |
| `thinking` | `--accent-violet` | `Brain` | Yes (1.5s) |
| `executing` | `--accent-primary` | `Zap` | Yes (1s) |
| `reviewing` | `--accent-cyan` | `Eye` | No |
| `completed` | `--accent-emerald` | `CheckCircle2` | No |
| `failed` | `--accent-rose` | `AlertCircle` | No |

The implementation lives in `apps/forge/lib/design-system/status.ts`:

```typescript
export const AGENT_STATE_TONE: Record<AgentState, Tone> = {
  idle: 'muted',
  thinking: 'violet',
  executing: 'primary',
  reviewing: 'cyan',
  completed: 'emerald',
  failed: 'rose',
};
```

### 4.5 Status tones (workflow + run)

| State | Color | Used in |
|---|---|---|
| `pending` | `--text-muted` | Runs waiting to start |
| `running` | `--accent-primary` | Active runs |
| `waiting_approval` | `--accent-amber` | Paused for human (Rule 3) |
| `succeeded` | `--accent-emerald` | Completed cleanly |
| `failed` | `--accent-rose` | Errored |
| `cancelled` | `--text-muted` | User-stopped |

## 5. Typography

### 5.1 Font stack

```
font-family-sans: "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
font-family-mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace
font-family-display: "Inter Display", "Inter", sans-serif
```

### 5.2 Type scale (8pt grid)

| Token | Size / Line height | Usage |
|---|---|---|
| `display-2xl` | 48 / 56 | Hero h1 (rare) |
| `display-xl` | 36 / 44 | Page h1 |
| `display-lg` | 30 / 38 | Section h1 |
| `display-md` | 24 / 32 | Card h2 |
| `text-lg` | 18 / 28 | Lead paragraph |
| `text-base` | 14 / 20 | Body |
| `text-sm` | 13 / 18 | Secondary |
| `text-xs` | 12 / 16 | Captions, labels |
| `text-2xs` | 11 / 14 | Timestamps, metadata |

### 5.3 Font weights

- `regular` (400) — body
- `medium` (500) — labels
- `semibold` (600) — headings
- `bold` (700) — emphasis only

## 6. Spacing (8pt grid with 4pt micro-step)

| Token | px | Usage |
|---|---|---|
| `space-0` | 0 | Reset |
| `space-1` | 4 | Hairline gap |
| `space-2` | 8 | Inline gap |
| `space-3` | 12 | Stack gap |
| `space-4` | 16 | Section padding |
| `space-6` | 24 | Card padding |
| `space-8` | 32 | Section gap |
| `space-12` | 48 | Page-level gap |
| `space-16` | 64 | Hero gap |
| `space-24` | 96 | Maximum |

## 7. Radius

| Token | px | Usage |
|---|---|---|
| `radius-none` | 0 | Rare — full-bleed surfaces |
| `radius-sm` | 4 | Inputs, chips |
| `radius-md` | 6 | Buttons, small cards |
| `radius-lg` | 8 | Cards, panels |
| `radius-xl` | 12 | Modals, large cards |
| `radius-2xl` | 16 | Hero elements |
| `radius-full` | 9999 | Pills, avatars |

## 8. Motion

### 8.1 Durations

| Token | ms | Usage |
|---|---|---|
| `duration-instant` | 50 | Hover color shift |
| `duration-fast` | 150 | Press feedback |
| `duration-normal` | 200 | Default transition |
| `duration-slow` | 300 | Page transitions |
| `duration-deliberate` | 500 | Emphasis animations |

### 8.2 Easings

```css
--ease-out-quart: cubic-bezier(0.16, 1, 0.3, 1);  /* default for entry */
--ease-in-out-quart: cubic-bezier(0.76, 0, 0.24, 1);  /* default for state changes */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* bounces */
```

### 8.3 Honor `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Every `motion.div` in the codebase must respect this — wrap animated components in `<MotionConfig reducedMotion="user">` from framer-motion.

## 9. Elevation (shadows)

Forge uses **hairline borders over heavy shadows** (per design principle #1).

```css
--elevation-0: 0 0 0 1px rgba(255, 255, 255, 0.04);  /* hairline */
--elevation-1: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 1px 2px rgba(0, 0, 0, 0.3);
--elevation-2: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 4px 8px rgba(0, 0, 0, 0.4);
--elevation-3: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 12px 24px rgba(0, 0, 0, 0.5);
```

## 10. Layout primitives

### 10.1 Container widths

| Token | px | Usage |
|---|---|---|
| `max-w-screen-sm` | 640 | Single-column forms |
| `max-w-screen-md` | 768 | Long-form content |
| `max-w-screen-lg` | 1024 | Default app width |
| `max-w-screen-xl` | 1280 | Data-heavy views |
| `max-w-screen-2xl` | 1536 | Wide kanban boards |
| `max-w-screen-3xl` | 1800 | Maximum data canvas |

### 10.2 Grid

- 12-column responsive grid for data-heavy views
- `gap-4` (16px) standard, `gap-6` (24px) for editorial layouts

### 10.3 Z-index scale

| Token | Value | Usage |
|---|---|---|
| `z-0` | 0 | Default |
| `z-10` | 10 | Sticky headers |
| `z-20` | 20 | Dropdowns |
| `z-30` | 30 | Modals backdrop |
| `z-40` | 40 | Modals content |
| `z-50` | 50 | Command palette, toasts |
| `z-60` | 60 | Co-pilot FAB (cross-cutting) |

## 11. Component patterns

### 11.1 Cards

Every list item uses a Card pattern:
- `bg-surface` (#18181B)
- `border-radius-lg` (8px)
- `padding-6` (24px)
- 1px hairline border (`elevation-0`)
- Hover: `bg-elevated` + `elevation-1`

### 11.2 Buttons

| Variant | Background | Foreground | Usage |
|---|---|---|---|
| `primary` | `--accent-primary` | white | Main CTA |
| `secondary` | `--bg-elevated` | `--text-primary` | Secondary action |
| `ghost` | transparent | `--text-secondary` | Tertiary |
| `danger` | `--accent-rose` | white | Destructive |
| `success` | `--accent-emerald` | white | Confirm |

All buttons: `radius-md` (6px), `padding-x-4 padding-y-2`, hover state with 150ms transition.

### 11.3 Status badges

Always pair color with text + icon (never color alone — accessibility):

```tsx
<Badge tone="emerald">
  <CheckCircle2 className="h-3 w-3" />
  Healthy
</Badge>
```

### 11.4 Empty states

Per Rule 9-empty-illustration.md:
- Lucide icon illustration (size 48-64px)
- One-line headline ("All clear — no risks")
- One-line subtext ("Try a different search")
- One primary CTA ("Create one")
- Optional: secondary CTA ("Import template")

### 11.5 Loading states

Never use spinners for async data. Use skeleton rows that match the final shape:

```tsx
<Skeleton className="h-4 w-32" />  // for text
<Skeleton className="h-8 w-8 rounded-full" />  // for avatars
```

Chart loading: shimmer animation that mimics the chart shape.

### 11.6 Error states

Per Step 13 ErrorState primitive:
- Lucide icon (size 32px, `--accent-rose`)
- Pattern recognition header ("Can't reach the orchestrator")
- One-line description
- Suggested actions (retry, contact support, view status)

### 11.7 Toasts

Bottom-right, dismissable, max 3 visible:
- Success: emerald check + 3s auto-dismiss
- Warning: amber + 5s auto-dismiss
- Error: rose + manual dismiss

## 12. Cross-cutting concerns (Rule 12)

These components must be present on EVERY page, not siloed in one feature:

### 12.1 ConnectorPicker

- Trigger: `[SelectedConnector]` or `[Connect X to use this]` hint pill
- Capability filter: `<ConnectorPicker capability="send_message" />`
- Falls back to marketplace link if no installed connector matches

### 12.2 Co-pilot FAB

- Position: `fixed bottom-6 right-6`
- z-index: 60 (above modals)
- Opens `<CoPilotDrawer>` with chat + tool execution
- Always accessible via `⌘⇧K` shortcut

### 12.3 ⌘K Command palette

- Global, opens via `⌘K` (mac) / `Ctrl+K` (other)
- Search: pages, agents, connectors, workflows, runs
- Actions: create new (per resource), navigate, invoke
- Traps focus, `Esc` closes, restores focus

### 12.4 ⌘⇧C — Connector picker shortcut
### 12.5 ⌘⇧K — Credential manager shortcut
### 12.6 ⌘⇧W — Webhook manager shortcut

All shortcuts declared in `apps/forge/lib/keyboard/registry.ts` so they're discoverable via `⌘/` help overlay.

## 13. Real-time patterns (Steps 56-59)

### 13.1 SSE stream subscriptions

For live event feeds (workflow runs, agent execution):

```typescript
const { events, status } = useRunLiveEvents(runId);
// events: append-only list, status: 'idle' | 'connecting' | 'open' | 'closed' | 'error'
```

Implementation in `apps/forge/lib/hooks/useWorkflows.ts`. EventSource cannot set headers — pass JWT via `?token=` query param, server must accept.

### 13.2 TanStack Query polling

For semi-live data (connectors, KG nodes):

```typescript
useQuery({
  queryKey: connectorQueryKeys.list(),
  queryFn: () => api.get('/connectors'),
  refetchInterval: 30_000,  // 30s poll
  staleTime: 15_000,        // fresh for 15s
});
```

### 13.3 Optimistic updates

For drag-drop kanban (Stories Center):

```typescript
const handleDrop = async (storyId, newStatus) => {
  qc.setQueryData(storiesQueryKeys.list(), (old) =>
    old.map(s => s.id === storyId ? { ...s, status: newStatus } : s)
  );
  try {
    await updateStory({ id: storyId, status: newStatus });
  } catch {
    qc.invalidateQueries({ queryKey: storiesQueryKeys.list() });  // rollback
  }
};
```

## 14. Approval gates (Rule 3)

Approval gates are visually distinct everywhere:

- **`waiting_approval` state**: amber pulse + Pause icon + "Awaiting review" text
- **Inbox view**: dedicated `/approvals` page + sidebar badge with pending count
- **Inline approval**: drawer in workflow run detail with "Approve" / "Reject" buttons
- **Audit**: every decision recorded with actor + reason + timestamp

NEVER auto-advance past an approval gate. NEVER silently drop a pending approval.

## 15. Multi-tenant chrome (Rule 2)

Every page surfaces:
- Tenant switcher (top-left, shows current tenant name + chevron)
- Project context (if applicable, shows project name + breadcrumbs)
- User identity (top-right avatar + persona chip)

The shell reads these from `useTenant()` + `useProject()` + `useAuth()` hooks. NEVER read from URL params or localStorage in components.

## 16. Phase 6 reorientation — LiteLLM as source of truth

Per the Step 59 reorientation, Forge is a UI on top of LiteLLM:

- **Cost tracking** — sourced from LiteLLM `/spend/logs`, NOT from local token math
- **Guardrails** — configured in LiteLLM (`pii_masking`, `prompt_injection_detection`, etc.)
- **Virtual keys** — minted by LiteLLM, displayed via `/admin/llm-gateway/tenants/{id}/keys`
- **Spend aggregation** — read from LiteLLM `/spend/teams`, `/spend/models`
- **Models catalog** — read from LiteLLM `/models`
- **MCP servers** — read from LiteLLM `/mcp/tools`

Forge UI components in this area:
- `apps/forge/app/admin/llm-gateway/` — Tenant + Key + MCP + Health
- `apps/forge/app/governance-center/` — Policies + Guardrails + Standards
- `apps/forge/app/analytics/` — Cost trend + Spend by model
- `apps/forge/app/audit/page.tsx` — Forge audit + LLM traffic tabs

**Never reimplement what LiteLLM provides.** If a feature exists in LiteLLM, the Forge backend proxies it; if it doesn't exist in LiteLLM, it's Forge-specific (workflows, agents, ideas).

## 17. Accessibility

- All interactive elements: `:focus-visible:ring-2 ring-offset-2 ring-offset-bg-base ring-accent-primary`
- Color is NEVER the only signal — always pair with icon + text
- ARIA labels on all icon-only buttons
- Tab order = DOM order
- Modals trap focus, restore on close
- All forms have visible labels (sr-only acceptable)
- Live regions for KPI deltas + run state changes
- Honors `prefers-reduced-motion`
- Honors `prefers-color-scheme` (only dark by default, but light defined)

## 18. Internationalization (future)

Currently English-only. When adding i18n:
- All strings in `apps/forge/lib/i18n/messages/en.json`
- Currency: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`
- Dates: `Intl.DateTimeFormat()` (relative formatting in `apps/forge/lib/format.ts`)
- Numbers: locale-aware (e.g. 1,000 vs 1.000)

## 19. Performance budgets

- Largest Contentful Paint: < 2.5s
- First Input Delay: < 100ms
- Cumulative Layout Shift: < 0.1
- Bundle size per route: < 250kb (gzipped)
- TanStack Query staleTime: 15s default
- Polling intervals: 30s for lists, 5s for active runs, 10s for SSE fallback

## 20. Testing

- Every component has a `data-testid` prop wired
- Visual regression with Playwright (snapshots on PR)
- Accessibility audit with axe-core (in CI)
- Keyboard navigation test for every interactive surface
- prefers-reduced-motion test on every animated component

## 21. File map

| Path | Purpose |
|---|---|
| `apps/forge/lib/design-system/` | Token source of truth (TypeScript) |
| `apps/forge/app/globals.css` | CSS layer (the only place HSL appears) |
| `apps/forge/tailwind.config.ts` | Tailwind binding |
| `apps/forge/components/ui/` | Shadcn UI primitives (button, input, dialog, etc.) |
| `apps/forge/components/shell/` | App shell (Topbar, Sidebar, PageHeader, etc.) |
| `apps/forge/components/error-state.tsx` | Standard error UI |
| `apps/forge/components/empty-state.tsx` | Standard empty UI |
| `apps/forge/src/components/` | Legacy patterns (being migrated) |
| `forge-design-system.md` | Historical design doc (superseded by DESIGN_SYSTEM.md) |
| `forge-theme-system.md` | Historical theme doc (merged into DESIGN_SYSTEM.md) |

## 22. Versioning

This document is versioned with the codebase. Breaking changes require:
1. Update this file in the same PR
2. Update `forge-color-tokens.ts` and related token files
3. Migrate consumers (typed errors from codemods)
4. Visual regression test on all pages

## 23. References

- `forge-design-system.md` — Historical design doc
- `forge-theme-system.md` — Historical theme architecture
- `docs/design-system-curate.md` — Design vision prompt
- `docs/ARCHITECTURE.md` — System architecture
- `CLAUDE.md` — Constitutional rules
- `implementation_plan.md` — Project plan
- [Keep a Changelog](https://keepachangelog.com/) — Changelog conventions
- [Shadcn/UI](https://ui.shadcn.com/) — Component primitives
- [Lucide](https://lucide.dev/) — Icon library
- [Inter](https://rsms.me/inter/) — Sans font
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — Mono font

---

### ZONE 2 — CHANGELOG.md APPENDIX

The existing `CHANGELOG.md` ends at Step 12 (Organization Knowledge). APPEND phases for Steps 13-60. Each entry follows the existing format:

```markdown
## YYYY-MM-DD — Step N — Short title

- **One-liner change**
- **Sub-change**
- **Files affected**: list
- **Rule applied**: reference Rule # from CLAUDE.md if applicable
```

Append the following entries to `CHANGELOG.md`:

```markdown
## 2026-06-26 — Step 13 — ErrorState primitive

- **Canonical error UI** — `apps/forge/components/error-state.tsx` with pattern-recognition header, suggested actions, and retry CTA.
- **Wire to all data-bearing pages**: Connector Center, Architecture Center, Agent Center, Audit Center.
- **No more generic "Something went wrong"** — each error gets a typed message derived from the response shape (network / 4xx / 5xx / missing-data).

## 2026-06-26 — Step 14 — Run Center modernization (Phase 0.5)

- **Virtualized table** for 10k+ runs (`@tanstack/react-virtual`).
- **KPI strip**: Active / Succeeded today / Failed today / Total cost — with signed deltas.
- **720px drawer** for run detail with 7 tabs.
- **Wire to FastAPI backend** via `useRunsIndex()` + `useRunDetail(runId)`.

## 2026-06-26 — Step 15 — Command Center modernization

- **forge-* command palette** — 60+ commands white-labeled from GSD Core (per DL-024).
- **Slash-mode shortcuts**: `/ideation`, `/connectors`, `/workflow`, `/runs`, `/knowledge`.
- **Search across: pages, agents, connectors, workflows, runs, ideas**.

## 2026-06-26 — Step 16 — Terminal Center (xterm.js + native PTY)

- **Real PTY** via FastAPI subprocess manager (not a mock).
- **Multi-tab terminals** with persistent session IDs.
- **Cost tracker in sidebar** — Live USD/hour, lifetime spend, current model.
- **Stream JSON events** from any forge-* command via WebSocket.

## 2026-06-26 — Step 17 — Audit Center redesign

- **Client-side filtering** except date range (per goal).
- **Mono hash column** with copy-on-hover.
- **Drawer with hash chain + diff** — verify the audit trail is intact.
- **CSV/JSON export** — full audit dump with one click.

## 2026-06-27 — Step 18 — Story detail drawer + lifecycle tabs

- **7-tab drawer** for Story detail (Overview / Acceptance Criteria / Subtasks / Linked Jira / Comments / Audit / Activity).
- **Lifecycle transitions**: BACKLOG → IN_PROGRESS → IN_REVIEW → DONE → ACCEPTED.
- **Bulk update** via `/stories/stories/bulk` with optimistic UI.

## 2026-06-27 — Step 19 — Persona picker + dashboards

- **3 personas**: PM, eng-lead, CTO. Each gets a tailored dashboard.
- **Persona memory** — Per-persona LLM memory stored via `usePersonaMemory` hook.
- **RBAC by persona** — Read-only audit view for CTO, full chrome for PM.

## 2026-06-27 — Step 20 — Project Intelligence bento layout

- **Sticky project context bar** with selector + breadcrumbs + actions.
- **Animated-gradient hero band** + view toggle (`?view=all|mine|at-risk|recent`).
- **KPI strip + 12-col bento grid** — typed artifacts left, metrics right.

## 2026-06-27 — Step 21 — Stories Center kanban

- **Drag-drop kanban** with @dnd-kit (`PointerSensor` + `KeyboardSensor`).
- **Optimistic update** on drag — PATCH first, rollback on error.
- **URL state** — view mode persists in `?view=kanban|list|timeline`.

## 2026-06-27 — Step 22 — Workflow gallery

- **Template catalog** at `/workflows` index — "From scratch" + "Use template" CTAs.
- **Legacy mode A → mode B canvas toggle** kept at `/workflows/{id}/edit`.
- **WorkflowCard** — name, description, last run status, owner, version.

## 2026-06-28 — Step 30 — Architecture Center modernization (9 tabs)

- **Single-page rewrite** of `apps/forge/app/architecture/page.tsx`.
- **9 tabs**: ADRs / API Contracts / Risk Registers / Standards / Acceptance / Approvals / Task Breakdowns / Traceability / Versions.
- **Defensive `resolveSelected` helper** — empty state ONLY fires when source array is truly empty.
- **Cross-tab chips** linking ADRs → Contracts → Risks.

## 2026-06-28 — Step 31 — Connector Center modernization

- **7-tab experience**: Overview / Connected / Marketplace / Health / Activity / Credentials / Webhooks.
- **ConnectorPicker** (cross-cutting) — capability-aware selector used in Ideation, Workflows, Co-pilot.
- **Mock data → live data** via `LiveConnectorDataProvider`.

## 2026-06-28 — Step 35 — Governance Center rebuild

- **8 tabs**: Overview / Policies / Guardrails / Standards / LLM Control / Board / RBAC / Audit.
- **NOTE**: "Mocked LiteLLM integration" — replaced in Step 59 with real proxy.

## 2026-06-28 — Step 50 — Dashboard polish

- **Polish fixes per Step 42**: card density, hover states, KPI deltas.
- **Hero gradient border** via `.hero-border` class.
- **"Recently active"** widget with sparklines.

## 2026-06-29 — Step 54 — Phase 2 v3: Agents + Providers (real backend)

- **6 agents seeded**: Code reviewer, Refactor agent, Sync agent, Test runner, Doc generator, Security auditor.
- **4 model providers seeded**: Anthropic, OpenAI, AWS Bedrock, Google Vertex.
- **2 runtimes seeded**: local-docker, production-k8s.
- **Test script** `backend/scripts/test_agents_api.py` — 12/12 passed.
- **Removed "Test agent patched X" entries** — production-clean data.
- **Files affected**: `backend/app/api/v1/agents.py`, `model_providers.py`, `agent_runtimes.py`, `agent_assignments.py`, `backend/scripts/seed_agents.py`, `apps/forge/lib/agent-center/adapter.ts`.

## 2026-06-29 — Step 54 v4 — Real LiteLLM Test Connection + Real Dashboard Metrics

- **Real LiteLLM test**: `POST /model-providers/{id}/test` now calls upstream provider API with real credentials; returns latency_ms or real error (401 / 403 / 404 / timeout).
- **Top providers widget**: now reads from `/dashboard/top-providers?days=7` aggregating real run data (model, run_count, total_cost, success_rate).
- **Filter test data**: Agent list endpoint now filters out test-prefixed names.
- **Files affected**: `backend/app/api/v1/model_providers.py`, `backend/app/api/v1/dashboard.py`, `apps/forge/lib/query/hooks.ts`.

## 2026-06-29 — Step 55 v2 — Connectors: real backend, kill mock data

- **Seed 6 connectors**: GitHub, Jira, Slack, Confluence, Figma, AWS.
- **`LiveConnectorDataProvider` fix**: distinguish API loading vs API returned empty vs API errored. Only fall back to mocks on error (not empty).
- **Test script** `backend/scripts/test_connectors_api.py` — 12/12 passed.
- **Files affected**: `backend/scripts/seed_connectors.py`, `backend/scripts/test_connectors_api.py`, `apps/forge/components/connector-center/LiveConnectorDataProvider.tsx`.

## 2026-06-29 — Step 56 v2 — Workflows + Runs: real data + working run stream

- **Seed 6 workflows + 3 runs**: PR Review Pipeline, Idea → Story → Jira Sync, Nightly Security Scan, Deploy to Production, Story Refinement Workshop, Architecture Review.
- **Run states**: 1 running, 1 succeeded, 1 failed.
- **SSE event stream**: `GET /workflows/runs/{id}/events` working with `useRunLiveEvents`.
- **Decision**: Runs Center now shows workflow runs (not SDLC runs) for clearer user value.
- **Files affected**: `backend/scripts/seed_workflows.py`, `backend/scripts/test_workflows_api.py`, `apps/forge/components/workflows/WorkflowCenter.tsx`, `apps/forge/components/workflows/WorkflowRunDetail.tsx`, `apps/forge/lib/api.ts`.

## 2026-06-29 — Step 57 v2 — Knowledge Graph + Ideation + Org Knowledge: real data

- **Seed 40+ KG nodes + 25+ edges**: people, teams, services, modules, docs, ADRs, policies, runbooks, tools.
- **Seed 6 ideas + 4 analyses + 4 scores + 1 roadmap + 2 PRDs + 3 approvals**.
- **Seed 13 org knowledge docs** across 4 categories (standards/templates/policies/best-practices).
- **Real hooks**: `useKnowledgeGraph`, `useIdeation` with TanStack Query.
- **Files affected**: `backend/scripts/seed_knowledge_graph.py`, `seed_ideation.py`, `seed_org_knowledge.py`, `backend/scripts/test_knowledge_api.py`, `apps/forge/lib/hooks/useKnowledgeGraph.ts`, `apps/forge/lib/hooks/useIdeation.ts`.

## 2026-06-29 — Step 58 v2 — Projects + Stories + Architecture: real data

- **Seed 3 projects + 5 epics + 3 sprints + ~30 stories + 6 ADRs + 5 contracts + 5 risks + 2 task breakdowns + 3 approvals + 4 attestations + 1 version**.
- **Stories Center**: real hooks already wired; mock-data kept as offline fallback only.
- **Architecture Center**: all 9 tabs wired to backend.
- **Traceability**: matrix linking ADRs → contracts → services → stories.
- **Files affected**: `backend/scripts/seed_projects.py`, `seed_stories.py`, `seed_architecture.py`, `backend/scripts/test_architecture_api.py`, `apps/forge/lib/hooks/useArchitecture.ts`.

## 2026-06-29 — Step 59 v1 — Governance reorientation: Forge = LiteLLM frontend

- **Strategic shift**: Forge AI is now a UI on top of LiteLLM, not a competing LLM platform.
- **DELETE duplicates**: `policy_engine.py`, `governance_violation.py` (LiteLLM provides natively).
- **NEW SDK**: `backend/app/services/litellm_admin.py` — typed async client for all LiteLLM admin endpoints.
- **Cost tracking rewritten**: `terminal_costs.py` now proxies `/spend/logs`, `/spend/teams`, `/global/spend`.
- **Policies rewritten**: `policies.py` now lists `/guardrails/list` from LiteLLM.
- **Standards rewritten**: `standards.py` combines LiteLLM guardrails + manual attestations.
- **Violations rewritten**: `governance_violations.py` reads failed requests from `/spend/logs`.
- **NEW team sync**: `backend/app/services/team_sync.py` — tenant ↔ LiteLLM team mapping.
- **Seed 4 LiteLLM guardrails**: pii_masking, prompt_injection_detection, content_moderation, secret_detection.
- **Test script**: `backend/scripts/test_litellm_proxy.py` — 15/15 passed (4 direct + 11 proxies).
- **Files affected**: `backend/app/services/litellm_admin.py`, `team_sync.py`, all rewritten `api/v1/*.py`, `infra/litellm/config.yaml`, `apps/forge/app/governance-center/page.tsx`, `apps/forge/app/audit/page.tsx`.

## 2026-06-29 — Step 60 v1 — Final closure: DESIGN_SYSTEM.md + CHANGELOG.md

- **NEW `DESIGN_SYSTEM.md`** at repo root — canonical visual + interaction reference (~600 lines).
- **CHANGELOG.md** updated with Steps 13-60 (this entry).
- **References** `forge-design-system.md` + `forge-theme-system.md` as historical, superseded.
- **Single source of truth**: `apps/forge/lib/design-system/` (TypeScript tokens) + `apps/forge/app/globals.css` (CSS layer).
```

---

### ZONE 3 — DELETION / CONSOLIDATION

After writing the new docs:

1. **KEEP `forge-design-system.md`** but add a banner at the top:
   ```markdown
   > ⚠️ **This document is historical and superseded by [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).**
   > New design decisions go in DESIGN_SYSTEM.md. This file is preserved for context.
   ```

2. **KEEP `forge-theme-system.md`** with the same banner pointing to DESIGN_SYSTEM.md.

3. **KEEP `docs/design-system-curate.md`** — it's the design vision prompt (different purpose).

4. **DO NOT DELETE** any code files — these are docs only.

---

### ZONE 4 — CROSS-REFERENCES

After writing the new docs, ensure cross-references are correct:

- `README.md` → should mention `DESIGN_SYSTEM.md` in a "Documentation" section
- `CLAUDE.md` → should reference `DESIGN_SYSTEM.md` for design rules
- `docs/ARCHITECTURE.md` → should reference `CHANGELOG.md` for the latest changes

Add to `README.md` if not already present:

```markdown
## Documentation

- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — Canonical visual + interaction reference
- [CHANGELOG.md](./CHANGELOG.md) — What shipped in each step
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — System architecture
- [CLAUDE.md](./CLAUDE.md) — Constitutional rules
- [implementation_plan.md](./implementation_plan.md) — Project plan
```

---

### ZONE 5 — VERIFICATION CHECKLIST

All must pass:

- [ ] `DESIGN_SYSTEM.md` exists at repo root, ~600 lines
- [ ] `DESIGN_SYSTEM.md` has 23 sections (Positioning → References)
- [ ] All 6 agent states documented with color + icon + pulse
- [ ] All 6 workflow statuses documented
- [ ] Color palette tables include hex + usage
- [ ] Type scale, spacing, radius, motion all tokenized
- [ ] Cross-cutting concerns section (Rule 12) covers Co-pilot FAB, ConnectorPicker, ⌘K
- [ ] Real-time patterns section covers SSE + TanStack polling + optimistic updates
- [ ] Approval gates section (Rule 3) explicit on `waiting_approval`
- [ ] Phase 6 reorientation section explains LiteLLM proxy pattern
- [ ] File map points to current state
- [ ] `CHANGELOG.md` updated with all 13+ new entries (Steps 13-60)
- [ ] Each changelog entry follows existing format (date, step, title, bullets)
- [ ] `forge-design-system.md` has banner pointing to DESIGN_SYSTEM.md
- [ ] `forge-theme-system.md` has banner pointing to DESIGN_SYSTEM.md
- [ ] `README.md` has Documentation section linking to new docs
- [ ] All cross-references resolve correctly
- [ ] No code files deleted (docs only)

---

## CONSTRAINTS

- DO NOT delete `forge-design-system.md` or `forge-theme-system.md` — just deprecate with banner
- DO NOT change existing CHANGELOG entries (only append)
- Keep DESIGN_SYSTEM.md in Markdown table-heavy format (not prose)
- All hex values must match `apps/forge/lib/design-system/forge-color-tokens.ts` exactly
- All token names must match Tailwind config exactly
- Reference existing Shadcn/UI components rather than re-specifying them
- Cross-reference other docs (don't duplicate content)

---

## DELIVERABLE

- `DESIGN_SYSTEM.md` (Zone 1) — ~600 lines, 23 sections
- `CHANGELOG.md` (Zone 2) — appended with Steps 13-60
- `forge-design-system.md` (Zone 3) — banner pointing to new doc
- `forge-theme-system.md` (Zone 3) — banner pointing to new doc
- `README.md` (Zone 4) — Documentation section updated
- All 17 verification items pass
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — historical design docs preserved (deprecated), code files untouched, existing changelog entries untouched

---

## Rationale

This closure step applies Keep a Changelog conventions and the "single source of truth" principle: token values live in code (`apps/forge/lib/design-system/`), CSS layer maps them to runtime styles (`globals.css`), and DESIGN_SYSTEM.md documents them as a reference. Rule 9 (forge-core canonical) means we never duplicate design tokens across docs — only reference them. The Phase 6 reorientation gets its own section because it fundamentally changes the architecture (Forge = LiteLLM UI), so future contributors don't accidentally rebuild what LiteLLM provides.

---

## What we deliberately did NOT change

- Historical design docs (`forge-design-system.md`, `forge-theme-system.md`) — preserved with deprecation banners, not deleted
- Existing CHANGELOG entries (Steps 1-12) — untouched, only appended
- `docs/design-system-curate.md` — separate design vision prompt, kept as-is
- Any code files — this is a documentation-only step