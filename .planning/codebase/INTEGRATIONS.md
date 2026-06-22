# External Integrations

**Analysis Date:** 2026-06-22

## Provider Abstraction Layer (PAL / DL-025)

All LLM traffic flows through the **LiteLLM Proxy** (`http://litellm:4000`). The backend never imports `openai`, `anthropic`, or any provider SDK — see `backend/app/services/litellm_client.py` (httpx-only) and the explicit comment in `backend/requirements.txt` ("Rule 1 (NO direct LLM SDKs)"). The `litellm` package is installed for type stubs only.

The model catalog is declared in `infra/litellm/config.yaml`:
- Chat: `gpt-4o`, `gpt-4o-mini`, `claude-3-5-sonnet`, `claude-3-5-haiku`
- Embeddings: `text-embedding-3-small` (1536 dims, default), `text-embedding-3-large` (3072 dims)

Upstream keys are read from `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` env vars on the proxy container.

## APIs & External Services

### LLM Providers (via LiteLLM Proxy)

- **OpenAI**
  - Client: `httpx` → LiteLLM Proxy → `openai/*`
  - Auth env (on LiteLLM container): `OPENAI_API_KEY`
- **Anthropic**
  - Client: `httpx` → LiteLLM Proxy → `anthropic/*`
  - Auth env (on LiteLLM container): `ANTHROPIC_API_KEY`

### Connectors (via MCP Servers — `mcp-servers/*`)

Each connector is a standalone Node MCP server (`@modelcontextprotocol/sdk ^1.0.4` over stdio). Forge agents call them via the `McpRouter` port (`packages/mcp-router`).

**Source Control:**
- **GitHub** — `forge-ai/mcp-github`
  - SDK: `@octokit/rest ^21.0.0`
  - Auth: GitHub App or PAT scoped to a single org
  - Tools: `list_repos`, `get_pr`, `list_prs`, `create_pr_comment`, `list_issues`, `create_issue`, `search_code`
- **Azure DevOps** — `forge-ai/mcp-azure-devops`
  - Auth: project-scoped PAT (single org + project)
  - Tools: `list_projects`, `list_repos`, `list_pipelines`, `run_pipeline`, `get_pipeline_run`, `list_work_items`, `get_work_item`, `create_work_item`, `add_work_item_comment`

**Issue / Project Tracking:**
- **Jira** — `forge-ai/mcp-jira`
  - Auth: Atlassian API token scoped to a single `cloudId`
  - Tools: `list_projects`, `list_issues`, `get_issue`, `create_issue`, `update_issue`, `add_comment`, `transition_issue`
- **ClickUp** — `forge-ai/mcp-clickup`
  - Auth: ClickUp personal API token pinned to a single `CLICKUP_LIST_ID`
  - Tools: `list_tasks`, `search_tasks`, `get_task`, `create_task`, `update_task`, `set_task_status`, `list_comments`, `add_comment`
- **Zendesk** — `forge-ai/mcp-zendesk`
  - Auth: Zendesk API token (Basic auth, base64(email/token:apitoken))
  - Tools: `list_tickets`, `get_ticket`, `search_tickets`, `create_ticket`, `update_ticket`, `add_comment`, `list_macros`, `apply_macro`

**Docs / Knowledge:**
- **Confluence** — `forge-ai/mcp-confluence`
  - Auth: Atlassian API token + email, pinned to a single space key
  - Tools: `list_pages`, `get_page`, `create_page`, `update_page`, `add_comment`

**Communication:**
- **Slack** — `forge-ai/mcp-slack`
  - Auth: Slack bot token (`xoxb-…`) pinned to a single workspace
  - Tools: `list_channels`, `list_threads`, `get_thread`, `post_message`, `update_message`, `add_reaction`, `search_messages`

**Code Quality:**
- **SonarQube** — `forge-ai/mcp-sonarqube`
  - Auth: SonarQube user token (pinned to a single project)
  - Tools: `list_projects`, `get_project`, `search_components`, `get_component_measures`, `list_issues`, `get_issue`, `transition_issue`, `get_quality_gate`

**Cloud:**
- **AWS** — `forge-ai/mcp-aws`
  - SDKs: `@aws-sdk/client-cloudcontrol ^3.658.0`, `@aws-sdk/client-cloudformation`, `@aws-sdk/client-sts`
  - Auth: standard AWS SDK credential chain, pinned to one account + region
  - Tools: `list_stacks`, `get_stack`, `list_stack_resources`, `get_resource`, `list_change_sets`, `get_change_set`, `describe_change_set`
