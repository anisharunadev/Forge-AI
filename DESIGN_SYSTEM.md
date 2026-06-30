# Forge AI Design System

> **The canonical visual + interaction reference for Forge AI Agent OS.**
> Status: Living document — last updated 2026-06-29
> Source of truth (TypeScript tokens): `apps/forge/lib/design-system/`
> CSS layer: `apps/forge/app/globals.css`
> Tailwind binding: `apps/forge/tailwind.config.ts`

---

## 1. Positioning

Forge AI is the operating system that orchestrates agents, knowledge, governance, and delivery workflows. Its design system exists to make that orchestration **visible** — to answer at a glance:

- What agents are running (AgentCard on every list)
- What agents are thinking (AgentTimeline with reasoning summaries)
- What the cost is (CostTracker in sidebar, not buried in settings)
- What is blocked (`waiting_approval` badges, no silent stops)
- What is deployable (Build status with green/red pills)

**Visual references:** Linear × Vercel × GitHub × Cursor × Anthropic Console.

---

## 2. Brand personality

- **Intelligent** — every signal means something; no decoration
- **Technical** — built for engineers; no marketing flourish
- **Premium** — enterprise-grade spacing, motion, and detail
- **Fast** — every interaction feels instant
- **Autonomous** — users supervise agents rather than perform manual work
- **Futuristic** — without looking like science fiction

---

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

---

## 4. Color system

### 4.1 Brand palette

Hex values match `apps/forge/lib/design-system/forge-color-tokens.ts` exactly.

| Token | Hex | Usage |
|---|---|---|
| `--primary` | `#6366F1` | Indigo — primary actions, active states, focus rings |
| `--agent` | `#06B6D4` | Cyan — agent identity (avatar, name, channel) |
| `--execution` | `#8B5CF6` | Violet — agent executing, live code work |
| `--review` | `#F97316` | Orange — review, validation |
| `--success` | `#22C55E` | Emerald — success, healthy, completed |
| `--warning` | `#F59E0B` | Amber — warnings, waiting_approval, pending |
| `--error` | `#EF4444` | Rose — errors, failed, quarantined |

### 4.2 Layered surfaces

| Token | Hex | Usage |
|---|---|---|
| `--background` | `#09090B` | Page background — near-black slate (NOT pure black) |
| `--surface` | `#111113` | Section dividers, popover background |
| `--card` | `#18181B` | Cards, panels — one layer above surface |
| `--hover` | `#1F1F23` | Card-on-canvas hover state (between surface and card) |
| `--border` | `#27272A` | Hairline borders |

### 4.3 Text colors

| Token | Hex | Usage |
|---|---|---|
| `--text` | `#FAFAFA` | Headings, primary content |
| `--muted` | `#A1A1AA` | Body, descriptions |
| `--subtle` | `#71717A` | Idle / quiet / "off" — darker than muted (a fleet of idle agents reads as quiet, not noisy) |
| `--text-disabled` | `#52525B` | Disabled states, placeholders |

### 4.4 Agent states (first-class primitive)

The 6 agent states are the heart of Forge's visual identity. Every place an agent appears renders with the corresponding state color. Implementation lives in `apps/forge/lib/design-system/forge-color-tokens.ts` (`agentStates`).

| State | Hex | Lucide icon | Pulse |
|---|---|---|---|
| `idle` | `#71717A` | `Circle` | None |
| `thinking` | `#3B82F6` | `Brain` | Slow (1.6s) |
| `executing` | `#8B5CF6` | `Zap` | Active (1.2s) |
| `reviewing` | `#F97316` | `Eye` | Slow (1.6s) |
| `completed` | `#22C55E` | `CheckCircle2` | None |
| `failed` | `#EF4444` | `AlertCircle` | Fast-to-static |

> Note: `thinking` is distinct from `agent` identity. Agent identity = cyan (`#06B6D4`); agent state `thinking` = blue (`#3B82F6`). The two are never the same color.

### 4.5 Status tones (workflow + run)

