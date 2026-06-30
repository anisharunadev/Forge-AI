> ⚠️ **This document is historical and superseded by [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).**
>
> New theme / CSS-layer decisions go in `DESIGN_SYSTEM.md` (§4 Color system, §8 Motion, §9 Elevation, §21 File map). This file is preserved for context and traceability of the Phase 0.5 UI Foundation work.
>
> The canonical visual + interaction reference is **`DESIGN_SYSTEM.md`** at the repo root (~640 lines, 23 sections). The CSS-layer content of this file (HSL conversions, `:root` / `.dark` blocks, Tailwind binding rationale) has been folded into that document.

# Forge AI Theme System

> **Phase 0.5 — UI Foundation**
> Status: Plan 0.5-01 landed
> Last updated: 2026-06-23

The theme system is the runtime layer that turns the brand-locked design tokens into CSS that browsers and React can consume. It has three responsibilities:

1. **Render** — emit CSS that the browser applies to every element.
2. **Switch** — flip between dark (primary) and light (ready) without flicker.
3. **Respect** — honor user preferences (`prefers-reduced-motion`, future `prefers-contrast`).

This document explains the three layers (CSS, Tailwind, React) and how they cooperate.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  lib/design-system/                                │ ← Typed source of truth
│  forge-color-tokens.ts  (hex values)               │   (TS, consumed by Recharts,
│  forge-dark-theme.ts    (dark re-exports)          │    React Flow, fixtures)
│  forge-light-theme.ts   (light re-exports)         │
│  forge-typography.ts    (type scale)               │
│  forge-spacing.ts       (8pt grid, radius, motion) │
│  status.ts              (agent state → tone)       │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  app/globals.css                                    │ ← CSS layer
│  :root       { --background: HSL; ... }            │   (the only place HSL values
│  .dark       { --background: HSL; ... }            │    appear in the codebase)
│  @layer base { * { @apply border-border } ... }    │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  tailwind.config.ts                                 │ ← Tailwind binding
│  colors: {                                          │   (Tailwind utilities →
│    background: 'hsl(var(--background))',           │    CSS variables → runtime
│    primary: 'hsl(var(--primary))',                  │    styles)
│    agent: 'hsl(var(--agent))',                      │
│    ...                                              │
│  }                                                  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  components/                                        │ ← React layer
│  providers.tsx → NextThemesProvider (attribute=class) │
│  layout.tsx → <html className="dark">              │
│  shell/Topbar.tsx → <ThemeToggle> (sun/moon)       │
└─────────────────────────────────────────────────────┘
```

---

## Layer 1 — Tokens (TypeScript)

`apps/forge/lib/design-system/forge-color-tokens.ts` exports the brand-locked hex values as `as const` records. The hex values are mirrored in `app/globals.css` (as HSL channels) and `tailwind.config.ts` (as `hsl(var(--token))`). The two manual mirrors are intentional: tokens are the spec, CSS is the render, Tailwind is the bind.

**Why three layers?** Because each layer has a different consumer:

- **TypeScript tokens** — consumed by Recharts (color arrays for chart series), React Flow (node palettes), test fixtures, JSON exports for the API.
- **CSS variables** — the only values the browser actually renders; the `hsl()` wrapper allows opacity modifiers like `bg-primary/15`.
- **Tailwind utilities** — what application code writes 99% of the time (`bg-primary`, `text-agent`, `border-border`).

**Why not generate one from the other?** We could add a build step that reads the TS tokens and writes the CSS / Tailwind config. We deliberately chose not to, because:
1. The build step adds complexity to a TypeScript-only frontend.
2. HSL conversion of hex is a one-time, hand-verifiable change.
3. The values rarely change; when they do, three files need a 30-second manual update.

---

## Layer 2 — CSS variables

`apps/forge/app/globals.css` defines two blocks: `:root` (light) and `.dark` (primary). The `className="dark"` on `<html>` in `app/layout.tsx` selects the dark block at SSR; the `next-themes` `<ThemeProvider>` toggles the class at runtime when the user clicks the theme toggle.

### Why HSL channels (not hex)?

shadcn/ui primitives — and most of the Tailwind ecosystem — expect CSS variables to be HSL channels (`H S% L%`) so utilities like `bg-primary/15` (which compiles to `hsl(var(--primary) / 0.15)`) work for opacity. Storing hex (`#6366F1`) directly in a CSS variable would break the opacity modifier.

The conversion from the user's hex codes to HSL is exact to < 0.5% per channel — visually identical, fully brand-locked.

### `:root` (light)

```css
:root {
  --background: 0 0% 98%;
  --foreground: 240 5% 10%;
  --primary: 244 75% 57%;
  --agent: 192 91% 36%;
  /* ... */
}
```

### `.dark` (primary)

```css
.dark {
  --background: 240 10% 4%;   /* #09090B */
  --foreground: 0 0% 98%;     /* #FAFAFA */
  --primary: 239 84% 67%;     /* #6366F1 */
  --agent: 189 94% 43%;       /* #06B6D4 */
  /* ... */
}
```

### `@layer base`

The body rule lives inside `@layer base`, which means it loses specificity battles against any un-layered rule in the cascade. The previous Phase B globals had the body rule *outside* `@layer base`, which broke the dark→light toggle. This is fixed in 0.5-01.

