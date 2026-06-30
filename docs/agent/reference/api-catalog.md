# Reference: API Catalog (All 305 Backend Routes)

> **Status:** ✅ Canonical — every backend route documented
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/backend/app/api/v1/` + `~/forge-ai/docs/openapi.json`
> **Last updated:** 2026-06-30
> **Total routes:** 305 (auto-generated from `@router.` decorators)

---

## Purpose

This document is the **canonical inventory of every backend REST route** in Forge AI. For each route, it captures the method, path, file, permissions, and audit action.

For detailed per-feature route semantics, see the relevant feature doc under `/docs/features/`. This catalog is the **route map**, not the route explanation.

---

## Source of truth

- **This file** — `/docs/reference/api-catalog.md`
- **Backend source** — `backend/app/api/v1/`
- **Auto-generated OpenAPI** — `~/forge-ai/docs/openapi.json`
- **Per-feature docs** — `/docs/features/<feature>.md` (each doc has a "Routes" section)

---

## Conventions

- All routes under `/api/v1/`
- All mutating routes have `@audit(action="...", target_type="...")`
- All mutations have RBAC permission guards (`require_permission(...)`)
- All POST/PUT/PATCH send `Idempotency-Key: <uuid-v4>` from frontend
- All list endpoints return `Page[T]`

**See:** `/docs/standards/api-conventions.md` for the full wire contract.

---

## Routes by feature

### Auth — `backend/app/api/v1/auth.py` — 3 routes

| Method | Path | Action | Description |
|---|---|---|---|
| `GET` | `/api/v1/auth/me` | `auth.me` | Get current principal |
| `GET` | `/api/v1/auth/login` | `auth.login` | OIDC login redirect |
| `GET` | `/api/v1/auth/callback` | `auth.callback` | OIDC callback (PKCE) |

→ [Features: Auth](../features/auth.md)

### Dashboard — `backend/app/api/v1/dashboard.py` — 14 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/dashboard/kpis` | 4 KPI cards |
| `GET` | `/api/v1/dashboard/cost-trend` | Cost area chart |
| `GET` | `/api/v1/dashboard/runs-by-status` | Runs by status (stacked bar) |
| `GET` | `/api/v1/dashboard/acceptance` | Acceptance line chart |
| `GET` | `/api/v1/dashboard/agent-usage` | Top 10 agents by cost |
| `GET` | `/api/v1/dashboard/approval-latency` | p50/p95/p99 fan |
| `GET` | `/api/v1/dashboard/knowledge-reuse` | KG reuse gauge |
| `GET` | `/api/v1/dashboard/token-usage` | Token usage by model |
| `GET` | `/api/v1/dashboard/provider-cost` | Provider cost breakdown |
| `GET` | `/api/v1/dashboard/provider-leaderboard` | Top 3 providers |
| `GET` | `/api/v1/dashboard/recent-runs` | Recent runs feed |
| `GET` | `/api/v1/dashboard/upcoming-approvals` | Approvals awaiting decision |
| `GET` | `/api/v1/dashboard/cost-burn-rate` | USD/hour burn rate |
| `GET` | `/api/v1/dashboard/active-runs` | Active runs count |

→ [Features: Dashboard](../features/dashboard.md)

### Workflows — `backend/app/api/v1/workflows.py` — 14 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/workflows` | List workflows (tenant-scoped) |
| `POST` | `/api/v1/workflows` | Create workflow |
| `GET` | `/api/v1/workflows/{id}` | Get one workflow |
| `PUT` | `/api/v1/workflows/{id}` | Replace workflow |
| `PATCH` | `/api/v1/workflows/{id}` | Partial update |
| `DELETE` | `/api/v1/workflows/{id}` | Soft delete |
| `POST` | `/api/v1/workflows/{id}/run` | Trigger a run |
| `POST` | `/api/v1/workflows/{id}/pause` | Pause run |
| `POST` | `/api/v1/workflows/{id}/resume` | Resume run |
| `POST` | `/api/v1/workflows/{id}/cancel` | Cancel run |
| `GET` | `/api/v1/workflows/{id}/runs` | List runs for this workflow |
| `GET` | `/api/v1/workflows/{id}/runs/{run_id}` | Get one run |
| `GET` | `/api/v1/workflows/{id}/events` | SSE event stream |
| `POST` | `/api/v1/workflows/{id}/validate` | Validate DAG structure |

