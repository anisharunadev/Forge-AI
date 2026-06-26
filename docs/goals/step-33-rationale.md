# step-33 — Forge Command Center rebuild

## 1-paragraph rationale citing skill rules

The Command Center is rebuilt from a static command catalog into a true
developer workbench with three top-level modes (Ticket / Spec / Catalog),
backed by `packages/forge-core/forge-core.catalog.json` (69 skills) and
the Step-34 conductor's orchestration event stream. Ticket Mode is the
default entry — paste a Jira/GitHub/Linear ID and Forge orchestrates
Spike → Plan → Execute → Verify → Validate → Audit → Deploy with
typed artifacts at every step (Rule 4: Typed Artifacts Only). Every
selection, ticket, spec, run, and approval carries `tenant_id` /
`project_id` through the Zustand store (Rule 2: Multi-Tenancy by
Default); no workflow crosses Architecture / Security / Deployment
without an explicit human approval gate surfaced in My Work and the
GSD phase widget (Rule 3: Mandatory Human Approval Gates). Auditability
and observability (Rules 6 + 7) are wired through the
`OrchestrationEvent` feed rendered in the Phase Execution drawer and the
floating widget. Connectors stay swappable (Rule 8: Configurable
Everything) — the source-color tokens in `theme.ts` and the connector
field on every ticket keep Jira / GitHub / Linear / Manual all first-class.

## Files created / modified

```
apps/forge/app/forge-command-center/page.tsx          (rewrite — 250 lines)
apps/forge/lib/forge-core/manifest.ts                 (new — forge-core skill manifest reader)
apps/forge/lib/command-center/sample-data.ts          (new — tickets, specs, runs, approvals, suggestions)
apps/forge/lib/command-center/store.ts                (Zustand store — extended with orchestration)
apps/forge/lib/command-center/theme.ts                (new — phase + ticket + spec color tokens)
apps/forge/lib/command-center/icons.tsx               (new — lucide string→component resolver)

apps/forge/components/command-center/CommandCenterHeader.tsx
apps/forge/components/command-center/ModeSwitcher.tsx
apps/forge/components/command-center/TicketMode.tsx
apps/forge/components/command-center/SpecMode.tsx
apps/forge/components/command-center/CatalogMode.tsx
apps/forge/components/command-center/ForgeSkillCard.tsx
apps/forge/components/command-center/MyWorkDrawer.tsx
apps/forge/components/command-center/GsdPhaseWidget.tsx
apps/forge/components/command-center/PhaseExecutionDrawer.tsx (connector added)
apps/forge/components/command-center/CommandPalette.tsx
apps/forge/components/command-center/ShortcutsPanel.tsx
apps/forge/components/command-center/FirstRunState.tsx
```

## What was deliberately NOT changed

- **forge-core package structure** — kept the GSD file naming convention
  (`spike.md`, `plan.md`, `verify.md`, etc.) and the catalog JSON shape
  intact. The Command Center reads from the same artifact the orchestrator
  reads from. Renaming would have rippled into `commands/forge/*` and
  every skill file.
- **Existing commands** — every `forge-*` slash command from
  `lib/forge-commands.ts` continues to work; the new Catalog Mode is
  additive. No command removed, renamed, or changed.
- **Global app shell** (`app/layout.tsx`, `AdminShell`, persistent
  Sidebar/Topbar) — unchanged. The Command Center is just one page in
  the existing shell.
- **Type system** — same Primitives, same tokens (`--accent-*`,
  `--bg-*`, `--fg-*`, `--radius-*`, `--shadow-md`), same component
  library (shadcn/ui Button / Input / Textarea / Sheet / Tabs / etc.).
  No new design-token surface introduced.
- **ForgeSkillCard `motion.article` wrapper** — kept semantically even
  though framer-motion v11 typecheck doesn't expose `motion.article`
  in its public key set; the runtime is fine and matches the pre-existing
  pattern used by `src/components/knowledge/best-practices.tsx`.
- **Connector Center / Runs Center / Ideation / Architecture** — these
  already exist and continue to receive deep-links from the new Command
  Center (e.g. "Open in Runs center", "View artifacts"). They were not
  rebuilt.

## End-to-end integration (mocked)

1. User pastes `ACME-123` into Ticket Mode → toast confirms load →
   Ticket Analysis Card renders (source, status, priority, AI summary,
   linked entities: ADR-005, SPEC-041, code-reviewer agent, 3 files).
2. AI Suggested Workflow shows the 5-phase pipeline (discovery →
   execution → verification → deployment) with completion checkmarks.
3. Click "Start" on Execution → Phase Execution Panel expands; running
   `forge-execute-phase` pushes events to the orchestration feed in the
   Phase Execution drawer (ZONE 8).
4. ⌘1–7 jumps between phases (GSD widget updates); ⌘M opens My Work;
   ⌘K opens the palette. The GSD phase widget persists across pages.

## Notes for next iteration

- Real ticket fetching will swap `SAMPLE_TICKETS` for a TanStack Query
  keyed on `/api/connectors/{jira,github,linear}/tickets`.
- WebSocket (Rule 7) will replace the `setTimeout`-based mock runs.
- Two-way status sync to Jira is queued behind the Connector Center
  rewrite (Step-35).
