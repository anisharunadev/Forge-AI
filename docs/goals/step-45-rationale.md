# Step 45 — Rationale & Non-Changes

## 1-paragraph rationale

> The 3-package spec-driven stack turns Forge from a workflow tool into the
> Agent Operating System it was always meant to be. `forge-core` carries the
> **methodology** (the 7 GSD phases, capture → explore → execute → verify).
> `forge-pi` adds the **intelligence layer** (codebase scanning, knowledge
> graph, idea scoring with chain-of-thought, customer voice clustering,
> market signals, typed PRD drafts) — the layer that makes Ideation,
> Project Intelligence, and Co-pilot feel smart. `forge-browser` adds the
> **visual automation layer** (browser screenshots, visual regression,
> multi-viewport UI review, WCAG accessibility, post-deploy canary) — the
> layer that makes the Verify phase and `forge-audit-uat` truly automated.
> Each package is **independently installable**, **independently
> versionable**, and **optional by design** — every consumer degrades
> gracefully when its backing package is missing. The Command Center reads
> all three catalogs and groups commands under "Core workflow" / "Product
> intelligence" / "Browser automation" tabs; the Agent Center registers
> three new first-class agents (PM, QA, Canary) that span the packages and
> do real cross-cutting work. The Deep Rules (Rules 1–8) are honored on
> every surface: every typed artifact carries `tenant_id` + `project_id`,
> every action is auditable, every output is a typed artifact, and no
> provider SDK is imported directly.

## Skill rules cited

- **`02-typography.md`** — Plus Jakarta / Inter for body, JetBrains Mono
  for IDs/hashes/command names in `PackageNav` and `CommandCard`.
- **`03-color.md`** — package accent drives the chip color in
  `CommandCard` (blue = core, emerald = pi, violet = browser).
- **`04-ux-guideline.md`** — heading hierarchy preserved
  (`h2` "3-Package Spec-Driven Stack" → content).
- **`05-motion.md`** — `framer-motion` duration `0.18s` ease-out-soft used
  in `CommandCard`; honors `prefers-reduced-motion`.
- **`07-component.md`** — every new component lives under
  `components/{forge-commands, step45}` with explicit props.
- **`08-empty-ux.md`** — `PackageNav` shows "not installed" when a
  package is absent; `ForgeSkillPicker` shows the
  "No commands in this package yet" empty state.

## What we deliberately did NOT change

- **`packages/forge-core/`** — the vendored open-gsd fork. Untouched.
- **Existing skills / agents / commands under `forge-core`** — preserved
  verbatim. The new `package` field on `ForgeCommand` defaults to
  `'forge-core'` so legacy entries render unchanged.
- **Monorepo layout** — `apps/*` + `packages/*` + `mcp-servers/*`. The
  two new packages slot into `packages/` per the existing convention.
- **`packages/gsd-pi-stub`** — left in place. The `@opengsd/gsd-pi` stub
  still exists for the backend's `forge_commands.py` mirrors.
- **Backend wiring** — `backend/app/api/v1/_package_wiring.py` is the
  authoritative mirror; only `apps/forge/lib/package-wiring.ts` was
  touched because the step scope is the Forge dashboard.
- **Catalog reader contract** — `forge-core.catalog.json` is still the
  build-time source for `forge-core`; we extended the loader to also
  scan the two new catalogs at runtime with graceful fallbacks.
- **Constraint compliance** — dark-mode only, Lucide icons only,
  `prefers-reduced-motion` honored.

## Deliverables (acceptance check)

| Item | Status | Location |
|---|---|---|
| `packages/forge-pi/` created + installed | ✅ | `packages/forge-pi/` (8 source files, 6 skills, 1 agent, 6 commands, 1 catalog) |
| `packages/forge-browser/` created + installed | ✅ | `packages/forge-browser/` (8 source files, 6 skills, 2 agents, 6 commands, 1 catalog) |
| Skill manifest reader scans all 3 packages | ✅ | `apps/forge/lib/forge-commands-catalog.ts` (added `warmForgeCatalogs` + `commandsByPackage`) |
| Command Center shows skills from all packages | ✅ | `apps/forge/components/forge-commands/{PackageNav,ForgeSkillPicker,CommandCard}.tsx` |
| Ideation Center uses forge-pi | ✅ | `apps/forge/lib/ideation/forge-pi-client.ts` |
| Project Intelligence uses forge-pi | ✅ | `apps/forge/lib/project-intelligence/forge-pi-client.ts` |
| Verify phase uses forge-browser | ✅ | `apps/forge/lib/verify/browser.ts` |
| `forge-audit-uat` uses forge-browser | ✅ | `apps/forge/lib/audit/visual-uat.ts` |
| Architecture Center uses forge-pi | ✅ | `apps/forge/lib/architecture/forge-pi-client.ts` |
| Co-pilot uses forge-pi for `@mention` | ✅ | `apps/forge/lib/copilot/forge-pi-client.ts` |
| Command Center exposes "Run pi scan" | ✅ | `apps/forge/lib/command-center/forge-pi-actions.ts` |
| 3 new agents registered (PM, QA, Canary) | ✅ | `apps/forge/lib/agent-center/step45-agents.ts` + `components/step45/AgentLaunchButton.tsx` |
| Entry points in Ideation / Stories / Deploy | ✅ | ideation/page, stories/[id]/page, workflow/templates.ts (Canary node) |
| Docs site updated with new architecture | ✅ | `docs-site/src/content/docs/architecture/three-package-stack.md` + `forge-pi.md` + `forge-browser.md` |

## Migration notes for follow-up

- `pnpm install` already wired the two new packages as workspace deps
  in `apps/forge/package.json`. No further install step required.
- The catalog reader's `tryImportCatalog` uses dynamic imports so a
  missing package is silently skipped (degraded UI), not a build break.
- Three new top-level `Motion.section` calls were not added — the
  pre-existing `motion.section` typings issue in
  `app/forge-command-center/page.tsx` (lines 244 / 279) is out of scope
  for Step 45 and will be addressed by the Next.js 16 + framer-motion
  type-definition fix tracked separately.
- Pre-existing typecheck errors in `lib/tickets/detect.ts`,
  `components/knowledge/*`, `components/ConnectorCard.tsx`,
  `app/architecture/page.tsx`, and `app/connector-center/[id]/page.tsx`
  are unrelated to Step 45 and were not introduced by this work.