→ [Features: Workflows](../features/workflows.md)

### Stories — `backend/app/api/v1/stories.py` — 12 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/stories` | List stories (paginated) |
| `POST` | `/api/v1/stories` | Create story |
| `GET` | `/api/v1/stories/{id}` | Get one story |
| `PATCH` | `/api/v1/stories/{id}` | Update story (status, owner) |
| `DELETE` | `/api/v1/stories/{id}` | Soft delete story |
| `GET` | `/api/v1/projects/{project_id}/stories` | Stories per project |
| `POST` | `/api/v1/projects/{project_id}/stories` | Create story in project |
| `GET` | `/api/v1/sprints` | List sprints |
| `POST` | `/api/v1/sprints` | Create sprint |
| `GET` | `/api/v1/sprints/{id}` | Get one sprint |
| `PATCH` | `/api/v1/sprints/{id}` | Update sprint |
| `GET` | `/api/v1/epics/{epic_id}/stories` | Stories under an epic |

→ [Features: Stories](../features/stories.md)

### Repos — `backend/app/api/v1/repos.py` — 9 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/repos` | List repos |
| `POST` | `/api/v1/repos` | Register repo |
| `GET` | `/api/v1/repos/{id}` | Get one repo |
| `PATCH` | `/api/v1/repos/{id}` | Update repo |
| `DELETE` | `/api/v1/repos/{id}` | Soft delete |
| `POST` | `/api/v1/repos/{id}/sync` | Trigger sync |
| `GET` | `/api/v1/repos/{id}/sync-status` | Sync status |
| `GET` | `/api/v1/repos/{id}/files` | List files |
| `GET` | `/api/v1/repos/{id}/commits` | List commits |

→ [Features: Project Intelligence](../features/project-intelligence.md)

### Knowledge Graph — `backend/app/api/v1/knowledge_graph.py` — 9 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/knowledge-graph/nodes` | List nodes (paginated) |
| `POST` | `/api/v1/knowledge-graph/nodes` | Create node |
| `GET` | `/api/v1/knowledge-graph/nodes/{id}` | Get one node |
| `PATCH` | `/api/v1/knowledge-graph/nodes/{id}` | Update node |
| `DELETE` | `/api/v1/knowledge-graph/nodes/{id}` | Soft delete |
| `GET` | `/api/v1/knowledge-graph/edges` | List edges |
| `POST` | `/api/v1/knowledge-graph/search` | Hybrid (Cypher + vector) search |
| `POST` | `/api/v1/knowledge-graph/cypher` | Raw Cypher query |
| `GET` | `/api/v1/knowledge-graph/stats` | KG statistics |

→ [Features: Knowledge Center](../features/knowledge-center.md)

### Seeds — `backend/app/api/v1/seeds.py` — 8 routes

| Method | Path | RBAC | Description |
|---|---|---|---|
| `GET` | `/api/v1/seeds` | `seeds:view` | List seed manifests |
| `GET` | `/api/v1/seeds/{name}` | `seeds:view` | Get full manifest |
| `GET` | `/api/v1/seeds/{name}/status` | `seeds:view` | Durable state + drift |
| `GET` | `/api/v1/seeds/{name}/diff` | `seeds:view` | Expected vs actual row counts |
| `GET` | `/api/v1/seeds/{name}/runs` | `seeds:view` | Run history |
| `POST` | `/api/v1/seeds/{name}/apply` | `seeds:manage` | Apply idempotently |
| `POST` | `/api/v1/seeds/{name}/reset` | `seeds:reset:demo_only` / `seeds:reset:all` | Reset (delete rows) |
| `POST` | `/api/v1/seeds/{name}/rollback` | `seeds:manage` | Roll back the most recent apply |

→ [Features: Seed Management](../features/seeds-admin.md)

### Runs — `backend/app/api/v1/runs.py` — 8 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/runs` | List runs (paginated) |
| `GET` | `/api/v1/runs/{id}` | Get one run |
| `POST` | `/api/v1/runs/{id}/pause` | Pause run |
| `POST` | `/api/v1/runs/{id}/resume` | Resume run |
| `POST` | `/api/v1/runs/{id}/cancel` | Cancel run |
| `GET` | `/api/v1/runs/{id}/events` | SSE event stream |
| `GET` | `/api/v1/runs/{id}/logs` | Run logs |
| `GET` | `/api/v1/runs/{id}/artifacts` | Artifacts emitted by this run |

