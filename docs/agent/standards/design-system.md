# Standard: Design System

> **Status:** ✅ Canonical — every UI surface in Forge follows these tokens + patterns
> **Doc owner:** Design team
> **Source of truth:** `~/forge-ai/forge-design-system.md` + `~/forge-ai/forge-theme-system.md`
> **Last updated:** 2026-06-30

---

## Purpose

Forge is built to be **read at a glance**. An operator should know what agents are running, what they are thinking, what the cost is, what is blocked, and what is deployable — without clicking anything. This document codifies the **visual language** that makes that possible: color tokens, typography, spacing, motion, and component patterns.

---

## Source of truth

- **This file** — `/workspace/docs/standards/design-system.md` (the canonical expansion)
- **TypeScript tokens** — `apps/forge/lib/design-system/forge-color-tokens.ts` (single source of truth for values)
- **CSS layer** — `apps/forge/app/globals.css` (the only place HSL values appear)
- **Tailwind binding** — `apps/forge/tailwind.config.ts` (utilities → CSS variables)
- **Curated spec** — `forge-design-system.md` (brand personality + principles)

---

## 1. Brand personality

> **Intelligent — every signal means something; no decoration.**
> **Technical — built for engineers; no marketing flourish.**
> **Premium — enterprise-grade spacing, motion, and detail.**
> **Fast — every interaction feels instant.**
> **Autonomous — users supervise agents rather than perform manual work.**
> **Futuristic — without looking like science fiction.**

Visual references: **Linear × Vercel × GitHub × Cursor × Anthropic Console**.

---

## 2. Design principles

### 2.1 — Information first

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

### 2.2 — Density with clarity

Engineers need information. Optimize for **high signal, low noise**.

- 8pt grid spacing (with 4pt micro-step)
- Type scale supporting both 11px captions and 48px displays
- 4xl max-width containers, 7xl for data-heavy views

### 2.3 — Dark mode first

Forge is used all day. The dark theme is the primary experience.

- `defaultTheme="dark"` in `<ThemeProvider>`
- `<html className="dark">` is the SSR default
- Light theme is **defined and wired** but not promoted
- Dark surfaces are near-black slate (`#09090B` → `#18181B`), not pure black — pure black looks broken on OLED

### 2.4 — AI-native experience

Users should always know:

- What agents are running (AgentCard on every list)
- What agents are thinking (AgentTimeline with reasoning summaries)
- Current execution state (the 6 agent states are a first-class primitive)
- Progress (live progress bars, never static)
- Confidence (validation reports surface confidence scores)
- Cost (CostTracker is in the sidebar, not buried in settings)
- Context (every action links to its lineage in the audit log)

The **6 agent states** (`idle / thinking / executing / reviewing / completed / failed`) are the heart of Forge's visual identity. Every place an agent appears (card, timeline, badge, sidebar pill, KG node, chat avatar) renders with the corresponding state color.

---

## 3. Color system

### 3.1 — Dark theme (primary)

| Token | Hex | HSL | Use |
|---|---|---|---|
| `background` | `#09090B` | `240 10% 4%` | App canvas |
| `surface` | `#111113` | `240 6% 7%` | Section dividers, popover |
| `card` | `#18181B` | `240 6% 10%` | Card surfaces |
| `hover` | `#1F1F23` | `240 5% 14%` | Card hover state |
| `border` | `#27272A` | `240 5% 16%` | Hairline borders |
| `primary` | `#6366F1` | `239 84% 67%` | Brand / interactive (indigo) |
| `success` | `#22C55E` | `142 71% 45%` | Completed, healthy |
| `warning` | `#F59E0B` | `38 92% 50%` | Stale approval, attention |
| `destructive` | `#EF4444` | `0 84% 60%` | Failed, error |
| `agent` | `#06B6D4` | `188 94% 43%` | Agent identity (cyan) |
| `execution` | `#8B5CF6` | `258 90% 66%` | Agent executing (violet) |
| `review` | `#F97316` | `20 90% 50%` | Review, validation (orange) |
| `foreground` | `#FAFAFA` | `0 0% 98%` | Primary text |
| `muted-foreground` | `#A1A1AA` | `240 4% 65%` | Secondary text |
| `subtle` | `#71717A` | `240 4% 46%` | Idle / quiet (darker than muted) |

