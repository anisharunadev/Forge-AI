# backend — Forge API (FastAPI / Python 3.13)

Multi-tenant FastAPI service. Powers every Integration Phase from
`docs/standards/integration-phases.md` and is the only consumer of the
3 spec-driven packages.

## Always-loaded rules

Inherits all 18 rules from `.claude/CLAUDE.md`. Pay particular attention to:

- **Rule 1** — No direct LLM SDKs. All provider traffic goes through LiteLLM
  Proxy via `httpx`. Forbidden imports: `openai`, `anthropic`, `google.generativeai`,
  `langchain_openai`, `cohere`, `ollama`.
- **Rule 2** — Every query must filter on `tenant_id` AND `project_id`.
  Audit rows and KG nodes are no exception. Tenancy is enforced via
  composite indexes `(tenant_id, project_id, …)` on every tenant-scoped
  table; look at any model in `app/db/models/` for the pattern.
- **Rule 3** — No workflow may cross Architecture / Security / Deployment
  boundaries without a human approval gate.
- **Rule 6** — Every agent call must write an audit row (agent, model, prompt,
  tool, cost, artifact, timestamp, result).
- **Rule 7** — All execution paths emit OpenTelemetry traces / metrics / logs.

## Stack at a glance

- **FastAPI** + **Pydantic v2** (use `model_validate`/`model_dump`, not v1 syntax)
- **SQLAlchemy 2.x async** + **asyncpg** (no sync sessions)
- **Alembic** for schema migrations
- **Redis** for cache + pub/sub
- **structlog** for JSON logs
- **python-jose** for JWT, **passlib[bcrypt]** for passwords
- **httpx** (async) for outbound calls — never `requests`

## Conventions

- **Async-first**: every endpoint, every DB call, every HTTP call.
- **Multi-tenancy is mandatory**: every SQLA model includes `tenant_id` +
  `project_id`. Add a composite index on every tenant-scoped table.
- **Typed artifacts** (Rule 4): every output schema lives in `app/schemas/`
  — never return free-form dicts.
- **No business logic in routes**: keep `app/api/` thin; logic in
  `app/services/`.
- **Service names**: `{domain}_service.py` (e.g. `story_service.py`,
  `agent_service.py`).
- **Migrations** are append-only. Never edit a merged migration — add a new
  one. Demo-tenant rows in `seeds/` are idempotent.

## Directory map

```
backend/
├── app/
│   ├── main.py             FastAPI app factory + lifespan
│   ├── api/                HTTP routers (thin)
│   ├── services/           Business logic
│   ├── schemas/            Pydantic v2 models (typed artifacts)
│   ├── db/                 SQLAlchemy session, base, models, migrations
│   ├── core/               config, security, crypto, telemetry, logging
│   ├── agents/             Agent runtime glue (LangGraph + LiteLLM)
│   ├── integrations/
│   │   └── litellm/        LiteLLM Proxy client (the ONLY way to call LLMs)
│   │       ├── llm_client.py          chat_complete() entry point
│   │       ├── key_manager.py · budget_sync.py · tenant_sync.py
│   │       ├── model_assignment.py · health_monitor.py
│   │       ├── mcp_server_registry.py · skill_sync.py
│   │       └── secrets_manager_client.py · litellm_base_client.py
│   ├── terminal/           PTY / terminal sidecar endpoints
│   └── copilot/            Chat + streaming endpoints
├── alembic/                Migrations (env.py + versions/)
├── seeds/                  Idempotent demo-tenant seeders
├── tests/                  pytest + httpx AsyncClient
├── scripts/                Operational scripts (rotate-keys, etc.)
├── pyproject.toml
├── requirements.txt
└── .env.example
```

## Service subdirs (quick map)

Each subdir under `app/services/` owns one bounded context:

| Subdir | Owns |
|---|---|
| `architecture/` | Service catalog, API contracts |
| `connector_ingestion/` · `connectors/` | External integrations |
| `ideation/` | Idea scoring, market signals |
| `memory/` | Org vs project knowledge boundaries (R5) |
| `observability/` | Tracing, audit (R6, R7) |
| `project_intelligence/` | KG, codebase scan (R10) |
| `project_onboarding/` | Day-one bootstrap (`day_one_bootstrap.py`) |
| `scheduler/` | Background jobs |
| `steering_rules.py` | Per-tenant guardrails |
| `terminal/` | PTY sidecar |

## Ideation router quirks (Step-69)