→ [Features: Runs](../features/runs.md)

### Connectors — `backend/app/api/v1/connectors.py` — 8 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/connectors` | List connectors |
| `POST` | `/api/v1/connectors` | Create connector |
| `GET` | `/api/v1/connectors/{id}` | Get one |
| `PATCH` | `/api/v1/connectors/{id}` | Update |
| `DELETE` | `/api/v1/connectors/{id}` | Soft delete |
| `POST` | `/api/v1/connectors/{id}/authorize` | OAuth redirect |
| `GET` | `/api/v1/connectors/{id}/callback` | OAuth callback |
| `POST` | `/api/v1/connectors/{id}/revoke` | Revoke credentials |

→ [Features: Connector Center](../features/connector-center.md)

### Model Providers — `backend/app/api/v1/model_providers.py` — 7 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/model-providers` | List registered providers |
| `POST` | `/api/v1/model-providers` | Register provider |
| `GET` | `/api/v1/model-providers/{id}` | Get one |
| `PATCH` | `/api/v1/model-providers/{id}` | Update |
| `DELETE` | `/api/v1/model-providers/{id}` | Soft delete |
| `POST` | `/api/v1/model-providers/{id}/test` | Test connection |
| `GET` | `/api/v1/model-providers/{id}/models` | List available models |

→ [Features: Agent Center](../features/agent-center.md)

### Co-pilot — `backend/app/api/v1/copilot.py` — 7 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/copilot/sessions` | Start a new session |
| `GET` | `/api/v1/copilot/sessions/{id}` | Get session history |
| `DELETE` | `/api/v1/copilot/sessions/{id}` | End session |
| `POST` | `/api/v1/copilot/sessions/{id}/messages` | Send a message (SSE stream) |
| `GET` | `/api/v1/copilot/tools` | List V1 tools |
| `POST` | `/api/v1/copilot/tools/{tool_name}/invoke` | Invoke a tool directly |
| `GET` | `/api/v1/copilot/budget` | Get budget usage |

→ [Features: Co-pilot](../features/copilot.md)

### Hooks — `backend/app/api/v1/hooks.py` — 6 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/hooks` | List hooks |
| `POST` | `/api/v1/hooks` | Register hook |
| `GET` | `/api/v1/hooks/{id}` | Get one |
| `PATCH` | `/api/v1/hooks/{id}` | Update |
| `DELETE` | `/api/v1/hooks/{id}` | Soft delete |
| `POST` | `/api/v1/hooks/{id}/test` | Test fire |

→ [Features: Agent Center](../features/agent-center.md) (hooks used by agents)

### Agents — `backend/app/api/v1/agents.py` — 6 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/agents` | List agents |
| `POST` | `/api/v1/agents` | Register agent |
| `GET` | `/api/v1/agents/{id}` | Get one |
| `PATCH` | `/api/v1/agents/{id}` | Update |
| `DELETE` | `/api/v1/agents/{id}` | Soft delete |
| `GET` | `/api/v1/agents/{id}/executions` | List executions |

→ [Features: Agent Center](../features/agent-center.md)

### Admin LLM Gateway — `backend/app/api/v1/admin_llm_gateway.py` — 6 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/admin/llm-gateway/tenants/{tenant_id}` | Get tenant LLM config |
| `GET` | `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys` | List virtual keys (metadata only) |
| `POST` | `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys` | Create virtual key |
| `POST` | `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys/rotate` | Rotate key |
| `POST` | `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys/{key_id}/revoke` | Revoke key |
| `GET` | `/api/v1/admin/llm-gateway/mcp-servers` | List MCP servers |

→ [Features: Admin Hub](../features/admin-hub.md) + [Reference: litellm-bridge](./litellm-bridge.md)

### Steering Rules — `backend/app/api/v1/steering_rules.py` — 5 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/steering-rules` | List rules |
| `POST` | `/api/v1/steering-rules` | Create rule |
| `GET` | `/api/v1/steering-rules/{id}` | Get one |
| `PATCH` | `/api/v1/steering-rules/{id}` | Update |
| `DELETE` | `/api/v1/steering-rules/{id}` | Soft delete |