Implementation: `apps/forge/lib/design-system/forge-color-tokens.ts` (`runStates`).

| State | Hex | Used in |
|---|---|---|
| `created` | `#71717A` | Run record exists, not yet started |
| `running` | `#8B5CF6` | Active run |
| `waiting_approval` | `#F97316` | Paused for human (Rule 3) |
| `paused` | `#8B5CF6` | User-paused |
| `approved` | `#22C55E` | Approval gate cleared |
| `rejected` | `#EF4444` | Approval denied |
| `aborted` | `#EF4444` | User-stopped, error |
| `finished` | `#22C55E` | Completed cleanly |
| `done` | `#22C55E` | Terminal success |

### 4.6 KG node statuses

Implementation: `apps/forge/lib/design-system/forge-color-tokens.ts` (`kgNodeStates`).

| State | Hex | Used in |
|---|---|---|
| `draft` | `#71717A` | KG node authored, not yet approved |
| `approved` | `#22C55E` | Reviewer signed off |
| `conflicted` | `#F59E0B` | Hybrid-MDM conflict surfaced |
| `deployed` | `#6366F1` | Reached production |

---

## 5. Typography

### 5.1 Font stack

```css
font-family-sans: "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
font-family-mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
font-family-display: "Inter Display", "Inter", sans-serif;
```

Loaded via `next/font/google` in `app/layout.tsx`. No third font family.

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

Implementation: `apps/forge/lib/design-system/forge-typography.ts` + Tailwind `text-{2xs..7xl}` utilities.

### 5.3 Font weights

- `regular` (400) — body
- `medium` (500) — labels
- `semibold` (600) — headings
- `bold` (700) — emphasis only

### 5.4 Type rules

- No `text-[Npx]` arbitrary values — use the `2xs/xs/sm/.../7xl` scale.
- Eyebrows are always `text-2xs uppercase tracking-wider text-muted-foreground` (or `text-agent` / `text-primary` variant).
- Numeric figures (cost, percentage, count) use `font-variant-numeric: tabular-nums` for column alignment.

---

## 6. Spacing

8pt grid with a 4pt micro-step for fine alignment. Implementation: `apps/forge/lib/design-system/forge-spacing.ts`.

| Token | px | Usage |
|---|---|---|
| `space-1` | 4 | Hairline gap |
| `space-2` | 8 | Inline gap |
| `space-3` | 12 | Stack gap |
| `space-4` | 16 | Section padding |
| `space-6` | 24 | Card padding |
| `space-8` | 32 | Section gap |
| `space-12` | 48 | Page-level gap |
| `space-16` | 64 | Hero gap |
| `space-24` | 96 | Maximum |

---

## 7. Radius

Six steps, plus `full` for pills.

| Token | px | Usage |
|---|---|---|
| `radius-sm` | 6 | Inputs, chips |
| `radius-md` | 10 | Buttons, small cards (default) |
| `radius-lg` | 14 | Card on a card |
| `radius-xl` | 18 | Dialog |
| `radius-2xl` | 24 | Hero panels |
| `radius-3xl` | 32 | Oversized surfaces |
| `radius-full` | 9999 | Pills, avatars |

The default radius is `md` (10px) — matches shadcn/ui convention.

---

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

### 8.4 Motion rules

- Use `pulse-agent` (1.6s) for thinking agents, not the default `animate-pulse`.
- Use `spin-execution` (1.2s) for executing agents.
- Use `pulse-glow` only for the brand mark and one or two hero callouts.
- Avoid animating layout (`width`, `height`); animate `transform` and `opacity` only.

---

## 9. Elevation (shadows)

Forge uses hairline borders over heavy shadows. Implementation: `app/globals.css` + `tailwind.config.ts`.

```css
--elevation-0: 0 0 0 1px rgba(255, 255, 255, 0.04);  /* hairline */
--elevation-1: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 1px 2px rgba(0, 0, 0, 0.3);
--elevation-2: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 4px 8px rgba(0, 0, 0, 0.4);
--elevation-3: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 12px 24px rgba(0, 0, 0, 0.5);
```

