# apps/forge — Forge Dashboard (Next.js frontend)

The persona-facing console for Forge. Backed by `backend/` (FastAPI) and the
3 spec-driven packages (`forge-core`, `forge-pi`, `forge-browser`).

## Next.js

Pinned to **Next.js 16.2.x** (see `docs/standards/tech-stack.md` and
`docs/standards/mcp-tooling.md`). Before any Next.js work, **read the relevant
doc in `node_modules/next/dist/docs/` first** — the per-version docs are the
source of truth, training data is outdated.

## Always-loaded rules

Inherits all 18 rules from `.claude/CLAUDE.md`. Pay particular attention to:

- **Rule 12** — Connectors, Co-pilot, and Command Center are cross-cutting;
  the FAB (⌘J) and palette (⌘K) must work from every page.
- **Rule 13** — Complex screens use collapsible rails (default collapsed).
- **Rule 15** — Empty states explain, never show bare "No data".
- **Rule 16** — Onboarding is a wizard, not a form.
- **Rule 18** — Every feature must be documented in `docs-site/`.

## Visualisation library defaults

| Need | Use |
|---|---|
| Workflow / architecture diagrams | `@xyflow/react` (formerly react-flow) |
| Knowledge graphs | react-force-graph-2d (install first — NOT in package.json yet) |
| Charts | Recharts |
| Virtual lists | `@tanstack/react-virtual` |
| Tables | `@tanstack/react-table` |
| Drag-drop | `@dnd-kit/core` + `@dnd-kit/sortable` |
| Onboarding tours | react-joyride (install first) or fall back to driver.js |

## Frontend conventions

- **Package manager**: `pnpm` (monorepo). Use `pnpm --filter forge-dashboard …`.
- **No direct provider SDKs** (Rule 1) — never `import openai/anthropic/…`.
- **No hardcoded skill/agent/command lists** (Rule 9) — read from
  `packages/forge-core/`.
- **Tenant isolation**: every API call must include the JWT-derived tenant
  context (Rule 2). Helpers live in `lib/tenant/`.
- **Icons**: `lucide-react` only — no emojis, no vendor icons.
- **Theme**: dark only (Rule 18); tokens in `.claude/CLAUDE.md` Design System
  section. Mirror in `globals.css`.
- **Tailwind**: pinned 3.4.14 — Tailwind 4 migration is deferred post-pilot.

## Cross-cutting UI components (must be available everywhere)

| Component | Purpose | Where it lives |
|---|---|---|
| `<ConnectorPicker />` | Choose connector + creds inline | `components/connector-center/` |
| `<ConnectorActionButton />` | Trigger a connector action | same |
| `<ConnectorHealthIndicator />` | Show connector status | same |
| `<CopilotFab />` | Floating AI panel (⌘J) | `components/copilot/` |
| `<CommandCenter />` | ⌘K palette | `components/command-center/` |

## MCP scope

- The `next-devtools-mcp` server in `.mcp.json` is **project-local only**.
  Do not register it in user-global MCP config.
- Do not add additional MCP servers to `.mcp.json` without an explicit ADR.

## Common commands (this dir)

```bash
pnpm dev              # next dev on :3000
pnpm start            # next start on :3000 (production)
pnpm build            # production build
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm test:e2e         # playwright test
pnpm dev:stack        # docker compose up backend + redis + postgres, then run terminal + UI
pnpm dev:terminal     # forge-terminal-server (xterm.js sidecar)
```

`pnpm dev` / `pnpm start` honor `FORA_FORGE_PORT` (default 3000) and
`FORA_FORGE_HOST` (default 0.0.0.0). Copy `.env.example` → `.env.local` to
point at the local backend.

## Where to look

- Pages & routing: `app/` (App Router)
- Reusable UI: `components/`
- Domain logic / hooks: `hooks/`, `lib/`
- API client: `lib/api/` (talks to `backend/`)
- Tests: `__tests__/`, `tests/`
- Env template: `.env.example` (commit), `.env.local` (gitignored)