### 3.2 — Light theme (companion, not default)

| Token | Hex | Use |
|---|---|---|
| `background` | `#FFFFFF` | App canvas |
| `surface` | `#F8F8FA` | Section dividers |
| `card` | `#FFFFFF` | Card surfaces |
| `border` | `#E4E4E7` | Hairline borders |
| `primary` | `#4F46E5` | Brand accent |
| `agent` | `#0891B2` | Agent status |
| `foreground` | `#18181B` | Primary text |

### 3.3 — AI-native channels (4 colors)

| Channel | Color | Hex | Used by |
|---|---|---|---|
| **Agent identity** | Cyan | `#06B6D4` | Avatars, names, "who" |
| **Execution** | Violet | `#8B5CF6` | Running code, live work |
| **Review** | Orange | `#F97316` | Validation, approval |
| **Cost** | Amber | `#F59E0B` | Cost indicator (also warning) |

### 3.4 — Semantic role mapping

| Token | Tailwind class | Use |
|---|---|---|
| `background` | `bg-background` | The page |
| `surface` | `bg-surface` | Section dividers |
| `card` | `bg-card` | Cards |
| `primary` | `bg-primary` | Interactive (buttons, links) |
| `success` | `bg-success` / `text-success` | Healthy, completed |
| `destructive` | `bg-destructive` / `text-destructive` | Failed, error |
| `agent` | `bg-agent` / `text-agent` | Agent identity |
| `execution` | `bg-execution` | Live execution |
| `review` | `bg-review` | Review state |

### 3.5 — 6 agent states (with glyph + pulse)

Every agent state pairs a **color** (channel), a **glyph** (symbol), and a **pulse** (animation hint). Color is NEVER the only signal — glyph + label always present.

| State | Color | Hex | Glyph | Pulse | Label |
|---|---|---|---|---|---|
| `idle` | gray | `#71717A` | `○` | none | Idle |
| `thinking` | blue | `#3B82F6` | `◐` | slow | Thinking |
| `executing` | violet | `#8B5CF6` | `●` | active | Executing |
| `reviewing` | orange | `#F97316` | `◑` | slow | Reviewing |
| `completed` | green | `#22C55E` | `✓` | fast-to-static | Completed |
| `failed` | red | `#EF4444` | `✕` | none | Failed |

> **Important:** `agent` (cyan) is the **identity** channel; `thinking` (blue) is a **state** — distinct from agent identity. Don't conflate.

---

## 4. Typography

### 4.1 — Type scale (1.25 modular)

| Token | Size | Line height | Letter spacing | Weight | Use |
|---|---|---|---|---|---|
| `12` | 12px | 16px | 0 | 400 | Dense tables |
| `13` | 13px | 19px | 0 | 400 | Default UI |
| `14` | 14px | 22px | 0 | 400 | Reading |
| `16` | 16px | 24px | 0 | 400 | Body-lg |
| `20` | 20px | 28px | -0.01em | 600 | h4 |
| `24` | 24px | 32px | -0.015em | 600 | h3 |
| `32` | 32px | 40px | -0.02em | 600 | h2 |
| `48` | 48px | 56px | -0.025em | 600 | h1 |

### 4.2 — Font families

- **Inter** — primary UI font (loaded via `next/font/google` → CSS variable `--font-sans`)
- **JetBrains Mono** — IDs, hashes, code, contract fields (CSS variable `--font-mono`)

```css
font-family: var(--font-sans), 'Inter', ui-sans-serif, system-ui;
font-family: var(--font-mono), 'JetBrains Mono', ui-monospace;
```