State-specific glows (for status-bearing surfaces):

| Token | Use |
|---|---|
| `glow-primary` | Active stage chip |
| `glow-agent` | Thinking agent |
| `glow-execution` | Executing agent |
| `glow-review` | Reviewing agent |
| `glow-success` | Completed run |
| `glow-destructive` | Failed run |

---

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

- 12-column responsive grid for data-heavy views.
- `gap-4` (16px) standard, `gap-6` (24px) for editorial layouts.

### 10.3 Z-index scale

| Token | Value | Usage |
|---|---|---|
| `z-0` | 0 | Default |
| `z-10` | 10 | Sticky headers |
| `z-20` | 20 | Dropdowns |
| `z-30` | 30 | Modals backdrop |
| `z-40` | 40 | Modals content |
| `z-50` | 50 | Command palette, toasts |
| `z-60` | 60 | Co-pilot FAB (cross-cutting, above modals) |

---

## 11. Component patterns

### 11.1 Cards

Every list item uses the Card pattern:

- `bg-card` (`#18181B`)
- `radius-lg` (10px)
- `padding-6` (24px)
- 1px hairline border (`elevation-0`)
- Hover: `bg-hover` + `elevation-1`

### 11.2 Buttons

| Variant | Background | Foreground | Usage |
|---|---|---|---|
| `primary` | `--primary` | white | Main CTA |
| `secondary` | `--surface` | `--text` | Secondary action |
| `ghost` | transparent | `--muted` | Tertiary |
| `danger` | `--error` | white | Destructive |
| `success` | `--success` | white | Confirm |

All buttons: `radius-md` (10px), `padding-x-4 padding-y-2`, hover state with 150ms transition.

### 11.3 Status badges

Always pair color with text + icon (never color alone — accessibility):

```tsx
<StatusPill tone="emerald">
  <CheckCircle2 className="h-3 w-3" />
  Healthy
</StatusPill>
```

`StatusPill` (added in Step 0.5-02) is the single source of truth for state-bearing chips. Seven bespoke badges (`RunStatusBadge`, `HealthBadge`, `ApprovalStatusBadge`, `ScoreBadge`, `FreshnessBadge`, `SeverityBadge`, `ConnectorStatusPill`) are thin wrappers that delegate to it.

### 11.4 Empty states

Per Rule 15 (`empty-state-with-value`):

- Lucide icon illustration (size 48–64px)
- One-line headline ("All clear — no risks")
- One-line subtext ("Try a different search")
- One primary CTA ("Create one")
- Optional: secondary CTA ("Import template")

Component: `<EmptyState />` at `apps/forge/components/empty-state.tsx`.

### 11.5 Loading states

Never use spinners for async data. Use skeleton rows that match the final shape:

```tsx
<Skeleton className="h-4 w-32" />  // for text
<Skeleton className="h-8 w-8 rounded-full" />  // for avatars
```

Chart loading: shimmer animation that mimics the chart shape.

### 11.6 Error states

Per Step 13 `ErrorState` primitive:

- Lucide icon (size 32px, `--error`)
- Pattern-recognition header ("Can't reach the orchestrator")
- One-line description
- Suggested actions (retry, contact support, view status)

Component: `<ErrorState />` at `apps/forge/components/error-state.tsx`.

### 11.7 Toasts

Bottom-right, dismissable, max 3 visible. Library: `sonner`.

- Success: emerald check + 3s auto-dismiss
- Warning: amber + 5s auto-dismiss
- Error: rose + manual dismiss

---

## 12. Cross-cutting concerns (Rule 12)

These components must be present on EVERY page, not siloed in one feature.

### 12.1 ConnectorPicker

- Trigger: `[SelectedConnector]` or `[Connect X to use this]` hint pill
- Capability filter: `<ConnectorPicker capability="send_message" />`
- Falls back to marketplace link if no installed connector matches
- Location: `components/connector-center/`

### 12.2 Co-pilot FAB