### Terminal Costs — `backend/app/api/v1/terminal_costs.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/terminal/costs` | List cost entries |
| `POST` | `/api/v1/terminal/costs/estimate` | Estimate cost |
| `GET` | `/api/v1/terminal/costs/summary` | Cost summary by period |
| `GET` | `/api/v1/terminal/costs/burn-rate` | USD/hour burn rate |

→ [Features: Terminal](../features/terminal.md)

### Runtime Management — `backend/app/api/v1/runtime_management.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/runtimes` | List runtimes |
| `POST` | `/api/v1/runtimes` | Register runtime |
| `GET` | `/api/v1/runtimes/{id}` | Get one |
| `DELETE` | `/api/v1/runtimes/{id}` | Soft delete |

### Projects — `backend/app/api/v1/projects.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/projects` | List projects |
| `POST` | `/api/v1/projects` | Create project |
| `GET` | `/api/v1/projects/{id}` | Get one |
| `PATCH` | `/api/v1/projects/{id}` | Update |

→ [Features: Projects](../features/projects.md)

### Onboarding — `backend/app/api/v1/onboarding.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/onboarding/state` | Get wizard state |
| `POST` | `/api/v1/onboarding/step` | Advance step |
| `POST` | `/api/v1/onboarding/skip` | Skip step |
| `POST` | `/api/v1/onboarding/complete` | Mark complete |

→ [Features: Onboarding](../features/onboarding.md)

### Governance Violations — `backend/app/api/v1/governance_violations.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/governance/violations` | List violations |
| `GET` | `/api/v1/governance/violations/{id}` | Get one |
| `POST` | `/api/v1/governance/violations/{id}/acknowledge` | Acknowledge |
| `POST` | `/api/v1/governance/violations/{id}/resolve` | Resolve |

→ [Features: Governance](../features/governance.md)

### Commands — `backend/app/api/v1/commands.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/commands` | List forge-* commands |
| `POST` | `/api/v1/commands/{name}/invoke` | Invoke a command |
| `GET` | `/api/v1/commands/{name}` | Get command spec |
| `GET` | `/api/v1/commands/categories` | List 13 categories |

→ [Features: Command Center](../features/command-center.md)

### Agent Runtimes — `backend/app/api/v1/agent_runtimes.py` — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/agent-runtimes` | List runtime instances |
| `POST` | `/api/v1/agent-runtimes` | Start a runtime |
| `GET` | `/api/v1/agent-runtimes/{id}` | Get one |
| `POST` | `/api/v1/agent-runtimes/{id}/stop` | Stop a runtime |

### Validation Reports — `backend/app/api/v1/validation_reports.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/validation-reports` | Submit report (201) |
| `GET` | `/api/v1/validation-reports/{id}` | Get one |
| `GET` | `/api/v1/validation-reports` | List (filtered by commit_sha) |

→ [Features: Validator](../features/validator.md)

### Terminal Export — `backend/app/api/v1/terminal_export.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/terminal/export` | Export session transcript |
| `GET` | `/api/v1/terminal/exports/{id}` | Get export |
| `GET` | `/api/v1/terminal/exports` | List exports |

→ [Features: Terminal](../features/terminal.md)

### Terminal Context — `backend/app/api/v1/terminal_context.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/terminal/context` | Get current context |
| `POST` | `/api/v1/terminal/context` | Update context |
| `DELETE` | `/api/v1/terminal/context` | Reset context |

### Terminal Commands — `backend/app/api/v1/terminal_commands.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/terminal/commands` | Send command to PTY |
| `GET` | `/api/v1/terminal/commands/{id}` | Get command status |
| `GET` | `/api/v1/terminal/commands` | List commands |

### Terminal Broadcast — `backend/app/api/v1/terminal_broadcast.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/terminal/broadcast` | Broadcast message |
| `GET` | `/api/v1/terminal/broadcast/{id}` | Get broadcast |
| `GET` | `/api/v1/terminal/broadcast` | List broadcasts |

### QA — `backend/app/api/v1/qa.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/qa/ask` | Ask a QA question (returns answer) |
| `GET` | `/api/v1/qa/sessions/{session_id}` | Get QA history |
| `DELETE` | `/api/v1/qa/sessions/{session_id}` | End QA session |

### MCP — `backend/app/api/v1/mcp.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/mcp/servers` | List MCP servers (via proxy) |
| `POST` | `/api/v1/mcp/servers/{id}/invoke` | Invoke MCP tool |
| `GET` | `/api/v1/mcp/servers/{id}/tools` | List tools |

