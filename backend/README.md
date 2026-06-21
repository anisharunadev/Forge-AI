# `backend` — Forge AI Backend

**Status:** 0.2.0 (Phase 2: Foundation + M1 Substrate)
**Python:** 3.13+
**Entry point:** [`backend/app/main.py`](app/main.py) — `app` (FastAPI instance)

The Forge AI backend is the FastAPI application that powers every Forge surface: REST API at `/api/v1`, WebSocket routes at the root (`/ws/terminal/...`, `/ws/runs/...`, `/ws/ideation/...`), LangGraph SDLC orchestrator, knowledge graph, connector center, approval gates, and the append-only audit ledger.

The complete public surface is described in [`docs/openapi.json`](../docs/openapi.json) (204 operations across 167 paths).

## Tech

| Concern | Technology |
| --- | --- |
| Web framework | FastAPI (async) |
| Data validation | Pydantic v2 |
| ORM | SQLAlchemy 2.0 (async) |
| Migrations | Alembic (config at `backend/alembic.ini`) |
| Database | PostgreSQL 17 + Apache AGE + pgvector |
| Cache / PubSub | Redis |
| Agent runtime | LangGraph + LangChain |
| LLM proxy | LiteLLM Proxy (model-provider agnostic) |
| Telemetry | OpenTelemetry (traces + metrics + logs) |
| Realtime | Native WebSocket + Redis Pub/Sub |
| PTY (Terminal Center) | Native Python `pty` |
| Audit | Append-only PostgreSQL table + daily hash chain |
| Tests | pytest (asyncio_mode=auto), ruff, mypy |
| Lint / Format | ruff (line-length=100, target=py313) |

## Run (dev)

```bash
# 1. Bring up infra (postgres + redis + localstack)
docker compose up -d

# 2. Install deps
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e .

# 3. Run migrations
alembic upgrade head

# 4. Start the dev server with auto-reload
uvicorn backend.app.main:app --reload --port 8000

# 5. Smoke-test
curl http://localhost:8000/api/v1/health
```

The dev server listens on `:8000` by default; the Next.js console (`apps/forge`) proxies to it via `FORA_FORGE_API_URL=http://localhost:4000` (or whichever URL the orchestrator is mounted at — see `apps/forge/README.md`).

## Structure

```text
backend/
├── app/
│   ├── main.py                # FastAPI app, lifespan, middleware, router wiring
│   ├── api/
│   │   ├── v1/                # REST routers mounted at /api/v1
│   │   │   ├── router.py      # Aggregator — pulls every sub-router
│   │   │   ├── health.py
│   │   │   ├── admin.py
│   │   │   ├── agents.py      # /agents, /agents/{id}
│   │   │   ├── agent_assignments.py
│   │   │   ├── agent_runtimes.py
│   │   │   ├── approvals.py
│   │   │   ├── artifacts.py
│   │   │   ├── audit.py
│   │   │   ├── connectors.py
│   │   │   ├── hooks.py
│   │   │   ├── knowledge_graph.py
│   │   │   ├── marketplace.py
│   │   │   ├── model_providers.py
│   │   │   ├── onboarding.py
│   │   │   ├── policies.py
│   │   │   ├── qa.py
│   │   │   ├── rbac.py
│   │   │   ├── repos.py
│   │   │   ├── runs.py        # /runs, /runs/{id}, /runs/{id}/stream
│   │   │   ├── runtime_management.py
│   │   │   ├── standards.py
│   │   │   ├── templates.py
│   │   │   ├── terminal_*.py  # terminal commands, costs, broadcast, context, export
│   │   │   ├── ideation/      # /ideation — ideas, prds, roadmaps, scoring, kg, push, ...
│   │   │   └── architecture/  # /architecture — adrs, contracts, approvals, risk, ...
│   │   └── ws/                # WebSocket routers (root mount)
│   │       ├── terminal.py            # /ws/terminal/{session_id}
│   │       ├── terminal_broadcast.py  # /ws/terminal/{session_id}/watch
│   │       ├── runs.py                # /ws/runs/{run_id}
│   │       └── ideation/workflow.py   # /ws/ideation/{session_id}
│   ├── core/                  # Cross-cutting infra
│   │   ├── config.py          # pydantic-settings; reads .env
│   │   ├── logging.py         # Structured logging
│   │   ├── telemetry.py       # OpenTelemetry init
│   │   ├── audit.py           # Audit hooks
│   │   ├── idempotency.py     # Idempotency-Key middleware
│   │   └── security.py        # Auth / RBAC helpers
│   ├── db/
│   │   ├── base.py            # SQLAlchemy declarative base
│   │   ├── session.py         # async session factory
│   │   ├── rls.py             # Row-level security helpers
│   │   └── models/            # ORM models
│   ├── schemas/               # Pydantic request/response schemas
│   │   ├── agents.py, approvals.py, architecture.py, ...
│   ├── services/              # Domain services
│   │   ├── forge_commands.py  # FORGE_COMMAND_MAP (60+ commands, 13 categories)
│   │   ├── sdlc_run_manager.py
│   │   ├── knowledge_graph.py
│   │   ├── agent_runtime.py
│   │   ├── agent_registry.py
│   │   ├── agent_assignment.py
│   │   ├── connector_manager.py
│   │   ├── policy_engine.py
│   │   ├── audit_service.py
│   │   ├── cost_ledger.py
│   │   ├── event_bus.py
│   │   ├── freshness_ledger.py
│   │   ├── hook_orchestrator.py
│   │   ├── litellm_client.py
│   │   ├── marketplace.py
│   │   ├── model_provider_registry.py
│   │   ├── rbac.py
│   │   ├── runtime_management.py
│   │   ├── artifact_registry.py
│   │   ├── admin_service.py
│   │   ├── ideation/          # ideation services
│   │   ├── architecture/      # architecture services
│   │   ├── project_intelligence/
│   │   ├── project_onboarding/
│   │   └── terminal/          # terminal services
│   ├── agents/                # LangGraph agent runtime
│   │   ├── sdlc_agent.py      # supervisor graph
│   │   ├── sdlc_state.py      # SDLCState (Pydantic)
│   │   ├── nodes/             # Graph nodes (one per phase)
│   │   ├── tools/             # GSDWrapper + tool wrappers
│   │   ├── cost_tracking.py
│   │   ├── approval_gate.py
│   │   └── hook_integration.py
│   └── terminal/              # PTY + workspace isolation
├── tests/                     # pytest suite (see below)
├── alembic.ini
├── pyproject.toml
└── Dockerfile
```

