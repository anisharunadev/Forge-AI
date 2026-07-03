---
title: Integration Phases 2–13 — Roadmap
description: Phases remaining after OIDC Auth (Phase 1). Lists each phase, its API surface, and current status.
---

After [Phase 1 — OIDC Authentication](./oidc-auth) is live, the frontend is
wired to the real backend in twelve more phases. Each phase replaces a
mock-data page with live `/api/v1/...` traffic.

## Phase index

| # | Phase | Backend surface | Notes |
|---|---|---|---|
| 1 | [OIDC Auth](./oidc-auth) | `/api/v1/auth/*` | ✅ Wired 2026-06-27 (Step 52) |
| 2 | Agents + Providers | `/api/v1/agents/*` | Providers, runtimes, assignments |
| 3 | Connectors | `/api/v1/connectors/*` | Marketplace + credentials |
| 4 | Workflows + Runs | `/api/v1/workflows/*`, `/api/v1/runs/*` | ✅ Production (Step 66) |
| 5 | Dashboard | (rolls up KPIs from phases 2, 4, 11) | Real-data mission control |
| 6 | Knowledge Graph | `/api/v1/knowledge/*` | Backlinks, communities |
| 7 | Projects + Stories | `/api/v1/projects/*`, `/api/v1/stories/*` | Jira sync, kanban |
| 8 | Ideation | `/api/v1/ideation/*` | Uses forge-pi |
| 9 | Co-pilot | `/api/v1/copilot/*` | Chat + streaming |
| 10 | Terminal | PTY sidecar WebSocket | `forge-terminal-server` package |
| 11 | Governance + Audit | `/api/v1/governance/*`, `/api/v1/audit/*` | Policies, tamper-evident ledger |
| 12 | Settings | `/api/v1/settings/*` | Per-user + per-tenant prefs |
| 13 | Onboarding | `/api/v1/onboarding/*` | Wizard persistence |

## Phase 4 — Workflows + Runs

Production as of Step 66. Visual builder (`/api/v1/workflows/*`),
execution engine (`/api/v1/runs/*`), and the pause/resume approval
roundtrip (executor persists gate state via `flag_modified`; route
`POST /api/v1/workflows/runs/{id}/resume` advances the DAG) ship
end-to-end. Templates in the gallery write to a real `Workflow` row on
install.

## How phases are tracked

- Each phase lands in one or more commits with the message
  `feat(<scope>): … (step-NN)`.
- Each phase **must** add or update a docs page in `docs-site/src/content/docs/`
  before it ships. See the
  [Built Features manifest](https://github.com/forge-ai/forge-ai/blob/main/built-features.yaml)
  and the docs-coverage check at
  `scripts/check-feature-docs.sh`.

## Acceptance criteria (per phase)

1. Backend routers mounted under `/api/v1/<resource>/`.
2. Frontend page(s) consume the real endpoints (no mock fallback path in
   production builds).
3. RBAC enforced — every endpoint checks `tenant_id` (Rule 2).
4. Audit rows emitted for any state-changing call (Rule 6).
5. OpenTelemetry spans emitted with `tenant_id`, `project_id`, `actor_id`
   attributes (Rule 7).
6. Docs page updated or created. The `scripts/check-feature-docs.sh` CI
   job exits 1 if a Production feature has no docs page.

## See also

- `.claude/CLAUDE.md` — Integration Phases section (rule source)
- `built-features.yaml` — single source of truth for the Built Features table
- `.planning/STATE.md` — current GSD phase state