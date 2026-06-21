# `apps/forge` — Forge AI Console

**Status:** 0.1.0 (Phase 2 first cut)
**Package:** `forge-dashboard`
**Stack:** Next.js 15 (App Router) + React 19 + TypeScript 5 + Shadcn/UI + Tailwind CSS + TanStack Query + Zustand

The Forge console is the customer-facing UI for Forge AI. It renders every persona surface (PM, Engineering Lead, CTO / VP Eng), the Command Center, the Terminal Center, the Ideation Center, the Architecture Center, the Knowledge Center, the Connector Center, and the Agent Center.

The console is purely a **read + operator shell**: no SSR data fetching from internal services. Every page either revalidates on navigation or polls a small set of API routes under `apps/forge/app/api/`.

## Run (dev)

```bash
# from repo root, after the backend is up on :4000 (orchestrator) and :8000 (FastAPI):
pnpm install
pnpm --filter forge-dashboard dev          # listens on :3000 by default

# Smoke-test
curl http://localhost:3000/healthz     # → {"status":"ok","service":"forge"}
```

The dev server proxies server-side fetches to `FORA_FORGE_API_URL` (default `http://localhost:4000`) and exposes the same URL to the browser as `NEXT_PUBLIC_FORGE_API_URL`.

## Tech

| Concern | Technology |
| --- | --- |
| Framework | Next.js 15 (App Router, RSC) |
| Language | TypeScript 5.9 (strict) |
| Runtime | React 19 |
| Styling | Tailwind CSS 3.4 + tailwindcss-animate |
| UI primitives | `@radix-ui/*` (Shadcn pattern), `class-variance-authority`, `lucide-react` |
| Forms | `react-hook-form` + `@hookform/resolvers` + `zod` |
| Data fetching | `@tanstack/react-query` |
| State | `zustand` |
| Visualization | `reactflow`, `recharts` |
| Terminal emulator | `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links` |
| Cmd+K menu | `cmdk` |
| Date utils | `date-fns` |
| Tests | Vitest (unit) + Playwright (e2e) |

## Structure

```text
apps/forge/
├── app/                                 # Next.js 15 App Router
│   ├── layout.tsx                       # Root layout, providers, persona cookie
│   ├── page.tsx                         # Persona picker + welcome card
│   ├── not-found.tsx
│   ├── globals.css
│   ├── healthz/                         # GET /healthz
│   ├── dashboard/                       # GET /dashboard
│   ├── forge-command-center/            # GET /forge-command-center
│   ├── forge-terminal/                  # GET /forge-terminal
│   ├── knowledge-center/                # GET /knowledge-center
│   ├── agent-center/                    # GET /agent-center
│   ├── connector-center/
│   │   ├── page.tsx                     # list
│   │   └── [id]/                        # detail
│   ├── organization-knowledge/          # GET /organization-knowledge (org layer)
│   ├── project-intelligence/            # GET /project-intelligence (project layer)
│   │   ├── page.tsx
│   │   ├── drafts/                      # /project-intelligence/drafts
│   │   ├── epics/                       # /project-intelligence/epics
│   │   └── stories/                     # /project-intelligence/stories
│   ├── project-onboarding/              # GET /project-onboarding
│   ├── runs/[id]/                       # GET /runs/:id — run detail with timeline
│   ├── personas/
│   │   ├── pm/                          # PM dashboard
│   │   ├── eng-lead/                    # Engineering Lead dashboard
│   │   └── cto/                         # CTO / VP Eng dashboard
│   └── api/                             # Server routes
│       ├── healthz/                     # GET /api/healthz
│       ├── persona/                     # POST /api/persona (sets cookie)
│       └── runs/[id]/                   # POST /api/runs/:id/{pause|resume|cancel}
├── components/
│   ├── admin/                           # Admin UI fragments
│   ├── agent-center/                    # Agent catalog UI
│   ├── connector-center/                # Connector list, detail, status pill
│   ├── dashboard/                       # Dashboard widgets
│   ├── forge-commands/                  # Command Center UI (forge-* picker)
│   ├── forge-terminal/                  # xterm.js host component
│   ├── intelligence/                    # KG / graph visualization (React Flow)
│   ├── knowledge/                       # Knowledge Center UI
│   ├── onboarding/                      # Onboarding wizard UI
│   ├── org-knowledge/                   # Org Knowledge layer UI
│   ├── ui/                              # Shadcn primitives (button, dialog, etc.)
│   ├── ConnectorCard.tsx
│   ├── ConnectorDetailPanel.tsx
│   ├── ConnectorStatusPill.tsx
│   ├── OrchestratorNotice.tsx
│   ├── PersonaSwitcher.tsx
│   ├── RealtimeRunsList.tsx
│   ├── RealtimeTimeline.tsx
│   ├── RunActions.tsx
│   ├── RunStatusBadge.tsx
│   └── Timeline.tsx
├── lib/                                 # client utilities
├── hooks/                               # shared React hooks
├── public/                              # static assets
├── bin/                                 # local helper scripts
├── __tests__/                           # vitest tests (mirror app/components)
├── tests/                               # Playwright e2e tests
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── components.json                      # Shadcn config
└── package.json
```

