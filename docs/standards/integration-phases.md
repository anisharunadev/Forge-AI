# Integration Phases (Frontend → Backend wiring)

> The roadmap for wiring the Next.js frontend to the real FastAPI backend.
> Each phase declares a route prefix; do not duplicate routes across phases.

| # | Phase | Routes | Status |
|---|---|---|---|
| 1 | OIDC Auth (Keycloak + JWT + tenant foundation) | Auth flow | Wired 2026-06-27 (step 53) |
| 2 | Agents + Providers | `/api/v1/agents/*` | Planned |
| 3 | Connectors | `/api/v1/connectors/*` | Planned |
| 4 | Workflows + Runs | `/api/v1/workflows/*` + `/api/v1/runs/*` | Planned |
| 5 | Dashboard | `/api/v1/dashboard/*` | Planned |
| 6 | Knowledge Graph | `/api/v1/knowledge/*` | Planned |
| 7 | Projects + Stories | `/api/v1/projects/*` + `/api/v1/stories/*` | Planned |
| 8 | Ideation (uses forge-pi) | `/api/v1/ideation/*` | Planned |
| 9 | Co-pilot (chat + streaming) | `/api/v1/copilot/*` | Planned |
| 10 | Terminal | PTY sidecar WebSocket | Planned |
| 11 | Governance + Audit | `/api/v1/governance/*` + `/api/v1/audit/*` | Planned |
| 12 | Settings | `/api/v1/settings/*` | Planned |
| 13 | Onboarding | `/api/v1/onboarding/*` | Planned |

For the canonical 8-rules card and route inventory: `docs/reference/api-catalog.md`.