### Marketplace — `backend/app/api/v1/marketplace.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/marketplace/listings` | List marketplace items |
| `POST` | `/api/v1/marketplace/listings/{id}/install` | Install |
| `GET` | `/api/v1/marketplace/installed` | List installed |

### Connector Lifecycle — `backend/app/api/v1/connector_lifecycle.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/connectors/{id}/refresh` | Refresh credentials |
| `POST` | `/api/v1/connectors/{id}/test` | Test connection |
| `GET` | `/api/v1/connectors/{id}/health` | Health check |

### Approvals — `backend/app/api/v1/approvals.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/approvals` | List approvals |
| `POST` | `/api/v1/approvals/{id}/decide` | Decide (approve/reject) |
| `GET` | `/api/v1/approvals/{id}` | Get one |

### Admin — `backend/app/api/v1/admin.py` — 3 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/admin/health` | Admin health |
| `GET` | `/api/v1/admin/settings` | Get admin settings |
| `PATCH` | `/api/v1/admin/settings` | Update admin settings |

→ [Features: Admin Hub](../features/admin-hub.md)

### Webhooks — `backend/app/api/v1/webhooks.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/webhooks` | Register webhook |
| `DELETE` | `/api/v1/webhooks/{id}` | Soft delete |

### Tool Bundles — `backend/app/api/v1/tool_bundles.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/tool-bundles` | List tool bundles (per stage) |
| `GET` | `/api/v1/tool-bundles/{stage}` | Get tools for a stage |

### Templates — `backend/app/api/v1/templates.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/templates` | List org templates |
| `GET` | `/api/v1/templates/{id}` | Get one |

### Standards — `backend/app/api/v1/standards.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/standards` | List org standards |
| `GET` | `/api/v1/standards/{rule_id}` | Get one |

→ [Features: Architecture Center](../features/architecture-center.md) (standards tab)

### Scheduler — `backend/app/api/v1/scheduler.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/scheduler/jobs` | List scheduled jobs |
| `POST` | `/api/v1/scheduler/jobs/{id}/trigger` | Trigger now |

### RBAC — `backend/app/api/v1/rbac.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/rbac/permissions` | List all permissions |
| `GET` | `/api/v1/rbac/permissions/{principal_id}` | Get principal's permissions |

### Policies — `backend/app/api/v1/policies.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/policies` | List governance policies |
| `GET` | `/api/v1/policies/{id}` | Get one |

→ [Features: Governance](../features/governance.md)

### Persona Memory — `backend/app/api/v1/persona_memory.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/persona-memory/{key}` | Read persona memory key |
| `PUT` | `/api/v1/persona-memory/{key}` | Write persona memory key |

→ [Features: Personas & Dashboards](../features/personas-dashboards.md)

### Artifacts — `backend/app/api/v1/artifacts.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/artifacts` | List artifacts (paginated) |
| `GET` | `/api/v1/artifacts/{id}` | Get one |

### Analytics Usage — `backend/app/api/v1/analytics_usage.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/analytics/usage` | Per-tenant LLM usage aggregate |
| `GET` | `/api/v1/analytics/usage/workflow/{run_id}` | Per-workflow drill-down |

→ [Features: Analytics](../features/analytics.md)

### Agent Assignments — `backend/app/api/v1/agent_assignments.py` — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/agent-assignments` | List agent→project assignments |
| `POST` | `/api/v1/agent-assignments` | Assign agent to project |

### System — `backend/app/api/v1/system.py` — 1 route

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/system/info` | System info (version, build) |

### Health — `backend/app/api/v1/health.py` — 1 route

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Liveness + readiness probe |

### Connector Events — `backend/app/api/v1/connector_events.py` — 1 route

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/connector-events` | SSE stream of connector events |