## Pages

| Path | Purpose |
| --- | --- |
| `/` | Persona picker + welcome card |
| `/dashboard` | All-persona landing dashboard |
| `/forge-command-center` | Run `forge-*` commands; view command map |
| `/forge-terminal` | xterm.js terminal backed by `/ws/terminal/{session_id}` |
| `/knowledge-center` | Org knowledge browse + KG search (Cypher, SQL, hybrid, vector) |
| `/agent-center` | Agent catalog, assignments, runtime status |
| `/connector-center` | Per-tenant connector state, marketplace, install |
| `/organization-knowledge` | Org Knowledge layer (standards, templates, policies) |
| `/project-intelligence` | Project Intelligence layer (KG, drafts, epics, stories) |
| `/project-onboarding` | Onboarding wizard (welcome → detect stack → bootstrap → resume) |
| `/runs/:id` | Run detail with seven-stage timeline + realtime stream |
| `/personas/pm` | Product Manager dashboard |
| `/personas/eng-lead` | Engineering Lead dashboard (operator action bar) |
| `/personas/cto` | CTO / VP Eng dashboard (cost-by-goal, audit log pointer) |
| `/api/healthz` | Liveness |
| `/api/persona` | Set persona cookie (single-tenant stub auth) |
| `/api/runs/:id/{pause,resume,cancel}` | Proxy → orchestrator with `Idempotency-Key` |

## Test

```bash
# unit (Vitest)
pnpm --filter forge-dashboard test
pnpm --filter forge-dashboard test -- --run Timeline    # single file

# e2e (Playwright)
pnpm --filter forge-dashboard test:e2e
pnpm --filter forge-dashboard exec playwright test --headed
```

Vitest uses jsdom; React Testing Library is pre-wired. Playwright config is at `apps/forge/playwright.config.ts`.

## Environment Variables

All optional — defaults shown.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FORA_FORGE_PORT` | `3000` | Port Next binds to |
| `FORA_FORGE_HOST` | `0.0.0.0` | Bind interface |
| `FORA_FORGE_API_URL` | `http://localhost:4000` | Orchestrator / backend base URL (server-side) |
| `NEXT_PUBLIC_FORGE_API_URL` | `FORA_FORGE_API_URL` | Public browser URL |
| `FORA_SEED_RUN_ID` | `demo-run-001` | Demo run id for the persona dashboards |
| `FORA_SEED_TENANT_ID` | `acme-corp` | Header badge tenant |
| `FORA_SEED_TENANT_NAME` | `Acme Corp (Dev Demo)` | Header badge tenant name |

## Connecting to the backend

The console proxies server-side requests to whatever URL `FORA_FORGE_API_URL` points to. For local dev:

```bash
# Backend (FastAPI) on :8000
FORA_FORGE_API_URL=http://localhost:8000 pnpm --filter forge-dashboard dev

# Or the legacy orchestrator on :4000
FORA_FORGE_API_URL=http://localhost:4000 pnpm --filter forge-dashboard dev
```

For browser-side requests (Realtime runs list, terminal WebSocket proxying), the same URL is exposed as `NEXT_PUBLIC_FORGE_API_URL`.

## Out of scope (v1 non-goals)

- Production auth (the identity-broker integration owns SSO + RBAC binding)
- Mobile / responsive-first design — desktop-first is acceptable for v1
- SSE — persona pages revalidate on navigation only; terminal uses WebSocket
- Write paths for prompts / stage artefacts — the console is read + operator only
- Tenant onboarding UI is a thin wizard; the seeded `acme-corp` is the canonical demo tenant

## Dependencies on other packages

- `the v2.0 design system` — shared UI primitives (button, dialog, toast, ...)

## Related docs

- Architecture: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- Backend: [`../backend/README.md`](../backend/README.md)
- Forge commands: [`../docs/FORGE_COMMANDS.md`](../docs/FORGE_COMMANDS.md)