### 4.3 — Eyebrow / label styles

Small uppercase letterspaced text used above titles:

```typescript
export const eyebrowTokens = {
  default: 'text-[11px] uppercase tracking-wider text-subtle',
  accent:  'text-[11px] uppercase tracking-wider text-primary',
  agent:   'text-[11px] uppercase tracking-wider text-agent',
};
```

### 4.4 — Heading hierarchy

**Always sequential** — h1 → h2 → h3, no skipped levels. This is both a design rule and an accessibility rule (R18).

```tsx
// ✅ Correct
<h1>Dashboard</h1>
  <h2>Recent activity</h2>
    <h3>Story #1234</h3>

// ❌ Skipped level
<h1>Dashboard</h1>
  <h3>Story #1234</h3>  // Skipped h2
```

---

## 5. Spacing

### 5.1 — 8pt grid (with 4pt micro-step)

| Token | Value | Pixels | Use |
|---|---|---|---|
| `2` | `0.5rem` | 8px | Tight gaps |
| `4` | `1rem` | 16px | Default padding |
| `6` | `1.5rem` | 24px | Card padding |
| `8` | `2rem` | 32px | Section dividers |
| `12` | `3rem` | 48px | Hero whitespace |
| `16` | `4rem` | 64px | Page margins |

**12 named values cover 95% of layouts.** Beyond `64`, use the `px` arbitrary unit (rare).

### 5.2 — Border radius (3 named uses)

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | Controls (buttons, inputs, tabs) |
| `--radius-md` | 8px | Cards |
| `--radius-lg` | 12px | Modals |
| `--radius-xl` | 16px | Hero cards (rare) |

### 5.3 — Elevation (shadows)

```typescript
export const elevation = {
  none: 'none',
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.4)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.5), 0 1px 2px -1px rgb(0 0 0 / 0.5)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.5), 0 2px 4px -2px rgb(0 0 0 / 0.5)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.5), 0 4px 6px -4px rgb(0 0 0 / 0.5)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5)',

  // AI-native glows
  'glow-primary':    '0 0 0 1px rgb(99 102 241 / 0.4), 0 0 24px -4px rgb(99 102 241 / 0.4)',
  'glow-agent':      '0 0 0 1px rgb(6 182 212 / 0.4), 0 0 24px -4px rgb(6 182 212 / 0.4)',
  'glow-execution':  '0 0 0 1px rgb(139 92 246 / 0.4), 0 0 24px -4px rgb(139 92 246 / 0.4)',
  'glow-review':     '0 0 0 1px rgb(249 115 22 / 0.4), 0 0 24px -4px rgb(249 115 22 / 0.4)',
};
```

---

## 6. Motion

### 6.1 — 3 named durations

| Token | Duration | Use |
|---|---|---|
| `micro` | 150ms | Hover, focus, micro-interactions |
| `standard` | 200ms | Default state transitions |
| `state` | 250ms | Drawer, sheet, modal |

**Hard rule: no motion > 400ms.**

### 6.2 — Easings

```typescript
export const motion = {
  duration: {
    instant:  '0ms',
    micro:    '150ms',
    standard: '200ms',
    state:    '250ms',
  },
  easing: {
    out:   'cubic-bezier(0, 0, 0.2, 1)',    // ease-out (Linear-style)
    in:    'cubic-bezier(0.4, 0, 1, 1)',    // ease-in
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',  // ease-in-out
  },
};
```

### 6.3 — `prefers-reduced-motion` (mandatory)

All animated components must respect the user's motion preference.

```css
@media (prefers-reduced-motion: reduce) {
  .animate-pulse,
  .animate-ping,
  .animate-spin,
  .animate-gradient,
  .shimmer,
  .tile-pulse,
  .refresh-glow,
  .stale-pulse {
    animation: none !important;
  }
}
```

