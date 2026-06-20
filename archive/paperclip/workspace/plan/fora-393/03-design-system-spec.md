# Plan 3 — Design System Spec

**Issue:** [Forge AI-393](/Forge AI/issues/Forge AI-393) — UI / Visualization Spine Plan
**Owner:** Senior Engineer (primary; Designer hire pending — design-system work carved out for the future hire per the issue description)
**Mode:** planning — no code, no implementation subtasks
**Reconciles with:** [Forge AI-388](/Forge AI/issues/Forge AI-388) master plan (rev `3ea71321`); Connector Center ([Forge AI-398](/Forge AI/issues/Forge AI-398)); Audit Center + Governance Center ([Forge AI-399](/Forge AI/issues/Forge AI-399)); [tech-stack.md §11](../../project/tech-stack.md#11-customer-facing-surface); the customer standards ([customer/standards.md §7](../../customer/standards.md#7-accessibility))
**Companion plans:** [01-core-ui-module-map.md](./01-core-ui-module-map.md) · [02-react-flow-graph-spec.md](./02-react-flow-graph-spec.md) · [04-component-library-plan.md](./04-component-library-plan.md) · [05-gsd-workbench-surface-plan.md](./05-gsd-workbench-surface-plan.md)
**Charter Principle 5:** *Everything is visualized. Forge UI is the workbench.*

---

## 1. Why a design system spec, and why now

The thirteen centers in Plan 1 will be built by multiple implementers, possibly in parallel. The four React Flow canvases in Plan 2 need a shared visual language. The component library in Plan 4 needs tokens it can consume. Without a pinned design system spec, the centers drift visually and a customer CISO gets a different color for "high severity" in the Audit Center than in the Security Center.

This plan pins the visual language **before** implementation children land so the downstream work converges.

---

## 2. Foundations

### 2.1 Base: Shadcn UI

**Choice.** Shadcn UI is the base, per [tech-stack.md §11](../../project/tech-stack.md#11-customer-facing-surface).

**Why not the alternatives.**

| Alternative | Why rejected |
|------------|--------------|
| MUI | Heavy runtime; ships its own design language that fights a brand overlay |
| Ant Design | Same — and harder to fully theme |
| Tailwind UI (paid) | A paywall the customer inherits; not the open-standards posture |
| Hand-rolled primitives | Every component re-built; accessibility regressions every release |

**Why Shadcn wins for Forge AI.**

- Components live in our repo (not in `node_modules`), so the design overlay is a single PR.
- Built on Radix UI primitives, which are accessible by default (WCAG 2.2 AA).
- Tailwind-first, matching [tech-stack.md §11](../../project/tech-stack.md#11-customer-facing-surface).
- Owned by the community, not a single vendor — no surprise EOL.

### 2.2 Reconciliation note: tech-stack vs. charter

[tech-stack.md §3](../../project/tech-stack.md#3-application-frameworks) names **Next.js 14 (App Router)**. The Forge AI-393 charter names **Next.js 15 + React 19**. The design system is forward-compatible with both, but the implementation child that follows this plan must PATCH `tech-stack.md` to bump Next.js to 15 before the first center ships. This is filed as Q1 in §9.

---

## 3. KnackForge brand overlay

The brand overlay is the small, opinionated set of decisions that turn "Shadcn UI on Tailwind" into "Forge UI". It is the only thing that requires the future Designer hire to sign off.

### 3.1 Brand tokens (CSS variables)

These live as CSS custom properties on `:root` and `[data-theme="dark"]` so they cascade through Tailwind's `bg-*` / `text-*` utilities.

```css
:root {
  --brand-primary: 252 100% 68%;        /* KnackForge indigo */
  --brand-accent:  162 78%  42%;        /* KnackForge teal */
  --brand-warn:    38  92%  50%;
  --brand-danger:  0   84%  60%;
  --brand-success: 142 71%  45%;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --shadow-elev-1: 0 1px 2px rgba(0,0,0,.05), 0 1px 3px rgba(0,0,0,.10);
  --shadow-elev-2: 0 2px 4px rgba(0,0,0,.06), 0 4px 8px rgba(0,0,0,.10);
}

[data-theme="dark"] {
  --brand-primary: 252 100% 72%;
  --brand-accent:  162 78%  50%;
  --shadow-elev-1: 0 1px 2px rgba(0,0,0,.40), 0 1px 3px rgba(0,0,0,.50);
  --shadow-elev-2: 0 2px 4px rgba(0,0,0,.45), 0 4px 8px rgba(0,0,0,.55);
}
```

The tokens are the only place hex values appear. Every Shadcn override uses `hsl(var(--brand-*))`.

### 3.2 Typography scale

| Token | Size / line | Use |
|-------|------------|-----|
| `display-1` | 36 / 44 | Empty-state headlines; onboarding |
| `display-2` | 28 / 36 | Page titles |
| `heading-1` | 24 / 32 | Section titles |
| `heading-2` | 20 / 28 | Subsection titles |
| `heading-3` | 18 / 26 | Card titles |
| `body-lg` | 16 / 24 | Long-form content |
| `body` | 14 / 22 | Default body (Forge AI default — readable on dense data screens) |
| `body-sm` | 13 / 20 | Metadata |
| `caption` | 12 / 16 | Audit-trail timestamps, secondary metadata |
| `mono` | 13 / 20 | Code, IDs, hashes |

The body default is **14 / 22** (not 16 / 24) because Forge AI is a data-dense product. The Forge AI-374 PM dashboard already uses this density and customers have not pushed back.

### 3.3 Iconography

- **Lucide React** (the icon set Shadcn ships with by default).
- Icon size tokens: `xs` (12), `sm` (16), `md` (20), `lg` (24), `xl` (32).
- Decorative icons get `aria-hidden="true"`; meaningful icons get `aria-label`.
- Status icons are always paired with color + label (per WCAG 1.4.1).

---

## 4. Theme: dark and light

Both themes ship at v1.0.

### 4.1 Default per persona

| Persona | Default theme | Why |
|---------|---------------|-----|
| PM | light | Most customer PMs work daytime; print-friendly |
| Eng Lead | dark | Engineers prefer dark for long sessions |
| CTO / VP Eng | dark | Matches the existing Forge AI-374 CTO dashboard |
| Security / CISO | dark | Matches the customer CISO norm |
| Customer (any) | follows OS | `prefers-color-scheme` until they set a preference |

### 4.2 Theme persistence

- The theme is stored in a cookie (`forge-theme=light|dark|system`) scoped to the tenant subdomain.
- The cookie is set on first render via a server-side read of `prefers-color-scheme`.
- The user can override per-session via the user menu; "system" is the default for customer-facing roles.

### 4.3 Theme + audit surfaces

The Audit Center and Security Center are forced-dark when in "investigation mode" (a session-level toggle) — dark reduces visual noise on long audit sessions and is the de-facto SOC 2 reviewer expectation. The investigation mode toggle is per-user, not per-tenant.

---

## 5. Accessibility (WCAG 2.2 AA)

WCAG 2.2 AA is the production bar. Per [tech-stack.md §11](../../project/tech-stack.md#11-customer-facing-surface), axe-core runs in CI and a manual screen-reader pass runs per release.

### 5.1 Concrete conformance checklist

| WCAG criterion | How we meet it | Owner |
|----------------|----------------|-------|
| 1.1.1 Non-text content | All icons have `aria-label`; all images have `alt` | Plan 4 |
| 1.3.1 Info and relationships | Semantic HTML; ARIA only when semantic HTML is impossible | Plan 4 |
| 1.4.1 Use of color | Color is always paired with shape or label (status badges, graph edges) | Plan 2 + Plan 4 |
| 1.4.3 Contrast (minimum) | All text ≥ 4.5:1 in both themes (verified via tokens) | Plan 3 |
| 1.4.11 Non-text contrast | Graph edges, borders, icons ≥ 3:1 | Plan 2 |
| 1.4.12 Text spacing | Line height / letter spacing tokens preserve readability at 200% spacing | Plan 3 |
| 2.1.1 Keyboard | Every interaction reachable by keyboard (Tab, arrow keys) | Plan 4 |
| 2.4.3 Focus order | DOM order matches visual order | Plan 4 |
| 2.4.7 Focus visible | A `focus-visible` ring on every interactive element | Plan 3 |
| 2.5.5 Target size (AAA-included AA in 2.2) | All targets ≥ 24×24 px (we ship at 32 for primary, 24 for secondary) | Plan 3 |
| 3.3.2 Labels or instructions | Every form input has a label; every select has an accessible name | Plan 4 |
| 4.1.2 Name, role, value | All custom widgets expose ARIA correctly (Plan 4 owns) | Plan 4 |
| 2.4.11 Focus not obscured (2.2) | Sticky headers and modals do not cover the focused element | Plan 4 |
| 2.5.8 Target size (minimum, 2.2) | Inline links ≥ 24 px tall | Plan 4 |
| 3.3.7 Redundant entry (2.2) | We do not ask for the same value twice in one form | Plan 4 |
| 3.3.8 Accessible authentication (2.2) | We do not use cognitive function tests; SSO is the default per [tech-stack.md §9](../../project/tech-stack.md#9-authentication-authorisation-identity) | Auth (Forge AI-123) |

### 5.2 The accessibility testing harness

Per [tech-stack.md §11](../../project/tech-stack.md#11-customer-facing-surface):

- **axe-core** runs in CI on every PR via Playwright (deferred to the implementation child — not part of this plan).
- **Manual screen-reader pass** runs per release on the v1.0 centers (Dashboard, Project Intelligence, Knowledge Center, Development Center, Connector Center, Audit Center, Agent Center, Governance Center).
- **Lighthouse accessibility audit** runs on the staging URL weekly; the score must stay ≥ 95.

---

## 6. The shared layout

Every center inherits a layout that has:

- A **top bar** with the tenant badge, persona switcher, theme switcher, global search, notification bell.
- A **left rail** with the 13 centers (collapsible to icons-only).
- A **main canvas** for the center's primary surface.
- A **right panel** (toggleable) for context — the typed-artifact side panel, the audit trail, the keyboard-shortcut helper.
- A **bottom status bar** with run state, last sync, and the budget meter (per [Forge AI-59 §8](../../project/PRD.md)).

The layout is owned by the **shell** package (`@fora/forge-shell`) which every center composes. The shell itself is **not** a center — it is the chrome around them.

### 6.1 Responsive behavior

- **Desktop-first** in v1.0, per the Forge AI-374 non-goals (the existing console is desktop-first and customers have not pushed back).
- **Tablet** (≥ 768 px) supported at v1.0 — the left rail collapses to icons, the right panel becomes a sheet.
- **Mobile** is a v1.1 add; the v1.0 mobile view is the typed-artifact list view only (no graphs).

---

## 7. Reconciliation with the spine plans

### 7.1 vs. Connector Center ([Forge AI-398](/Forge AI/issues/Forge AI-398))

- The Connector Center uses `--brand-success` for healthy, `--brand-warn` for degraded, `--brand-danger` for broken. Status colors must match the audit log's `tool_call_status` enum, which is owned by the IAM broker ([Forge AI-125](../../memory/project-fora-125-iam-shipped.md)).
- The Connector Center's "rotate credential" button is a **destructive** action — it uses `--brand-danger` only when the modal confirms the rotation, not on the trigger button.

### 7.2 vs. Audit Center + Governance Center ([Forge AI-399](/Forge AI/issues/Forge AI-399))

- The Audit Center surfaces the typed-artifact badge color family (per Plan 4 §3.9) consistently with the Audit Timeline Graph (Plan 2 §3.4).
- The Governance Center uses `--brand-primary` for active policies and a neutral grey for archived policies. Approval Request states map to the brand palette (pending=neutral, approved=`--brand-success`, declined=`--brand-danger`, expired=`--brand-warn`).
- The Audit Center's "investigation mode" (Plan 3 §4.3) is a session toggle, not a tenant toggle — both surfaces share the toggle state.

---

## 8. Internationalization (deferred)

- The design system is **English-only in v1.0**. The string catalog (i18n keys) is structured so v1.1 can ship a second locale without a refactor.
- The first non-English locale (likely **de-DE**) ships in v1.1 driven by a design-partner ask, not speculatively.
- Right-to-left languages are **out of scope for v1.0**; the layout primitives are RTL-compatible but the design system is not RTL-tested yet.

---

## 9. Open questions to surface at board review

| Q | Question | Owner | Blocks |
|---|----------|-------|--------|
| Q1 | The Forge AI-393 charter says Next.js 15; tech-stack.md says Next.js 14. Which wins? (Recommended: charter wins; tech-stack.md is patched.) | CTO | Every center in v1.0 |
| Q2 | Body default 14/22 — do we go to 16/24 for the customer-facing surface? (Recommended: keep 14/22 for the operator console; 16/24 for the marketing surface.) | Designer (future hire) | Plan 3 typography |
| Q3 | Investigation mode for Audit Center — is dark-only acceptable, or must it support both themes? (Recommended: dark-only with a "leave investigation mode" button.) | Security | Audit Center v1.0 |
| Q4 | Default per persona — does the Engineer persona (when hired) default to dark, or do we lose the PM-as-default rule? | CTO | Plan 3 §4.1 |
| Q5 | Brand primary is indigo — does the KnackForge parent brand have a logo system or color constraint we must honor? | Brand (KnackForge) | Plan 3 §3.1 |

---

## 10. Acceptance criteria for Plan 3

- [x] Shadcn UI named as the base; alternatives listed and rejected.
- [x] KnackForge brand overlay defined at the token level (CSS variables).
- [x] Typography scale defined; body default justified.
- [x] Dark and light themes defined; per-persona defaults justified.
- [x] WCAG 2.2 AA addressed per criterion; ownership assigned.
- [x] Shared layout (shell) defined; not a center itself.
- [x] Reconciliation against Forge AI-398 / Forge AI-399 / tech-stack.md concrete.
- [ ] Board approval via `request_confirmation` on Forge AI-393.

---

## 11. Related

- [01-core-ui-module-map.md](./01-core-ui-module-map.md) — the thirteen centers that consume this design system.
- [02-react-flow-graph-spec.md](./02-react-flow-graph-spec.md) — the color tokens and accessibility rules the canvases inherit.
- [04-component-library-plan.md](./04-component-library-plan.md) — the typed-artifact renderers built on top of these tokens.
- [05-gsd-workbench-surface-plan.md](./05-gsd-workbench-surface-plan.md) — the GSD workbench surfaces that inherit the shell.
- [workspace/project/tech-stack.md §11](../../project/tech-stack.md#11-customer-facing-surface) — the stack choice this plan reconciles with.
- [workspace/customer/standards.md §7](../../customer/standards.md#7-accessibility) — the WCAG inheritance line.

---

## 12. Change log

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v0.1 | 2026-06-20 | Senior Engineer (`27431e10-…`) | Initial design system spec — Shadcn base + KnackForge overlay, WCAG 2.2 AA, dark/light, board Q-list. |