- Position: `fixed bottom-6 right-6`
- `z-index: 60` (above modals)
- Opens `<CoPilotDrawer>` with chat + tool execution
- Always accessible via `⌘⇧K` shortcut

### 12.3 ⌘K Command palette

- Global, opens via `⌘K` (mac) / `Ctrl+K` (other)
- Search: pages, agents, connectors, workflows, runs
- Actions: create new (per resource), navigate, invoke
- Traps focus, Esc closes, restores focus

### 12.4 Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘J` / `Ctrl+J` | Co-pilot drawer |
| `⌘⇧C` | Connector picker |
| `⌘⇧K` | Credential manager |
| `⌘⇧W` | Webhook manager |

All shortcuts declared in `apps/forge/lib/keyboard/registry.ts` so they're discoverable via the `?` help overlay.

---

## 13. Real-time patterns (Steps 56–59)

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

### 13.4 `LiveConnectorDataProvider` (Step 55 v2)

The connector center distinguishes three states to avoid silently swapping in mock data:

| API state | UI behavior |
|---|---|
| Loading | Skeleton rows matching `CONNECTORS` shape |
| Returned empty | Real empty state (no mock fallback) |
| Errored | Fall back to `CONNECTORS` mock array, show subtle banner "Showing offline data" |

Only the **errored** path uses mocks. Empty results render as empty (Rule 15).

---

## 14. Approval gates (Rule 3)

Approval gates are visually distinct everywhere — never auto-advance, never silently drop.

- **`waiting_approval` state**: amber pulse + `Pause` icon + "Awaiting review" text on every chip and timeline marker
- **Inbox view**: dedicated `/approvals` page + sidebar badge with pending count
- **Inline approval**: drawer in workflow run detail with "Approve" / "Reject" buttons
- **Audit**: every decision recorded with actor + reason + timestamp
- **Visual treatment**: every approval-bearing surface reads from the same `runStates.waiting_approval` color (`#F97316`) + pulse keyframe — never a local re-color

NEVER auto-advance past an approval gate. NEVER silently drop a pending approval.

---

## 15. Multi-tenant chrome (Rule 2)

Every page surfaces:

- **Tenant switcher** (top-left, shows current tenant name + chevron)
- **Project context** (if applicable, shows project name + breadcrumbs)
- **User identity** (top-right avatar + persona chip)

The shell reads these from `useTenant()` + `useProject()` + `useAuth()` hooks. NEVER read from URL params or localStorage in components.

Every backend call carries `tenant_id` + `project_id` (Rules 2, 6). Audit rows and KG nodes are no exception. The JWT-derived tenant context is plumbed through `lib/tenant/`.

---

## 16. Phase 6 reorientation — LiteLLM as source of truth

Per the Step 59 reorientation, Forge is a UI on top of LiteLLM (not a competing LLM platform). Forge UI components in the LLM control plane:

- `apps/forge/app/admin/llm-gateway/` — Tenant + Key + MCP + Health
- `apps/forge/app/governance-center/` — Policies + Guardrails + Standards
- `apps/forge/app/analytics/` — Cost trend + Spend by model
- `apps/forge/app/audit/page.tsx` — Forge audit + LLM traffic tabs

What Forge UI reads from LiteLLM (via the `litellm_admin` SDK in `backend/app/services/litellm_admin.py`):

| Domain | LiteLLM endpoint | Forge surface |
|---|---|---|
| Cost tracking | `/spend/logs`, `/spend/teams`, `/global/spend` | `analytics/`, `terminal_costs` |
| Guardrails | `/guardrails/list` | `governance-center/policies` |
| Virtual keys | `/key/generate`, `/key/info` | `admin/llm-gateway/keys` |
| Spend aggregation | `/spend/teams`, `/spend/models` | `admin/llm-gateway/usage` |
| Models catalog | `/models` | `admin/llm-gateway/models` |
| MCP servers | `/mcp/tools` | `admin/llm-gateway/mcp` |
| Failed-request guardrail violations | `/spend/logs?status=failure` | `governance-center/violations` |

