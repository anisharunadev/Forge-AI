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
- **WebSocket auth** — use `api.ws(path)` from `lib/api/client.ts:267`; it auto-injects `?token=<jwt>` from the auth accessor. Don't hand-build `new WebSocket("wss://host/path?token=…")` from `localStorage`.
- **No hardcoded skill/agent/command lists** (Rule 9) — read from
  `packages/forge-core/`.
- **Tenant isolation**: every API call must include the JWT-derived tenant
  context (Rule 2). Helpers live in `lib/tenant/`.
- **Icons**: `lucide-react` only — no emojis, no vendor icons.
- **Theme**: dark only (Rule 18); tokens in `.claude/CLAUDE.md` Design System
  section. Mirror in `globals.css`.
- **Tailwind**: pinned 3.4.14 — Tailwind 4 migration is deferred post-pilot.

## LiteLLM wiring (UI → Backend → LiteLLM)

Forge UI **never** calls LiteLLM directly (Rule 1). Every UI feature
goes through Forge Backend, which proxies to a specific LiteLLM
endpoint. The authoritative **Forge UI surface → Backend route →
LiteLLM endpoint** matrix is `docs/litellm/forge-litellm-integration.md`
§2 (Onboarding, Command Center, Agent Workspace, Agent Chat, SDLC
Pipeline, Story Workspace, Knowledge/RAG, Guardrails, MCP, Skills,
Prompts, Tools, Virtual Keys, Spend, Audit, Provider Pass-through,
Audio/Video, Embeddings/RAG, Realtime/A2A, etc.).

If you're adding a new UI surface that talks to LLMs, MCP tools, or
spend/audit, **read §2 first** — the matrix already names the LiteLLM
endpoint to back it. For the raw endpoint catalog grouped by domain
(LLM Chat · Skills · MCP · Guardrails · Policies · Spend · Audit · …),
see `docs/litellm/litellm-forge-reference.md` (curated 637). For the
**complete** flat list of all 703 endpoints (every method+path+summary),
see `docs/litellm/litellm-endpoints.md`.

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

`pnpm test` only picks up files matching `tests/**/*.test.{ts,tsx}` (see `vitest.config.ts`). Tests in `__tests__/` (e.g. `live-stream-pill.test.tsx`, `runs-explainability.test.tsx`) are not in the glob — invoke them by file path (`pnpm test <path>`) or move them under `tests/`. New component tests should go under `tests/` to be auto-discovered.
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

## Onboarding wizard gotchas (Step-74)

- **Routes are NOT `/onboarding`.** The 10-step wizard lives at `/project-onboarding` (`app/project-onboarding/page.tsx`). `/onboarding/workspace` is a separate single-page tenant-creation form opened from `TenantSwitcher` — do not confuse them.
- **10 UI components map to 6 backend steps.** The `OnboardingWizard` `STEP_ORDER` in `backend/app/services/project_onboarding/wizard.py` is the source of truth (`tenant_setup`, `connect_repos`, `detect_stack`, `configure_agents`, `run_first_intel`, `review`). The 4 UI components without a backend counterpart (Welcome, ConnectProviders, Governance, plus the radial-bar inside RunFirstIntel) are pure-UI — see `UI_TO_BACKEND_STEP` in `app/project-onboarding/page.tsx` for the mapping.
- **Backend session lifecycle:** the page owns the `sessionId` (persisted via `useOnboardingStore`). `useStartWizard()` on mount, `useAdvanceWizard()` on Next for mapped steps, `useProvisionStatus()` polls `GET /onboarding/provision/status` for step 10. Don't re-implement local-only fake progress — the backend `STEP_ORDER` and `/onboarding/provision` job are real.
- **`ApiError` shape:** the constructor takes `detail` but the instance only exposes `status | code | body | message` (the `detail` is folded into `message` via `super()`). Use `err.message` in catch blocks, not `err.detail`.

## API transports (3 coexist — pick the right one)

| Transport | Where | Use for |
|---|---|---|
| `api` from `lib/api/client.ts` | default | New code — injects `Authorization` + `x-forge-tenant-id`, handles 401 refresh |
| `forgeFetch` from `lib/forge-api.ts` | legacy modules | Manual tenant; no auth; used by `lib/lessons/data.ts`, `lib/runs/data.ts` |
| `lib/api.ts` (default export) | runs/legacy | Pre-Pattern-B run endpoints; do not add new callers |

## Ideation wiring gotchas (Step-69)

- **Step-57 already shipped** 14 TanStack hooks in `lib/hooks/useIdeation.ts` (ideas, roadmaps, approvals, arch, etc.) and the wire→UX status adapter in `lib/hooks/useIdeationAdapters.ts`. The new `lib/ideation/adapter.ts` is the canonical **UPPER_SNAKE_CASE** bidirectional helper (`apiStatusToUi` / `uiStatusToApi`). Don't reimplement — extend.
- **Hook test location:** `apps/forge/tests/intelligence/`, **not** `apps/forge/__tests__/`. Use `renderWithClient(QueryClient + QueryClientProvider)` from `ideation-push-jira.test.tsx` and `vi.spyOn(globalThis, 'fetch')` for fetch mocking — no MSW.
- **WebSocket:** use `api.ws(path)` from `lib/api/client.ts` — it auto-injects the JWT as `?token=`. Don't build WebSocket URLs manually.
- Env template: `.env.example` (commit), `.env.local` (gitignored)