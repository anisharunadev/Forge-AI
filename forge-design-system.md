# Forge AI Design System

> **Phase 0.5 — UI Foundation**
> Status: Plan 0.5-01 landed; Plans 0.5-02..07 in progress
> Last updated: 2026-06-23

Forge AI is the operating system that orchestrates agents, knowledge, governance, and delivery workflows. Its design system exists to make that orchestration *visible* — to answer at a glance *what agents are running, what they are thinking, what the cost is, what is blocked, what is deployable.*

This document is the canonical reference for the visual language. The token source of truth lives in code at `apps/forge/lib/design-system/`. The CSS layer that renders it is at `apps/forge/app/globals.css`.

---

## Brand personality

- **Intelligent** — every signal means something; no decoration.
- **Technical** — built for engineers; no marketing flourish.
- **Premium** — enterprise-grade spacing, motion, and detail.
- **Fast** — every interaction feels instant.
- **Autonomous** — users supervise agents rather than perform manual work.
- **Futuristic** — without looking like science fiction.

Visual references: Linear × Vercel × GitHub × Cursor × Anthropic Console.

---

## Design principles

### 1. Information first

No decorative UI. Every pixel serves a purpose.

**Avoid:**
- Giant hero sections
- Oversized cards with empty space
- Excessive gradients
- Marketing-style illustrations

**Prefer:**
- Dense, scannable layouts
- Hairline borders over heavy shadows
- Type as the primary visual element

### 2. Density with clarity

Engineers need information. Optimize for **high signal, low noise**.

- 8pt grid spacing (with 4pt micro-step)
- Type scale that supports both 11px captions and 48px displays
- 4xl max-width containers, 7xl for data-heavy views

### 3. Dark mode first

Forge AI will be used all day. The dark theme is the primary experience.

- `defaultTheme="dark"` in `<ThemeProvider>`
- `<html className="dark">` is the SSR default
- Light theme is **defined and wired** but not promoted; operators can flip the default by changing one line
- Dark surfaces are **near-black slate** (`#09090B` → `#18181B`), not pure black — pure black looks broken on OLED and doesn't read as "premium"

### 4. AI-native experience

Users should always know:

- What agents are running (AgentCard on every list)
- What agents are thinking (AgentTimeline with reasoning summaries)
- Current execution state (the 6 agent states are a first-class primitive)
- Progress (live progress bars, never static)
- Confidence (validation reports surface confidence scores)
- Cost (CostTracker is in the sidebar, not buried in settings)
- Context (every action links to its lineage in the audit log)

The 6 agent states — `idle / thinking / executing / reviewing / completed / failed` — are the heart of Forge's visual identity. Every place an agent appears (card, timeline, badge, sidebar pill, KG node, chat avatar) renders with the corresponding state color. A user should be able to read the dashboard and know the operational state without clicking anything.

---

## Color system

The brand-locked palette the user specified:

### Dark theme (primary)

| Token | Hex | Use |
|---|---|---|
| `background` | `#09090B` | App canvas |
| `surface` | `#111113` | Section dividers, popover background |
| `card` | `#18181B` | Card surfaces |
| `border` | `#27272A` | Hairline borders |
| `primary` | `#6366F1` | Brand / interactive accent (indigo) |
| `success` | `#22C55E` | Completed, healthy |
| `warning` | `#F59E0B` | Stale approval, attention |
| `destructive` | `#EF4444` | Failed, error |
| `agent` | `#06B6D4` | Agent status (cyan) |
| `execution` | `#8B5CF6` | Agent executing (violet) |
| `review` | `#F97316` | Review, validation (orange) |
| `foreground` | `#FAFAFA` | Primary text |
| `muted-foreground` | `#A1A1AA` | Secondary text, idle state |

### Light theme (defined for parity)