### `prefers-reduced-motion`

A global media query collapses all transitions to 0.01ms when the user has reduced motion enabled. This is a constitutional a11y invariant, not a nice-to-have.

---

## Layer 3 — Tailwind binding

`apps/forge/tailwind.config.ts` consumes the CSS variables and exposes them as Tailwind utilities:

```ts
colors: {
  background: 'hsl(var(--background))',
  primary: {
    DEFAULT: 'hsl(var(--primary))',
    foreground: 'hsl(var(--primary-foreground))',
  },
  agent: {
    DEFAULT: 'hsl(var(--agent))',
    foreground: 'hsl(var(--primary-foreground))',
  },
  // ...
}
```

This means `bg-primary`, `text-primary-foreground`, `bg-agent/15`, `border-border` all work and resolve to the current theme's values.

### Deprecated `forge-*` ramp

The old `text-forge-300`, `bg-forge-800`, `border-forge-700` ramp is **kept as a backwards-compat alias** so Plan 0.5-02/05 can migrate one file at a time. New code MUST use semantic tokens. The ESLint rule in `apps/forge/.eslintrc.json` (added in 0.5-01) warns on new hex literals; it will become an error after 0.5-02 lands.

### Type scale, radius, elevation, motion

Also extended in `tailwind.config.ts`:

- `text-2xs` through `text-7xl` (matches the design system spec).
- `rounded-sm` through `rounded-3xl` (6 steps + `full`).
- `shadow-elev-{xs,sm,md,lg,xl}` (linear-style subtle shadows).
- `shadow-glow-{primary,agent,execution,review,success,destructive}` (AI-native glows).
- `duration-{fast,base,slow,slower}` (matches the motion spec).
- `ease-{standard,decelerate,accelerate}` (Linear-style cubic-beziers).
- `animate-pulse-agent` (1.6s, for thinking agents).
- `animate-spin-execution` (1.2s, for executing agents).

---

## Layer 4 — React (theme provider + toggle)

`apps/forge/components/providers.tsx` wraps the app in `next-themes`'s `<ThemeProvider>`:

```tsx
<NextThemesProvider
  attribute="class"
  defaultTheme="dark"
  enableSystem={false}
  themes={['dark', 'light']}
>
  ...
</NextThemesProvider>
```

- `attribute="class"` toggles the `className` on `<html>` (`dark` / `light`).
- `defaultTheme="dark"` makes dark the SSR default.
- `enableSystem={false}` prevents the user's OS preference from overriding the default (we want a consistent dark-first experience).
- `themes={['dark', 'light']}` whitelists exactly two themes; the toggle in `<Topbar>` (Plan 0.5-03) flips between them.

`app/layout.tsx` sets `<html className="... dark">` so the dark theme is applied before hydration, preventing the flash-of-light-content that would otherwise occur during SSR.

---

## Why `next-themes` and not a custom provider?

We evaluated three options:

1. **`next-themes`** — small, well-maintained, handles SSR + localStorage + system preference + view transitions. Chosen.
2. **`use-dark-mode` + custom hook** — older API, doesn't handle view transitions or the `prefers-color-scheme` opt-out cleanly.
3. **Custom provider** — would re-implement features `next-themes` already provides.

The package is ~1KB gzipped and has no runtime peer dependencies. The only configuration we override is `enableSystem={false}` because dark is the brand promise.

---

## How to add a new token

1. Add the hex value to `lib/design-system/forge-color-tokens.ts` (both `forgeDark` and `forgeLight` if it has both a dark and a light value).
2. Add the HSL channel to `app/globals.css` in both `:root` and `.dark`.
3. Add the Tailwind binding to `tailwind.config.ts` under `theme.extend.colors`.
4. Use the new utility in a component.
5. Verify the contrast ratio with `scripts/contrast-check.ts` (added in Plan 0.5-07).

---

## What this system does NOT do

- **Persist user preference to the server.** Theme is a client-only setting; the backend has no opinion. If a tenant operator wants to *force* light/dark for all users, they set `defaultTheme` in `providers.tsx`.
- **Sync theme across tabs.** `next-themes` does sync via `localStorage`; we do not add any additional sync.
- **Animate the theme transition.** `disableTransitionOnChange={false}` means CSS transitions DO animate when the theme changes. This is intentional — the brand promise is "feels like the future," and a 200ms color transition is part of that.
- **Support `prefers-color-scheme`.** Explicitly disabled via `enableSystem={false}` to deliver a consistent brand experience.

---

## Verification

To verify the theme system works end-to-end:

1. `pnpm dev` — open the app, confirm the dark theme renders.
2. Click the theme toggle in `<Topbar>` (added in Plan 0.5-03) — confirm the light theme renders without flicker.
3. Open DevTools → Application → Local Storage → confirm `theme` is set to `dark` or `light`.
4. Open DevTools → Rendering → "Emulate CSS media feature: prefers-reduced-motion: reduce" — confirm transitions collapse.
5. Run `pnpm test:e2e` — confirm the 13 existing e2e tests still pass (no theme-related regressions).
6. (Plan 0.5-07) Run `pnpm test:a11y` — confirm axe-core reports 0 serious/critical violations.

---

*Dark mode is the primary experience. Light is ready. The system is reversible in one line.*
