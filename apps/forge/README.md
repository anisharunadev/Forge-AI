# `@fora/forge` — Forge AI Forge AI Console

**Status:** 0.1.0 (Forge AI-374 first cut)
**Spec:** [Forge AI-374](/Forge AI/issues/Forge AI-374)
**Sibling:** [Forge AI-371](/Forge AI/issues/Forge AI-371) (backend dev runbook), [Forge AI-50](/Forge AI/issues/Forge AI-50) (orchestrator)

The Forge console is a Next.js 15 (App Router) UI shell over the Master Orchestrator
REST API. It ships three persona dashboards — **Product Manager**, **Engineering
Lead**, **CTO / VP Eng** — plus a seven-stage run timeline. There is no SSR data
fetching from internal services; the console is purely a read + operator shell.

## Endpoints (Forge AI-374 deliverables)

| Path | Notes |
| --- | --- |
| `GET /` | Persona picker + welcome card. |
| `GET /personas/pm` | Product Manager dashboard — active runs, roadmap placeholders. |
| `GET /personas/eng-lead` | Engineering Lead dashboard — operator action bar (pause/resume/cancel). |
| `GET /personas/cto` | CTO / VP Eng dashboard — cost-by-goal, audit log pointer. |
| `GET /runs/:id` | Run detail with the seven-stage `Timeline`. |
| `GET /api/healthz` | Liveness (used by `scripts/smoke.sh`). |
| `POST /api/persona` | Sets the persona cookie (single-tenant stub auth). |
| `POST /api/runs/:id/{pause\|resume\|cancel}` | Proxy → orchestrator with `Idempotency-Key`. |

## Tech stack

- Next.js 15 (App Router, RSC), TypeScript strict.
- Tailwind CSS 3.4 (no shadcn CLI dep — components are inline).
- Vitest for unit tests (`Timeline`); Playwright for the e2e smoke.

## Running locally

```bash
# from repo root, after ./scripts/dev-up.sh has brought up the orchestrator:
pnpm --filter @fora/forge dev          # listens on :3000 by default
curl http://localhost:3000/healthz     # → {"status":"ok","service":"forge"}
```

Env vars (all optional — defaults shown):

- `Forge AI_FORGE_PORT` (default `3000`) — the port Next binds to.
- `Forge AI_FORGE_HOST` (default `0.0.0.0`) — bind interface.
- `Forge AI_FORGE_API_URL` (default `http://localhost:4000`) — orchestrator base URL (server-side).
- `NEXT_PUBLIC_FORGE_API_URL` (default = `Forge AI_FORGE_API_URL`) — public browser URL.
- `Forge AI_SEED_RUN_ID` (default `demo-run-001`) — the demo run id the persona dashboards fall back to.
- `Forge AI_SEED_TENANT_ID` / `Forge AI_SEED_TENANT_NAME` — header badge values.

## Out of scope (Forge AI-374 non-goals)

- Production auth (Forge AI-123 owns the identity-broker integration).
- Mobile / responsive-first design — desktop-first is acceptable for v1.
- WebSocket / SSE — the persona pages revalidate on navigation only.
- Write paths for prompts / stage artefacts — the console is read-only over the
  orchestrator state machine.
- Tenant onboarding — the seeded `acme-corp` is the only tenant.