| Token | Hex | Use |
|---|---|---|
| `background` | `#FAFAFA` | App canvas |
| `surface` | `#F4F4F5` | Section dividers |
| `card` | `#FFFFFF` | Card surfaces |
| `border` | `#E4E4E7` | Hairline borders |
| `primary` | `#4F46E5` | Brand accent |
| `success` | `#16A34A` | Completed, healthy |
| `warning` | `#F59E0B` | Stale approval, attention |
| `destructive` | `#DC2626` | Failed, error |
| `agent` | `#0891B2` | Agent status |
| `execution` | `#7C3AED` | Agent executing |
| `review` | `#EA580C` | Review, validation |
| `foreground` | `#18181B` | Primary text |
| `muted-foreground` | `#71717A` | Secondary text |

### Semantic role mapping

| Token | Tailwind class | Use |
|---|---|---|
| `background` | `bg-background` | The page |
| `card` | `bg-card` | Card surface |
| `popover` | `bg-popover` | Floating panels |
| `border` | `border-border` | Hairline dividers |
| `primary` | `bg-primary` / `text-primary` | Brand, interactive |
| `muted` | `bg-muted` | Subdued surfaces |
| `muted-foreground` | `text-muted-foreground` | Secondary text |
| `success` | `bg-success` / `text-success` | Healthy, completed |
| `warning` | `bg-warning` / `text-warning` | Stale, attention |
| `destructive` | `bg-destructive` / `text-destructive` | Errors, failures |
| `agent` | `bg-agent` / `text-agent` | Agent state channel |
| `execution` | `bg-execution` / `text-execution` | Live execution channel |
| `review` | `bg-review` / `text-review` | Review channel |
| `cost` | `bg-cost` / `text-cost` | Cost indicator |

### AI state palette

| State | Foreground | Background | Tailwind classes |
|---|---|---|---|
| `idle` | `#A1A1AA` | `#27272A` | `text-muted-foreground` / `bg-muted` |
| `thinking` | `#06B6D4` | `#0E2A33` | `text-agent` / `bg-agent/15` |
| `executing` | `#8B5CF6` | `#241B3A` | `text-execution` / `bg-execution/15` |
| `reviewing` | `#F97316` | `#3A1F0E` | `text-review` / `bg-review/15` |
| `completed` | `#22C55E` | `#0F2A1A` | `text-success` / `bg-success/15` |
| `failed` | `#EF4444` | `#3A0F0F` | `text-destructive` / `bg-destructive/15` |

---

## Typography

- **Display + body:** Inter (400, 500, 600, 700) via `next/font/google`
- **Code + IDs + hashes:** JetBrains Mono (400, 500, 600) via `next/font/google`
- **Type scale:** minor-third ratio (1.125x) for display; tighter 1.067x for body

| Token | Size | Use |
|---|---|---|
| `display-2xl` | 72px | Hero numbers (rare) |
| `display-xl` | 60px | Hero numbers |
| `display-lg` | 48px | Section openers |
| `h1` | 36px | Page title |
| `h2` | 30px | Major section |
| `h3` | 24px | Subsection |
| `h4` | 20px | Card title |
| `h5` | 18px | Sub-card title |
| `h6` | 16px | Inline header |
| `body-lg` | 18px | Lead paragraph |
| `body` | 16px | Default body |
| `body-sm` | 14px | Secondary body |
| `caption` | 12px | Metadata |
| `eyebrow` | 11px | Section label (uppercase, tracking-wider) |
| `code` | 14px | Inline code, IDs |

**Type rules:**
- No `text-[Npx]` arbitrary values — use the `2xs/xs/sm/.../7xl` scale.
- Eyebrows are always `text-2xs uppercase tracking-wider text-muted-foreground` (or the `text-agent`/`text-primary` variant).
- Numeric figures (cost, percentage, count) use `font-variant-numeric: tabular-nums` for column alignment.

---

## Spacing

8pt grid with a 4pt micro-step for fine alignment.