## M1 Substrate Primitives

The M1 substrate is the typed, low-level layer that every higher-level service depends on:

| Primitive | Module | Purpose |
| --- | --- | --- |
| `SDLCState` | `app/agents/sdlc_state.py` | Pydantic state passed through the LangGraph supervisor |
| Audit row | `app/schemas/audit.py` + `app/db/models/audit.py` | WORM record + chain hash |
| Approval row | `app/schemas/approvals.py` + `app/db/models/approval.py` | HITL gate record |
| Connector state | `app/services/connector_states.py` | Per-tenant MCP connector state machine |
| Forge command | `app/services/forge_commands.py` | `forge-*` command descriptor |
| Knowledge graph node | `app/schemas/knowledge_graph.py` + AGE | Apache AGE node + pgvector embedding |
| Cost ledger row | `app/services/cost_ledger.py` | Per-run, per-tenant, per-project cost attribution |
| Freshness ledger row | `app/services/freshness_ledger.py` | Per-graph-node freshness timestamp + source |
| Hook event | `app/services/hook_orchestrator.py` | Pre/post stage hooks |
| Idempotency record | `app/core/idempotency.py` | `Idempotency-Key` claim tracking |

## M2 Services

The M2 services compose the substrate into customer-facing surfaces:

| Service | Module | Surface |
| --- | --- | --- |
| SDLC run manager | `app/services/sdlc_run_manager.py` | `/api/v1/runs`, `/ws/runs/{id}` |
| Knowledge graph | `app/services/knowledge_graph.py` | `/api/v1/kg/*` |
| Connector manager | `app/services/connector_manager.py` | `/api/v1/connectors/*`, `/api/v1/marketplace/*` |
| Agent registry | `app/services/agent_registry.py` | `/api/v1/agents`, `/api/v1/agent-assignments` |
| Agent runtime | `app/services/agent_runtime.py` + `runtime_management.py` | `/api/v1/runtimes/*` |
| Model provider registry | `app/services/model_provider_registry.py` | `/api/v1/model-providers/*` |
| RBAC | `app/services/rbac.py` | `/api/v1/rbac/*`, `/api/v1/roles` |
| Policy engine | `app/services/policy_engine.py` | gates; powers approvals |
| Hook orchestrator | `app/services/hook_orchestrator.py` | `/api/v1/hooks/*` |
| Marketplace | `app/services/marketplace.py` | `/api/v1/marketplace/*` |
| Ideation | `app/services/ideation/*` | `/api/v1/ideation/*` |
| Architecture | `app/services/architecture/*` | `/api/v1/architecture/*` |
| Project intelligence | `app/services/project_intelligence/*` | KG ingest, freshness, conflicts |
| Project onboarding | `app/services/project_onboarding/*` | `/api/v1/onboarding/*` |
| Terminal | `app/services/terminal/*` | `/api/v1/terminal/*`, `/ws/terminal/*` |