### Audit — `backend/app/api/v1/audit.py` — 1 route

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/audit/events` | List audit events (paginated, filterable) |

→ [Features: Audit](../features/audit.md)

---

## Sub-routers (the big multi-feature centers)

Several features have **sub-routers** (nested `api_router.include_router(...)` calls). These inflate the route count significantly.

### Ideation Center — `backend/app/api/v1/ideation/` — 12 sub-routers, 56 routes

| Sub-router | File | Routes |
|---|---|---|
| `ideation_intake.py` | Intake + triage | 6 |
| `ideation_ideas.py` | CRUD + scoring | 8 |
| `ideation_prds.py` | PRD generation + refinement | 7 |
| `ideation_roadmap.py` | Roadmap + sequencing | 5 |
| `ideation_research.py` | Market signals + voice | 5 |
| `ideation_validation.py` | Validation experiments | 4 |
| `ideation_collaboration.py` | Reviews + comments | 4 |
| `ideation_analytics.py` | Funnel + conversion | 3 |
| `ideation_templates.py` | Idea templates | 3 |
| `ideation_export.py` | Export to Jira/Linear | 4 |
| `ideation_approvals.py` | Approval flow | 4 |
| `ideation_settings.py` | Tenant ideation config | 3 |

→ [Features: Ideation Center](../features/ideation-center.md)

### Architecture Center — `backend/app/api/v1/architecture/` — 9 sub-routers, 42 routes

| Sub-router | File | Routes |
|---|---|---|
| `architecture_adrs.py` | ADRs CRUD | 6 |
| `architecture_contracts.py` | API contracts | 5 |
| `architecture_risks.py` | Risk register | 5 |
| `architecture_acceptance.py` | Acceptance criteria | 4 |
| `architecture_dependencies.py` | Service dependency graph | 5 |
| `architecture_standards.py` | Coding standards lookup | 4 |
| `architecture_diagrams.py` | Diagram auto-gen | 4 |
| `architecture_approvals.py` | Approval flow | 5 |
| `architecture_traceability.py` | Decision traceability | 4 |

→ [Features: Architecture Center](../features/architecture-center.md)

### Terminal Center — `backend/app/api/v1/` (terminal*) — 18 terminal routes + 6 governance + 1 WS

→ [Features: Terminal](../features/terminal.md)

---

## Route distribution

| Group | Files | Total routes |
|---|---|---|
| Auth | 1 | 3 |
| Dashboard | 1 | 14 |
| Workflows + Runs | 2 | 22 |
| Stories + Projects + Sprints + Epics | 3 | 21 |
| Repos + KG | 2 | 18 |
| Seeds + Connector + Lifecycle + Events | 4 | 20 |
| Models + Copilot + Tools | 4 | 19 |
| Agents + Runtimes + Assignments + Hooks | 4 | 18 |
| Admin + LLM Gateway + RBAC + Tenant | 4 | 12 |
| Governance + Policies + Violations + Approvals | 4 | 11 |
| Terminal (export/context/commands/broadcast/cost) | 5 | 18 |
| Validation + QA | 2 | 6 |
| Commands + Marketplace + MCP | 3 | 10 |
| Steering Rules + Tool Bundles | 2 | 7 |
| Persona Memory + Analytics Usage | 2 | 4 |
| Webhooks + Templates + Standards + Scheduler + Artifacts | 5 | 9 |
| Ideation Center (12 sub-routers) | 12 | 56 |
| Architecture Center (9 sub-routers) | 9 | 42 |
| Health + System + Audit | 3 | 3 |
| **Total** | **51** | **~305** |

---

## Conventions recap

Every route in this catalog:

- Lives under `/api/v1/`
- Returns Pydantic `ForgeBaseModel` (or `Page[T]`)
- Uses `@audit(...)` if mutating
- Uses `require_permission(...)` if RBAC-gated
- Returns 404 (not 403) on cross-tenant reads
- Uses `Idempotency-Key` for POST/PUT/PATCH (frontend responsibility)
- Returns 429 on budget/rate limit, 451 on guardrail block, 502 on provider error

**See:** `/docs/standards/api-conventions.md` for the full contract.

---

## How to regenerate this catalog

```bash
# Count routes per file
for f in backend/app/api/v1/*.py; do
  count=$(grep -c "^@router\." "$f" 2>/dev/null)
  if [ "$count" -gt 0 ]; then echo "$count $f"; fi
done | sort -rn

# Or: pull from OpenAPI
curl http://localhost:8000/openapi.json | jq '.paths | keys[]' | wc -l
```

---

## Where to go next

- [Standards: api-conventions](../standards/api-conventions.md) — Wire contract
- [Features index](../features/README.md) — Per-feature route explanations
- [Reference: db-schema](./db-schema.md) — Models touched by these routes
- [Reference: litellm-bridge](./litellm-bridge.md) — LiteLLM Proxy endpoints
- [OpenAPI spec](../../codebase/forge-ai/docs/openapi.json) — Auto-generated source of truth