| Token | Value | Use |
|---|---|---|
| `1` | 4px | Micro-alignment |
| `2` | 8px | Inline rhythm |
| `3` | 12px | Card padding (compact) |
| `4` | 16px | Card padding (default) |
| `6` | 24px | Section padding |
| `8` | 32px | Page padding |
| `12` | 48px | Major sections |
| `16` | 64px | Page top/bottom |
| `24` | 96px | Hero whitespace |

---

## Border radius

Six steps, plus `full` for pills:

| Token | Value | Use |
|---|---|---|
| `sm` | 6px | Inner elements (badges) |
| `md` | 10px | Default (buttons, inputs, cards) |
| `lg` | 14px | Card on a card |
| `xl` | 18px | Dialog |
| `2xl` | 24px | Hero panels |
| `3xl` | 32px | Oversized surfaces |
| `full` | 9999px | Pills, avatars |

The default radius is `md` (10px) — matches shadcn/ui convention.

---

## Elevation

Subtle, designed for dark-mode clarity. Heavy drop shadows look wrong on near-black surfaces; we use tight inner glows and small outer halos.

| Token | Use |
|---|---|
| `elev-xs` | Default card |
| `elev-sm` | Card on hover |
| `elev-md` | Popover |
| `elev-lg` | Dialog |
| `elev-xl` | Modal (rare) |
| `glow-primary` | Active stage chip |
| `glow-agent` | Thinking agent |
| `glow-execution` | Executing agent |
| `glow-review` | Reviewing agent |
| `glow-success` | Completed run |
| `glow-destructive` | Failed run |

---

## Motion

The user-specified 150/200/250ms core transitions. All animations respect `prefers-reduced-motion` (collapse to 0.01ms).

| Token | Duration | Use |
|---|---|---|
| `instant` | 0ms | Disabled (reduced-motion) |
| `fast` | 150ms | Hover, focus, micro-interactions |
| `base` | 200ms | Default state transitions |
| `slow` | 250ms | Drawer, sheet, modal |
| `slower` | 300ms | Page-level transitions |

| Easing | Use |
|---|---|
| `standard` | `cubic-bezier(0.2, 0, 0, 1)` (Linear-style) |
| `decelerate` | `cubic-bezier(0, 0, 0.2, 1)` (entering) |
| `accelerate` | `cubic-bezier(0.4, 0, 1, 1)` (exiting) |
| `spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` (playful) |

**Animation rules:**
- Use `pulse-agent` (1.6s) for thinking agents, not the default `animate-pulse`.
- Use `spin-execution` (1.2s) for executing agents.
- Use `pulse-glow` only for the brand mark and one or two hero callouts.
- Avoid animating layout (`width`, `height`); animate `transform` and `opacity` only.

---

## Iconography

- **Library:** `lucide-react` (already a dependency).
- **Stroke width:** 1.75 (slightly thinner than lucide default for a more refined feel).
- **Size scale:** 12px (inline), 16px (default), 20px (section header), 24px (page header).
- **State colors:** icons that represent state should pull from the AI state palette, not the generic success/warning palette.

---

## Accessibility

- **Standard:** WCAG 2.2 AA.
- **Contrast:** every semantic token pair (foreground on background, primary on card, etc.) clears 4.5:1 in both themes.
- **Focus state:** `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`.
- **Reduced motion:** global `@media (prefers-reduced-motion: reduce)` rule collapses all transitions.
- **Keyboard navigation:** sidebar, command palette, modals, tabs all keyboard-accessible. Tab order matches visual order.
- **Screen reader:** every interactive element has a meaningful `aria-label` or text content. The skip-link is the first focusable element in `<body>`.
- **Status indicators:** always pair color with a label, icon, or text. Color is never the only signal.

---

## Component taxonomy

The Forge design system is organized into five families:

1. **Primitives** (`components/ui/*`) — shadcn/ui base, themed to Forge tokens. Button, Card, Dialog, Input, Label, Select, Tabs, Sheet, DropdownMenu, ScrollArea, Separator, Textarea, Toast, Toaster, Tooltip, Command, Skeleton (new), Checkbox (new), Alert (new), Popover (new), NavigationMenu (new), Table (new), Pagination (new), Breadcrumb (new), Avatar (new), Accordion (new), Form (new).

2. **Status & display** (`components/ui/badge.tsx`, `components/shell/StatusBadge.tsx`) — single StatusBadge primitive with `tone={success|warn|danger|info|neutral|agent|execution|review|cost}`. The 7 bespoke badges (RunStatusBadge, HealthBadge, ApprovalStatusBadge, ScoreBadge, FreshnessBadge, SeverityBadge, ConnectorStatusPill) become thin wrappers in Plan 0.5-02.

3. **Shell** (`components/shell/*`) — Sidebar, MobileNav, Topbar, CommandPalette, CenterShell, PageHeader, EntityCard, EmptyState, Skeleton, RequirePermission.

4. **Data** (`components/data/*`) — DataTable (TanStack Table + virtual), Form (RHF + zod), DataToolbar, FilterChip, TabsNav, chart wrappers.

5. **AI-native** (`components/ai/*`) — AgentCard, AgentTimeline, ExecutionGraph, CostTracker, DeliveryHealth, SprintVelocity, AgentActivityFeed, WorkflowVisualizer, AIReasoningPanel, TaskDependencyMap.

---

## How to use this system

### 1. Always use semantic tokens

```tsx
// ❌ Bad: hardcoded color
<div className="bg-[#6366F1]">Agent running</div>

// ✅ Good: semantic token
<div className="bg-primary text-primary-foreground">Agent running</div>

// ✅ Better: agent state channel
<StatusBadge tone="execution">Executing</StatusBadge>
```

### 2. Compose from primitives

```tsx
// ❌ Bad: hand-rolled card
<div className="rounded-lg border border-forge-700/60 bg-forge-800/60 p-5">
  ...
</div>

// ✅ Good: shadcn Card
<Card>
  <CardHeader>
    <CardTitle>Agent status</CardTitle>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

### 3. Use the type scale

```tsx
// ❌ Bad: arbitrary size
<p className="text-[10px] uppercase tracking-wider text-forge-400">Section</p>

// ✅ Good: type-scale token + semantic color
<p className="text-2xs uppercase tracking-wider text-muted-foreground">Section</p>
```

### 4. Use AI-native channels for AI state

```tsx
// ❌ Bad: generic success/warning for an agent
<Badge className="bg-emerald-500/15 text-emerald-300">Running</Badge>

// ✅ Good: execution channel
<StatusBadge tone="execution">Executing</StatusBadge>
```

---

## What is NOT in this system

- **Tailwind 4.** Locked to 3.4.x per HYG-01 (deferred post-pilot).
- **Real-time CRDT collaboration.** Phase 2 deferred.
- **Mobile native client.** v3+ per ROADMAP deferred items.
- **Full i18n.** Out of scope for Phase 0.5.
- **Light theme polish.** Dark-first; light is "ready" but not the default.
- **Hardcoded colors.** Banned by ESLint rule (added in Plan 0.5-01; will become an error after 0.5-02 lands).

---

## Related documents

- [`forge-theme-system.md`](./forge-theme-system.md) — the CSS layer and theme plumbing.
- [`lib/design-system/`](./apps/forge/lib/design-system/) — the typed source of truth.
- [`forge-component-library.md`](./forge-component-library.md) — coming in Plan 0.5-07.
- [`forge-screen-redesign.md`](./forge-screen-redesign.md) — coming in Plan 0.5-07.
- [`forge-ui-modernization-report.md`](./forge-ui-modernization-report.md) — coming in Plan 0.5-07.

---

*Forge is not an AI agent. Forge is the operating system that orchestrates agents, knowledge, governance, and delivery workflows. The design system exists to make that orchestration visible.*