**Verified at:** `apps/forge/app/globals.css` (bottom of file)

### 6.4 — Specific animations

```css
/* Skeleton shimmer (replaces spinners) */
.shimmer {
  background: linear-gradient(90deg, var(--bg-inset) 0%, rgba(255,255,255,0.04) 50%, var(--bg-inset) 100%);
  background-size: 200% 100%;
  animation: shimmer-sweep 1.4s linear infinite;
}

/* Route transitions */
.route-enter {
  animation: fade-slide-up 150ms var(--motion-ease-out) both;
}

/* AI streaming gradient text */
.animate-gradient {
  background-image: linear-gradient(90deg, var(--accent-cyan), var(--accent-primary), var(--accent-violet));
  background-size: 200% 100%;
  animation: animate-gradient 4s ease-in-out infinite;
}

/* AI thinking pulse dot */
@keyframes ai-thinking-pulse {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50%      { opacity: 1;   transform: scale(1.15); }
}
.ai-thinking-dot { animation: ai-thinking-pulse 1.6s ease-in-out infinite; }

/* Tile pulse (dashboard "jumped to" feedback) */
@keyframes tile-pulse-glow {
  0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.0); }
  35%  { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.18), 0 0 0 1px rgba(16, 185, 129, 0.55); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.0); }
}
.tile-pulse { animation: tile-pulse-glow 1.1s ease-out; }
```

---

## 7. Components

### 7.1 — shadcn/ui primitives

Forge uses **shadcn/ui** for headless primitives. Located at `apps/forge/components/ui/`:

- `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`
- `Dialog`, `Sheet`, `Popover`, `Tooltip`, `DropdownMenu`, `ContextMenu`
- `Tabs`, `Accordion`, `Collapsible`, `ScrollArea`, `Separator`
- `Toast` (Sonner), `Form`, `Label`, `Card`, `Badge`
- `Command` (the `⌘K` palette base)

**Rules:**
- **Customize via Tailwind tokens, not CSS overrides** — primitives use `hsl(var(--token))`
- **Compose, don't fork** — if you need something different, wrap the primitive
- **Dark mode by default** — primitives work in both themes via CSS variables

### 7.2 — Forge-specific components

In addition to shadcn primitives, Forge ships 19+ feature components across:
- `components/admin/` — AdminShell, AdminHeader
- `components/shell/` — Topbar, Sidebar, ShellChrome, WorkspaceSwitcher, TenantStatusFooter
- `components/copilot/` — CoPilotPanel, CoPilotFAB, MessageThread
- `components/command-center/` — CommandPalette, CommandList
- `components/connectors/` — ConnectorPicker, OAuthFlow
- `components/analytics/` — KpiTile, CostChart, ProviderLeaderboard, etc.
- `components/workflows/` — WorkflowCanvas, PhaseExecutionDrawer
- `components/seeds/` — SeedStatusPanel, SeedDiffView, SeedApplyModal, etc.
- ... etc per feature

**See:** Feature docs under `/docs/features/` for the per-feature component inventory.

### 7.3 — Icons

**All icons are `lucide-react` components.** Emoji is BANNED (R17).

```tsx
// ✅ Correct
import { Activity, Bot, Settings as SettingsIcon } from "lucide-react";

<Activity className="h-4 w-4" aria-hidden="true" />

// ❌ Emoji as UI icon
<span>🚀</span>
```

### 7.4 — Loading states

**Always skeletons, never spinners.** Per R18 (accessibility), spinners are visually disruptive and don't communicate what's loading.

```tsx
// ✅ Skeleton with shimmer
{isLoading ? (
  <div className="shimmer h-32 w-full rounded-md" />
) : (
  <DataView data={data} />
)}

// ❌ Spinner (banned)
{isLoading && <Spinner />}
```

### 7.5 — Empty states

Every list/grid renders a typed empty state with **two CTAs** and **suggestion chips**:

```tsx
<div className="flex flex-col items-center gap-4 py-12">
  <BarChart3 className="h-12 w-12 text-subtle" aria-hidden="true" />
  <h3 className="text-lg font-semibold">No reports yet</h3>
  <p className="text-sm text-muted-foreground">
    Run your first validation scan to see results here.
  </p>
  <div className="flex gap-2">
    <Button>Run scan</Button>
    <Button variant="outline">How it works</Button>
  </div>
  <div className="flex gap-1.5">
    {['forge-review', 'forge-arch-adr', 'forge-test-unit', 'forge-deploy-preview'].map(s => (
      <SuggestionChip key={s} command={s} />
    ))}
  </div>
</div>
```

### 7.6 — Error states

**Typed messages, never raw stack traces.**

```tsx
// ✅ Typed
{isError && (
  <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
    <p className="font-semibold text-destructive">Failed to load reports</p>
    <p className="text-sm text-muted-foreground">{error.message}</p>
    <Button onClick={() => refetch()} variant="outline" size="sm" className="mt-2">
      Retry
    </Button>
  </div>
)}

// ❌ Raw stack trace
{isError && <pre>{error.stack}</pre>}
```

### 7.7 — Color-only signals are banned

Every state must pair color with a glyph + label (color-blind accessibility).

```tsx
// ❌ Color only
<span style={{ color: 'red' }}>Error</span>

// ✅ Color + glyph + label
<span className="flex items-center gap-1 text-destructive">
  <AlertCircle className="h-3 w-3" aria-hidden="true" />
  <span>Error</span>
</span>
```

---

## 8. Layout patterns

### 8.1 — Bento grid (Dashboard)

```tsx
<div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
  {/* KPI strip (4 cards, col-span-3 each) */}
  <KpiTile className="lg:col-span-3" />
  <KpiTile className="lg:col-span-3" />
  <KpiTile className="lg:col-span-3" />
  <KpiTile className="lg:col-span-3" />

  {/* Row 1: Cost trend (col-span-8) + Runs by status (col-span-4) */}
  <CostChart className="lg:col-span-8" />
  <RunsChart className="lg:col-span-4" />

  {/* Row 2: Acceptance (col-span-4) + Agent usage (col-span-4) + Approval latency (col-span-4) */}
  <AcceptanceChart className="lg:col-span-4" />
  <AgentUsageChart className="lg:col-span-4" />
  <ApprovalLatencyArea className="lg:col-span-4" />
</div>
```

**Container width:** `max-w-[1600px]` for data-heavy views.

### 8.2 — Two-column (List + Detail)

```tsx
<div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
  <aside className="border-r border-border-subtle bg-bg-surface">
    <ListView items={items} />
  </aside>
  <main>
    <DetailView item={selectedItem} />
  </main>
</div>
```

### 8.3 — Center layout (Tabs)

```tsx
<div className="flex flex-col gap-6">
  <PageHeader eyebrow="Center" title="..." icon={<Icon />} description="..." />

  <Tabs defaultValue="overview">
    <TabsList>
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="details">Details</TabsTrigger>
      ...
    </TabsList>
    <TabsContent value="overview">...</TabsContent>
    <TabsContent value="details">...</TabsContent>
  </Tabs>
</div>
```

---

## 9. Dark theme details

### 9.1 — Why near-black, not pure black

Pure black (`#000000`) looks broken on OLED (because individual pixels turn off completely) and doesn't read as "premium." Forge uses **near-black slate** (`#09090B`) with stepped surfaces:

- Canvas: `#09090B` (page background)
- Surface: `#131316` (section dividers, popovers)
- Elevated: `#1A1A1F` (cards, modals)
- Inset: `#0E0E11` (wells, code blocks, nested inputs)

### 9.2 — Hairline borders

Use **rgba whites**, not opaque borders. They look cleaner on dark surfaces and fade gracefully.