- **Query params, not body:** `POST /ideation/ideas/impact/compare` and `POST /ideation/ideas/score/batch` accept `idea_ids` as repeated **query params** (`?idea_ids=a&idea_ids=b`), not a JSON body. Build with `URLSearchParams.append('idea_ids', id)`. Frontend hooks in `lib/api/ideation-hooks.ts` already do this.
- **Nested paths:** Most ideation endpoints nest under `/ideation/ideas/{id}/...` (arch-preview, prd, score, impact-graph, analyze, archive). Flat endpoints: `/ideation/ideas` (list), `/ideation/roadmaps`, `/ideation/approvals`, `/ideation/workflows`. Verify with `grep -n "@router" backend/app/api/v1/ideation/*.py` before writing client code.
- **Orphan router footgun:** When adding a file under `backend/app/api/v1/ideation/`, you MUST register it in BOTH `__init__.py` (import + `__all__`) AND `router.py` (`include_router`). Silent failure otherwise — `enhance.py` was orphaned until Step-69. Detect orphans: `grep -L "<module>" backend/app/api/v1/ideation/__init__.py` against the file list.
- **WebSocket path:** ideation workflow WS is `/ws/ideation/{session_id}` (mounted in `app/main.py` with no prefix). NOT `/api/ws/ideation/workflow`.
- **Missing endpoints (verified Step-69):** `/ideation/sources`, `/destinations`, `/market-signals`, `/voice-clusters`, `/ingest/status` are NOT registered. Puller services exist under `services/ideation/sources/` but no REST surface. Treat as known gaps until a backend step ships them.

## Common commands

```bash
# Activate venv
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run
uvicorn app.main:app --reload --port 8000

# Backing services (Redis / Postgres / Keycloak) — required before `uvicorn`
../scripts/setup-local.sh                  # repo root: brings up docker compose
# or manually:
docker compose up -d redis postgres keycloak

# Tests
pytest                                    # all
pytest tests/services/test_agent.py -k   # one file / pattern

# Migrations
alembic upgrade head                      # apply
alembic revision --autogenerate -m "..."  # new (review the diff!)
alembic downgrade -1                      # roll back one

# Seeds (idempotent demo tenants)
python -m seeds

# Lint / format (project convention)
ruff check .
ruff format .
```

## Migrations — extra caution

- **Review autogenerated migrations** before commit. Alembic cannot detect
  column renames, enum value changes, or data migrations.
- **Multi-tenant tables** must add `tenant_id` (UUID, NOT NULL, indexed) and
  `project_id` (UUID, NOT NULL, indexed). A composite index
  `(tenant_id, project_id, …)` is preferred.
- **Demo seed isolation**: the `is_demo` tenant list is opt-in; never add
  real tenants there (see seeds README).

## Provider abstraction

```python
# ✅ correct — talks to LiteLLM Proxy
from app.integrations.litellm.llm_client import chat_complete
await chat_complete(model="claude-sonnet-4-6", messages=[...])

# ❌ forbidden — direct SDK
import anthropic          # NO
import openai             # NO
from langchain_openai import ChatOpenAI   # NO
```

`app/integrations/litellm/` is the **only** package allowed to import
provider-shaped SDKs (and even there, it should go through LiteLLM Proxy).

## LiteLLM reference (read before adding new routes)

The integration code above is the **thin client**. The **complete endpoint
catalog** (25 domains, 703 endpoints) and the **Forge feature → LiteLLM
endpoint matrix** live in `docs/litellm/`:

- `docs/litellm/forge-litellm-integration.md` — system architecture,
  per-feature endpoint matrix, master/virtual key model, anti-patterns,
  guardrail pipeline, cost aggregation, MCP tool wiring.
- `docs/litellm/litellm-forge-reference.md` — **curated** Forge-priority
  digest (637 of 703 endpoints, grouped by domain with P0–P3 priority).
- `docs/litellm/litellm-endpoints.md` — **complete** flat catalog of all
  703 endpoints from the OpenAPI spec (every method+path+summary+opId+tags).
  Use this when the curated digest doesn't list a path.
- `docs/litellm/litellm-critical-schemas.json` — request/response
  shapes Forge Backend must model (ChatCompletion, Tool, Guardrail,
  Policy, Skill, Prompt, BudgetNewRequest, KeyRequest, SpendLogs).
- `docs/litellm/litellm-openapi.json` — full OpenAPI 3.1 spec (1.2 MB).

**Key gotchas** (from the integration doc):
- Use `POST /key/generate` to mint per-user / per-agent virtual keys;
  the master key is server-side only — never for user requests.
- Always send `metadata={forge_run_id, forge_agent_id, forge_tenant_id}`
  on `chat/completions` — LiteLLM's `/spend/logs` reconciles against it.
- Pre-call guardrail is mandatory: `POST /apply_guardrail` before
  every `chat/completions`, even for "internal" requests.
- Stream `chat/completions` (`stream: true`) — final SSE chunk carries
  `usage` for live cost meter; synchronous calls break it.

## Observability

- OpenTelemetry auto-instruments FastAPI + SQLAlchemy + httpx.
- Every service emits a `forge.{domain}.{action}` span with `tenant_id`,
  `project_id`, and `actor_id` attributes (Rule 6 + 7).
- structlog binds `tenant_id`, `project_id`, `request_id` to the context.
- Audit rows go to `audit_log` (append-only). They are the source of truth
  for the Audit Center UI.

## Tests

- `pytest` + `pytest-asyncio` + `httpx.AsyncClient` for API tests.
- Use the in-process test DB (`TEST_DATABASE_URL`) — never the dev DB.
- For multi-tenant tests, **always** create two tenants and assert row
  isolation.