- **AWS Transform** — invoked directly from the Refactor Agent via `app/services/aws_transform_client.py` (optional `boto3`); not an MCP server

**Design:**
- **Figma** — `forge-ai/mcp-figma`
  - Auth: Figma personal access token, pinned to a single file + team
  - Tools: `get_file`, `get_file_nodes`, `get_node`, `get_images`, `get_comments`, `post_comment`
- **Adobe XD** — `@forge-ai/mcp-adobe-xd`
  - Auth: OAuth2 (Adobe IMS), pinned to a single XD file + project
  - Tools: `get_asset`, `list_components`, `export_spec`, `get_design_tokens`

**Data / Analytics:**
- **Databricks** — `forge-ai/mcp-databricks`
  - Auth: workspace-scoped service-principal PAT
  - APIs: Databricks Jobs REST 2.1 + SQL Statement Execution
  - Tools: `list_jobs`, `get_job`, `run_job`, `get_run`, `cancel_run`, `list_clusters`, `get_cluster`, `execute_sql`

**IDEs:**
- **Kiro** — `@forge-ai/mcp-kiro`
  - Auth: Kiro daemon socket or local HTTP API
  - Tools: `get_open_files`, `get_current_selection`, `get_active_task_queue`, `get_agent_run_history`

**Local Analysis:**
- **arch-analyzer** — `forge-ai/mcp-arch-analyzer`
  - Deterministic codebase graph extraction for TypeScript, Python, Go, Java (no LLM in the inner loop; cost stays under $0.50 on 50k LOC)
  - Output: `codebase-graph.json` + `summary.md`
- **secrets** — `forge-ai/mcp-secrets`
  - SDK: `@aws-sdk/client-secrets-manager ^3.658.0`
  - Tools: `resolve(secret_ref)`, `rotate(secret_ref)` — returns redacted envelope; raw values never cross the broker boundary

## Data Storage

**Primary Database — PostgreSQL 17:**
- Image: `pgvector/pgvector:pg17` (postgres:17-alpine does NOT include pgvector; ADR-002)
- Connection: `DATABASE_URL` env var (`postgresql+asyncpg://...`)
- Pool: `database_pool_size=10`, `database_max_overflow=20`
- ORM: SQLAlchemy 2.x async + Alembic for migrations (`backend/alembic.ini`)
- **Extensions:**
  - **pgvector** — vector search for embeddings (pgvector pre-installed in chosen image)
  - **Apache AGE** — property graph for the knowledge graph; loaded at init via `scripts/postgres-init/`
- **Single-DB Policy (ADR-002):** PostgreSQL 17 is the only OLTP/graph/vector store. No additional database engines.
- **LiteLLM Database:** separate `litellm` database on the same Postgres instance, created by `scripts/postgres-init/03`

**Cache / Pub-Sub — Redis 7:**
- Image: `redis:7-alpine` (`--maxmemory 256mb`, `--maxmemory-policy allkeys-lru`, `--appendonly yes`)
- Connection: `REDIS_URL` env var (`redis://redis:6379/0`)
- Uses: Pub/Sub event bus (`app/services/event_bus.py`), session store, LiteLLM rate-limit backplane
- Event channel prefix: `forge:events:` (configurable)

**File Storage:**
- Dev: **floci** (S3-compatible local emulator; LocalStack Community successor, sunset March 2026) at `http://floci:4566`, services `s3,sqs,sns,lambda,rds,secretsmanager,iam,sts,dynamodb`
- Prod: **AWS S3** (ADR-001)
- Buckets: `S3_BUCKET_ARTIFACTS`, `S3_BUCKET_TERMINAL_EXPORTS`, `S3_BUCKET_DOCS` (env-configurable)
- SDK access via `AWS_ENDPOINT_URL` env var

**Caching:** None beyond Redis

## Authentication & Identity

**Identity Provider — Keycloak:**
- Image: `quay.io/keycloak/keycloak:26.0.0`
- Mode (dev): `start-dev` with `--import-realm` preloading `infra/keycloak/realm-forge.json`
- Realm: `forge` (configurable via `KEYCLOAK_REALM` env var)
- Client: `forge-backend` (`KEYCLOAK_CLIENT_ID`, `KEYCLOAK_AUDIENCE`)
- URL: `KEYCLOAK_URL` env var (e.g. `http://keycloak:8080`)
- Token validation: `python-jose` with HS256 in dev, RS256 via JWKS in prod (`backend/app/core/security.py`)
- Tenant + project IDs extracted from JWT claims for downstream RLS