**Rule**: never reimplement what LiteLLM provides. If a feature exists in LiteLLM, the Forge backend proxies it; if it doesn't exist in LiteLLM, it's Forge-specific (workflows, agents, ideas).

The 4 seeded LiteLLM guardrails (`pii_masking`, `prompt_injection_detection`, `content_moderation`, `secret_detection`) surface in `governance-center/policies` as first-class toggles.

---

## 17. Accessibility

WCAG 2.2 AA is the constitutional floor.

- All interactive elements: `focus-visible:ring-2 ring-offset-2 ring-offset-background ring-primary`
- Color is NEVER the only signal — always pair with icon + text
- ARIA labels on all icon-only buttons
- Tab order = DOM order
- Modals trap focus, restore on close
- All forms have visible labels (`sr-only` acceptable)
- Live regions for KPI deltas + run state changes
- Honors `prefers-reduced-motion` (see §8.3)
- Honors `prefers-color-scheme` (only dark by default, but light defined)
- Skip-to-content link is the first focusable element in `<body>`
- Status indicators always pair color with a label, icon, or text

---

## 18. Internationalization (future)

Currently English-only. When adding i18n:

- All strings in `apps/forge/lib/i18n/messages/en.json`
- Currency: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`
- Dates: `Intl.DateTimeFormat()` (relative formatting in `apps/forge/lib/format.ts`)
- Numbers: locale-aware (e.g. 1,000 vs 1.000)

---

## 19. Performance budgets

| Metric | Budget |
|---|---|
| Largest Contentful Paint | < 2.5s |
| First Input Delay | < 100ms |
| Cumulative Layout Shift | < 0.1 |
| Bundle size per route | < 250kb (gzipped) |
| TanStack Query `staleTime` | 15s default |
| Polling intervals | 30s for lists, 5s for active runs, 10s for SSE fallback |

---

## 20. Testing

- Every component has a `data-testid` prop wired
- Visual regression with Playwright (snapshots on PR)
- Accessibility audit with `axe-core` (in CI, gated)
- Keyboard navigation test for every interactive surface
- `prefers-reduced-motion` test on every animated component

---

## 21. File map

| Path | Purpose |
|---|---|
| `apps/forge/lib/design-system/` | Token source of truth (TypeScript) |
| `apps/forge/app/globals.css` | CSS layer (the only place HSL appears) |
| `apps/forge/tailwind.config.ts` | Tailwind binding |
| `apps/forge/components/ui/` | Shadcn/UI primitives (button, input, dialog, etc.) |
| `apps/forge/components/shell/` | App shell (Topbar, Sidebar, PageHeader, etc.) |
| `apps/forge/components/error-state.tsx` | Standard error UI |
| `apps/forge/components/empty-state.tsx` | Standard empty UI |
| `forge-design-system.md` | **Historical** design doc (superseded by this file) |
| `forge-theme-system.md` | **Historical** theme doc (merged into this file) |
| `docs/design-system-curate.md` | Design vision prompt (different purpose — kept as-is) |

---

## 22. Versioning

This document is versioned with the codebase. Breaking changes require:

1. Update this file in the same PR
2. Update `forge-color-tokens.ts` and related token files
3. Migrate consumers (typed errors from codemods)
4. Visual regression test on all pages

---

## 23. References

- `forge-design-system.md` — Historical design doc (superseded)
- `forge-theme-system.md` — Historical theme doc (merged)
- `docs/design-system-curate.md` — Design vision prompt
- `docs/ARCHITECTURE.md` — System architecture
- `CLAUDE.md` — Constitutional rules
- `implementation_plan.md` — Project plan
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — Changelog conventions
- [Shadcn/UI](https://ui.shadcn.com/) — Component primitives
- [Lucide](https://lucide.dev/) — Icon library
- [Inter](https://rsms.me/inter/) — Sans font
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — Mono font

---

*Forge is not an AI agent. Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows. The design system exists to make that orchestration visible.*