## Test

```bash
cd backend
pytest backend/tests                    # full suite
pytest backend/tests/test_architecture_core.py -k "adr"   # one area
pytest backend/tests -x --cov=app --cov-report=term-missing
```

Configuration: `asyncio_mode = auto` (no need to mark async tests), `addopts = -ra -q`, `testpaths = tests`.

Test categories live in [`docs/testing/`](../docs/testing/): `test-strategy.md`, `test-naming.md`, `langgraph-integration-tests.md`, `terminal-center-tests.md`, `security-pen-test.md`.

## Database setup (PostgreSQL 17 + Apache AGE + pgvector)

For local dev the bundled Docker image in `docker-compose.yml` provides a vanilla `postgres:16-alpine`. For the full stack you need PostgreSQL 17 with Apache AGE and pgvector installed.

```bash
# Option A: use the all-in-one dev image (recommended)
docker run -d --name forge-pg \
  -e POSTGRES_USER=fora -e POSTGRES_PASSWORD=fora -e POSTGRES_DB=fora \
  -p 5432:5432 \
  ghcr.io/fora/postgres-age-pgvector:17

# Option B: install into an existing cluster
#   1. install postgres 17 (apt: postgresql-17; brew: postgresql@17)
#   2. install pgvector: https://github.com/pgvector/pgvector
#   3. install apache AGE: https://github.com/apache/age
#   4. createdb fora; createuser fora
psql -d fora -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d fora -c "CREATE EXTENSION IF NOT EXISTS age;"
```

Migrations live under `alembic/versions/`. The migrator is the only path that creates tables; in production it runs as a non-superuser role with `BYPASSRLS` only in allow-listed migration paths (see [`docker-compose.yml`](../docker-compose.yml)).

## Environment Variables

Read by `app/core/config.py` (pydantic-settings). The most important:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FORA_DATABASE_URL` | `postgres://fora:fora@localhost:5432/fora` | Primary DB |
| `REDIS_URL` | `redis://localhost:6379` | Cache + pub/sub |
| `FORA_ENV` | `dev` | `dev` / `staging` / `prod` |
| `FORA_DEFAULT_COST_CEILING_USD` | `100.00` | Per-run cost ceiling |
| `FORA_AUDIT_ENABLED` | `1` | 0 = disable file-sink audit |
| `FORA_AUDIT_LOG` | `.fora/audit/tenancy-denied.jsonl` | File-sink audit path |
| `ANTHROPIC_API_KEY` | — | Required for Claude-backed agents |
| `LITELLM_PROXY_URL` | (set per-tenant) | LiteLLM Proxy endpoint |
| `OTLP_ENDPOINT` | — | OpenTelemetry collector |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `CORS_ORIGINS` | (allow-list) | Comma-separated list |
| `FORA_SEED_TENANT_ID` | `acme-corp` | Demo tenant for first-boot seed |

See [`.env.example`](../.env.example) for the full template.

## Mounting and Routing

`app/main.py` mounts:

- `api_router` at `/api/v1` — every REST route
- `terminal_ws_router` at root — `/ws/terminal/{session_id}`
- `terminal_broadcast_ws_router` at root — `/ws/terminal/{session_id}/watch`
- `ideation_ws_router` at root — `/ws/ideation/{session_id}`
- `/` — trivial root route for k8s probes

The `lifespan` context manager boots structured logging, OpenTelemetry, and the event bus; it tears them down on shutdown.

## Dependencies on other packages

- `packages/mcp-schemas` — JSON-Schema contracts for MCP server tools
- `packages/mcp-router` — multi-tenant MCP request router
- `packages/object-store` — S3 / LocalStack object store adapter
- `packages/oidc-clients` — OIDC client for Keycloak
- `packages/contracts` — typed artifact contracts (ADR, API Contract, Task Breakdown, ...)
- `packages/forge-ui` — shared UI primitives consumed by `apps/forge`