**Production Identity Topology:**
- Keycloak runs in `start` mode behind a managed Postgres
- Fronted by an **identity broker** (`infra/identity-broker/`) — referenced in ADR-001
- Provisioning runbook: `infra/keycloak/tenant-provisioning.md`

**Auth Bypass (dev only):**
- `DEV_AUTH_BYPASS=1` on backend container — relaxes JWT requirement for the Next.js proxy wizard. Never set in production.

**Webhooks:**
- GitHub webhook signature verification via `GITHUB_WEBHOOK_SECRET` (HMAC SHA-256); empty value disables verification (dev only) — `backend/app/core/config.py`
- Webhook handler in `backend/app/api/v1/webhooks.py`

## Monitoring & Observability

**OpenTelemetry (Rule 7):**
- API + SDK `>=1.27,<2`
- Auto-instrumentation: `opentelemetry-instrumentation-fastapi`, `opentelemetry-instrumentation-sqlalchemy`
- Exporter: `opentelemetry-exporter-otlp` (OTLP HTTP/gRPC)
- Endpoint: `OTLP_ENDPOINT` env var (when unset, telemetry is disabled)
- Insecure flag: `OTEL_EXPORTER_OTLP_INSECURE=true` (configurable)
- Service name: `forge-backend` (`OTEL_SERVICE_NAME`)

**Structured Logging:**
- `structlog >=24.1,<25`
- Initialised in `backend/app/core/logging.py` via `configure_logging(level=settings.log_level)`
- Output: JSON

**Alerting:**
- `app/services/observability/alerts.py` — AlertManager subscribers attach to the event bus for MCP / approval / connector failures
- Talks to AlertManager over HTTP via `httpx`

**Audit:**
- `app/services/audit_service.py` + `db/models/audit.py` — required by Rule 6 (Mandatory Auditability)

## CI/CD & Deployment

**Hosting:**
- AWS managed services per ADR-001
- Terraform in `infra/terraform/` (IAM module present at `infra/terraform/iam.tf`)
- Helm charts at `infra/charts/` for service deployment

**GitOps:**
- ArgoCD applications at `infra/argocd/`
- Conftest policy checks at `infra/conftest/`

**CI Pipeline:**
- GitHub Actions (`.github/`) — referenced as the canonical CI provider; local scripts mirror the same gates (`scripts/typecheck.sh`, `scripts/lint.sh`)

**Local Orchestration:**
- `scripts/deploy.sh`, `scripts/db-migrate.sh`, `scripts/setup-local.sh`, `scripts/typecheck.sh`, `scripts/lint.sh`
- `docker-compose.yml` for the dev stack

## Environment Configuration

**Required env vars (backend):**
- `DATABASE_URL` — Postgres connection
- `REDIS_URL` — Redis connection
- `LITELLM_PROXY_URL` — LiteLLM Proxy base URL
- `LITELLM_API_KEY` — Proxy bearer token
- `KEYCLOAK_URL` — OIDC issuer base URL
- `JWT_SECRET` — HS256 secret or RS256 PEM public key

**Required env vars (LiteLLM container):**
- `LITELLM_MASTER_KEY` — proxy master key (proxy refuses to start if missing)
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — upstream provider keys

**Optional / situational:**
- `OTLP_ENDPOINT` — OTLP collector URL (disabled when unset)
- `GITHUB_WEBHOOK_SECRET` — webhook HMAC verification
- `DEV_AUTH_BYPASS` — dev-only flag
- `KEYCLOAK_*`, `S3_BUCKET_*`, `AWS_ENDPOINT_URL`, `FLOCI_*` — storage/identity tuning

**Secrets location:**
- `.env` at repo root (never committed; loaded by pydantic-settings and Docker Compose)
- `.env.example` documents the schema
- Production secrets managed via AWS Secrets Manager (read by `forge-ai/mcp-secrets`)

## Webhooks & Callbacks

**Incoming:**
- GitHub webhook handler in `backend/app/api/v1/webhooks.py` (HMAC SHA-256 via `GITHUB_WEBHOOK_SECRET`)
- Hook integration points in `app/agents/hook_integration.py` (LangGraph agent hooks)

**Outgoing:**
- Connector events fan-out via the Redis-backed `event_bus` (`app/services/event_bus.py`)
- Alertmanager notifications from `app/services/observability/alerts.py`
- WebSocket broadcasts from `app/api/ws/terminal_broadcast.py` and `app/api/ws/runs.py` (server → browser fanout)

---

*Integration audit: 2026-06-22*