```css
--border-subtle:  rgba(255, 255, 255, 0.06);
--border-default: rgba(255, 255, 255, 0.10);
--border-strong:  rgba(255, 255, 255, 0.16);
```

### 9.3 — Glass effects (subtle)

Use sparingly — overused glass makes the UI look "twee."

```css
backdrop-blur-sm bg-bg-elevated/80 border border-border-subtle
```

---

## 10. AI-native design patterns

### 10.1 — Always show what the agent is doing

| Surface | What it shows |
|---|---|
| `<AgentCard>` | Avatar + name + state + last action |
| `<AgentTimeline>` | Reasoning summary + tool calls + results |
| `<StatePill>` | Color + glyph + label (never color-only) |
| `<CostTracker>` | Per-agent spend (sidebar) |
| `<LineageLink>` | Audit link to every action |

### 10.2 — Streaming text

When the LLM is generating, show a **gradient text animation** + cursor.

```tsx
<span className="animate-gradient bg-clip-text text-transparent">
  {streamingText}
  <span className="ai-thinking-dot">▍</span>
</span>
```

### 10.3 — Confidence scores

Every validation report, every recommendation, every auto-classification surfaces a **confidence score**.

```tsx
<div className="flex items-center gap-2">
  <span className="text-sm font-medium">{score.toFixed(2)}</span>
  <ProgressBar value={score} tone={score > 0.8 ? 'success' : 'warning'} />
</div>
```

---

## 11. Forbidden patterns

- ❌ `bg-black` — use `bg-background` (renders `var(--bg-base)` = `#09090B`)
- ❌ `bg-white` — use `bg-card` (renders `var(--card)` = `#18181B`)
- ❌ Hardcoded hex literals — use Tailwind utilities (`bg-primary`) or CSS variables
- ❌ Emoji as UI icons (R17) — use `lucide-react`
- ❌ Spinners (banned) — use skeletons with `.shimmer`
- ❌ Color-only signals — pair with glyph + label
- ❌ Skipped heading levels (R18)
- ❌ Decorative icons (no `aria-hidden` skip)
- ❌ Motion > 400ms (hard rule)
- ❌ Animations without `prefers-reduced-motion` respect
- ❌ Missing focus rings on interactive elements

---

## 12. Verification checklist

- [ ] All colors via Tailwind utilities or CSS variables (no hex literals)
- [ ] Dark theme is the default (light is wired but not promoted)
- [ ] All 6 agent states have color + glyph + label
- [ ] All charts use the 4-channel palette (agent/execution/review/cost)
- [ ] All type uses Inter (sans) or JetBrains Mono (mono)
- [ ] All headings sequential (h1 → h2 → h3)
- [ ] All spacing on the 8pt grid (4pt micro-step)
- [ ] All radii on the 3-token system (6px / 8px / 12px)
- [ ] All motion under 400ms
- [ ] `prefers-reduced-motion` respected on every animation
- [ ] No `bg-black` / `bg-white`
- [ ] No emoji as icons
- [ ] No spinners (skeletons only)
- [ ] No color-only signals
- [ ] All interactive elements have focus rings
- [ ] All icons have `aria-hidden="true"`
- [ ] Lighthouse Accessibility ≥ 90

---

## Related docs

- [Architecture rules](./architecture-rules.md)
- [Coding standards](./coding-standards.md)
- [API conventions](./api-conventions.md)
- [Data model](./data-model.md)
- [Testing](./testing.md)
- [Git workflow](./git-workflow.md)
- [LiteLLM integration](./litellm-integration.md)
- [Forge design system spec](../forge-design-system.md) (in codebase)
- [Forge theme system spec](../forge-theme-system.md) (in codebase)
- [Token source of truth](../../codebase/forge-ai/apps/forge/lib/design-system/tokens.ts)
- [CSS layer](../../codebase/forge-ai/apps/forge/app/globals.css)
- [Tailwind binding](../../codebase/forge-ai/apps/forge/tailwind.config.ts)