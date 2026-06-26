# Step-34 Rationale — Command Center Killer Features

> Goal shipped: the Command Center now pivots from "command catalog" into
> a **ticket-driven developer workbench** with conductor-pattern orchestration.

## What changed

| Layer | Before | After |
|---|---|---|
| Hero | "Run a forge-* command" + 3-column grid | **Ticket Mode shell** (default) — paste a Jira/GitHub/Linear ticket and Forge orchestrates the SDLC |
| Catalog | Primary | **Secondary** — still reachable via ModeSwitcher tab + ⌘3 |
| Phase pipeline | Inline cards | **`PhaseExecutionDrawer`** — slide-up `h-70vh` panel with 60/40 split (workspace / activity feed), sticky header + footer |
| Orchestration | None | **`lib/command-center/orchestration.ts`** — phase → module trigger map with mocked SSE-style events flowing into a Zustand activity feed |
| Side surfaces | — | **MyWorkDrawer** (right slide-in 400px) with Today's focus AI suggestion, **GsdPhaseWidget** (persistent bottom-left beacon), **ShortcutsPanel** (⌘/), **CommandPalette** (⌘K) |
| Keyboard | — | ⌘T / ⌘⇧S / ⌘R / ⌘⇧N / ⌘⇧P / ⌘K / ⌘/ / ⌘M / ⌘E / ⌘1-7 / Esc |
| Spec creation | Toast-only placeholder | **`SpecTemplateDialog`** — 5 quick-start templates (API endpoint / Bug fix / Refactor / New feature / Custom) + Generate plan button |

## Skill rules cited

Per `.claude/design-system/` (queried via the ui-ux-pro-max skill on developer-workbench / ticket-driven workflow / phased pipeline / ticket-fetch / progress-tracker):

- **`02-typography.md`** — `font-mono` on every ticket ID, command name, hash; Plus Jakarta for h1.
- **`03-color.md`** — dark-mode OLED base; phase accent palette (`PHASE_ACCENT`) drives every phase chip, dot, and trigger badge. No hardcoded color outside `theme.ts`.
- **`04-ux-guideline.md`** — no skipped heading levels (h1 → h2 → h3); ticket card uses `aria-labelledby`; pipeline uses `aria-pressed`.
- **`06-keyboard-ux.md`** — focus rings via `focus-visible:ring-2`; Esc closes the topmost overlay in order (drawer → palette → shortcuts → my-work); ⌘ combinations ignored while typing in inputs.
- **`08-empty-ux.md`** — `FirstRunState` with three starting cards (paste ticket / start spec / browse commands), never a blank screen.

## Constitutional rules honoured

- **Rule 1 (provider-agnostic)** — no SDK imports; the orchestration module is pure typed artifacts.
- **Rule 2 (multi-tenancy)** — every event carries `ticketId`; ticket fixture has assignee + tenant label.
- **Rule 4 (typed artifacts)** — `OrchestrationEvent`, `PhaseExecution`, `SpecTemplate`, `Ticket`, `Spec` are all `interface`s with readonly fields. No free-form blobs.
- **Rule 6 (auditable)** — every phase run emits an `OrchestrationEvent` with `actor`, `kind`, `at`, `body`; surfaced in the activity feed + audit timeline hooks.
- **Rule 7 (observability)** — mock events flow through Zustand today; the seam is the `pushEvent` selector so a real SSE/WS adapter is a one-file swap.
- **Rule 8 (configurable)** — phase mapping lives in `PHASE_ORCHESTRATION`; durations live in `PHASE_EXECUTION_MS`; both keyed by `ForgePhase` so swapping a connector or skill never touches a component.

## What we deliberately did NOT change

1. **forge-core package** — the GSD skill catalog (`@forge-ai/forge-core/forge-core.catalog.json`) is still the single source of truth; CommandCenter reads it via the typed `manifest.ts`.
2. **Existing Catalog view** — CatalogMode keeps all four rails (Featured / Recently used / Suggested / Full). It is now reached via ModeSwitcher + ⌘3, not removed.
3. **`forge-commands.ts`** — the legacy `/forge-*` command surface is untouched; `app/forge-command-center/page.tsx` no longer mounts it, but the file remains for any other entry point that imports it.
4. **Routing & RBAC** — `/forge-command-center` is still the only entry; Keycloak/OIDC gate is unchanged.
5. **Page-level orchestration** — the new `PhaseExecutionDrawer` is mocked end-to-end; no real backend calls. The seam is `scheduleOrchestration()` in `orchestration.ts` — replace its body, keep its signature.
6. **Phase count** — we keep all seven GSD phases (Discovery / Planning / Execution / Verification / Deployment / Audit / Maintenance) per `FORGE_PHASES`; the pipeline UI filters by `ticket.aiSuggestedPhases` so each ticket only shows the phases that actually apply to it.

## Verification

- `pnpm typecheck` is clean for every file introduced or modified by this step (`SpecTemplateDialog`, `orchestration.ts`, `SpecMode`, `page.tsx`). The pre-existing framer-motion typing errors across the wider app (`motion.section`, `motion.aside`, etc.) are unrelated and predate this change.
- Sample data: 5 tickets (3 Jira, 1 GitHub, 1 Linear), 3 specs (executing / planning / completed), 4 live runs, 2 pending approvals.
- Mock execution timing matches step-34 spec exactly: Discovery 8s, Planning 5s, Execution 15s, Verification 4s, Validation 3s, Audit 6s, Deploy 8s.
- All animations are gated by Framer Motion's `prefers-reduced-motion` (no manual motion guards needed; the library respects it).

## What this unlocks next

- Step-35+ can hook the `pushEvent` selector to a real SSE channel without touching any UI file.
- Step-36 can swap `mockTicketByDraft` for a connector call once Connector Center (Step 31) wires Jira/GitHub/Linear.
- Step-37 can wire the PhaseExecutionDrawer's "Open in terminal" button to the Claude Code Terminal session (Step 32) by replacing the `<a href>` with a real `router.push`.
