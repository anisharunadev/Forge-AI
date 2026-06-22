# Technology Stack

**Analysis Date:** 2026-06-22

## Languages

**Primary:**
- TypeScript 5.9.2 (apps, packages, MCP servers) - Strict mode + `noUncheckedIndexedAccess`; JSX preserved for Next.js
- Python 3.13 (backend) - Async-first (asyncio_mode=auto), `requires-python = ">=3.13"`

**Secondary:**
- Shell / Bash (`scripts/*.sh`, `scripts/postgres-init/*`, `scripts/floci-init/*`)
- SQL (PostgreSQL 17 + Apache AGE + pgvector init scripts in `scripts/postgres-init/`)
- Astro MDX (`docs-site/` Starlight content)
- YAML (`docker-compose.yml`, `infra/litellm/config.yaml`, ArgoCD/Helm charts, Keycloak realm export)

## Runtime

**Node.js:**
- Engines: `>=20` for `apps/forge`, `packages/*`, `mcp-servers/*`
- Dockerfiles pin `node:22-alpine` (`apps/forge/Dockerfile`)

**Python:**
- `python:3.13-slim` (`backend/Dockerfile`)

**Package Manager:**
- pnpm 9.15.0 (`packageManager` in root `package.json`; pinned in Dockerfiles)
- Workspace declared in `pnpm-workspace.yaml`: `packages/*`, `apps/*`, `mcp-servers/*`
- Lockfile present (`pnpm-lock.yaml`)

**Container:**
- Docker Compose v2 (`docker compose`) for local dev stack (`docker-compose.yml`)
- Container images: pgvector/pgvector:pg17, redis:7-alpine, quay.io/keycloak/keycloak:26.0.0, ghcr.io/berriai/litellm:main-latest, floci/floci:latest

## Frameworks

**Frontend:**
- Next.js 15.0.3 (App Router, `output: 'standalone'`) — `apps/forge/next.config.mjs`
- React 19.0.0-rc (RC build: `19.0.0-rc-66855b96-20241106`) — paired with `react-dom`
- TanStack Query `^5.59.16` — server-state cache
- Zustand `^5.0.0` — client state
- React Flow `^11.11.4` (visualization, mandatory per Project Intelligence First principle)
- Recharts `^2.13.0` (charts)
- React Hook Form `^3.9.0` resolver + Zod `^3.23.8` schemas
- Radix UI primitives (Dialog, Dropdown, Label, ScrollArea, Select, Separator, Slot, Tabs, Toast, Tooltip) — Shadcn/UI foundation
- `cmdk` `^1.0.0` — command palette
- `@xterm/xterm` `^5.5.0` + `@xterm/addon-fit` + `@xterm/addon-web-links` — Terminal Center UI shell
- `node-pty` `^1.0.0` — backend terminal PTY (used via the separate terminal-server.mjs)
- Tailwind CSS `3.4.14` + `tailwindcss-animate` `^1.0.7` (Note: project CLAUDE.md declares Tailwind 4, but installed version is 3.4.14)
- class-variance-authority, clsx, tailwind-merge — Shadcn utility stack
- date-fns `^4.1.0`
- lucide-react `^0.453.0` — icons (`components.json` iconLibrary: lucide)

**Backend:**
- FastAPI `>=0.115,<0.117` (`backend/requirements.txt`) — async REST + WebSocket
- Uvicorn `[standard] >=0.30,<0.33` — ASGI server (2 workers in container)
- Pydantic v2 `>=2.7,<3` + `pydantic-settings >=2.4,<3` — request/response models and 12-factor config (`app/core/config.py`)
- SQLAlchemy 2.x async `sqlalchemy[asyncio] >=2.0,<2.1` + `asyncpg >=0.29,<0.31` — ORM and driver
- Alembic `>=1.13,<1.15` — migrations (`backend/alembic.ini`)
- LangGraph `>=0.2.0` + LangChain `>=0.3.0` + langchain-core `>=0.3.0` — SDLC agent runtime (`app/agents/sdlc_agent.py`, `refactor_agent.py`)
- LiteLLM `>=1.40,<2` — client SDK used ONLY for type stubs; HTTP via httpx in prod (`app/services/litellm_client.py`, Rule 1)
- APScheduler `>=3.10,<4` — in-process AsyncIOScheduler for daily ideation ingest / nightly memory consolidation (`app/services/scheduler.py`)
- Watchdog `>=4.0,<7` — filesystem watcher for live re-indexing (Steering Rules Engine, F-504)
- structlog `>=24.1,<25` — structured JSON logging (`app/core/logging.py`)
- python-jose `[cryptography] >=3.3,<4` — JWT decode (`app/core/security.py`)
- passlib `[bcrypt] >=1.7.4,<2` — password hashing (dev only)
- pexpect `>=4.9,<5` — process control
- python-multipart `>=0.0.9` — form/file uploads
- websockets `>=13.0,<14` — WS server endpoints (`app/api/ws/*`)
- httpx `>=0.27,<0.29` — async HTTP (LiteLLM Proxy client, alertmanager alerts, etc.)

**Observability:**
- OpenTelemetry API/SDK `>=1.27,<2`
- `opentelemetry-instrumentation-fastapi`, `opentelemetry-instrumentation-sqlalchemy` (auto-instrumentation)
- `opentelemetry-exporter-otlp` + `opentelemetry-semantic-conventions >=0.48b0`
- Initialised via `app/core/telemetry.py` (OTLP exporter configured through `OTLP_ENDPOINT` env var)

**Shared Libraries (`packages/*`):**
- `forge-ai/mcp-router` (`0.3.7`) — typed McpRouter port + InMemoryMcpRouter, discriminated McpError union, ServerManifest schema, per-server circuit breaker, tenant scope gate
- `forge-ai/connector-events` (`0.1.1`) — universal audit envelope, hash-chained per-(tenant, binding) emit pipeline, Tier-1 family event catalogs (Jira/Confluence/GitHub/Slack/Teams), typed-artifact RBAC gating

**MCP Servers (`mcp-servers/*`):**
13 connector MCP servers, all using `@modelcontextprotocol/sdk ^1.0.4` over stdio, with Zod-validated tool contracts:
- `forge-ai/mcp-github` (uses `@octokit/rest ^21.0.0`)
- `forge-ai/mcp-jira`
- `forge-ai/mcp-aws` (uses `@aws-sdk/client-cloudcontrol`, `client-cloudformation`, `client-sts ^3.658.0`)
- `forge-ai/mcp-secrets` (uses `@aws-sdk/client-secrets-manager ^3.658.0`)
- `forge-ai/mcp-slack`
- `forge-ai/mcp-confluence`
- `forge-ai/mcp-azure-devops`
- `forge-ai/mcp-figma`
- `forge-ai/mcp-clickup`
- `forge-ai/mcp-sonarqube`
- `forge-ai/mcp-zendesk`
- `forge-ai/mcp-databricks`
- `forge-ai/mcp-arch-analyzer` (deterministic codebase graph extractor — no LLM in inner loop)
- `@forge-ai/mcp-adobe-xd`
- `@forge-ai/mcp-kiro`

**Docs Site (`docs-site/`):**
- Astro `^5.0.0` + `@astrojs/starlight ^0.30.0`
- `@astrojs/check ^0.9.0`
- Sharp `^0.33.0`

## Testing

**Frontend:**
- Vitest `2.1.0` (config: `apps/forge/vitest.config.ts`) — unit/integration; `@vitest/coverage-v8 2.1.9` in packages
- jsdom `25.0.1` — DOM environment
- `@testing-library/react 16.0.1` + `@testing-library/dom 10.4.0`
- Playwright `1.48.0` — E2E (`apps/forge/playwright.config.ts`)

**Backend:**
- pytest (asyncio_mode=auto, configured in `pyproject.toml`) — `backend/tests/`
- Ruff `>=0.x` — lint + format (`pyproject.toml [tool.ruff]`)
- mypy (relaxed: `strict=false`, pydantic plugin) — type check

## Build / Dev Tooling

**Frontend:**
- PostCSS `8.4.47` + autoprefixer `10.4.20`
- TypeScript `5.9.2` — `strict: true`, `noUncheckedIndexedAccess: true`
- Concurrently `^9.0.1` — multi-process dev stack (`pnpm dev:stack`)

**Backend:**
- Setuptools `>=68` build backend (`pyproject.toml`)
- tini (Docker ENTRYPOINT) — proper signal handling
- Uvicorn 2 workers in production container

## Key Dependencies (Decision-Relevant)

**Critical:**
- `litellm` (client SDK, stub-only) + `httpx` — only path to LLM providers per Rule 1
- `langgraph` + `langchain` — agent orchestration (refactor_agent, sdlc_agent, code_validator)
- `sqlalchemy[asyncio]` + `asyncpg` — Postgres + Apache AGE + pgvector via single connection
- `apscheduler` — single-process scheduler; multi-replica requires Postgres advisory lock (Phase 4 follow-up)

**Infrastructure SDKs:**
- AWS SDKs only inside MCP servers (`@aws-sdk/client-* ^3.658.0`) and the optional `boto3` wrapper in `app/services/aws_transform_client.py` (graceful fallback when not installed)

## Configuration

**Environment:**
- Backend: 12-factor via `pydantic-settings` (`backend/app/core/config.py`)
  - Required env vars: `DATABASE_URL`, `REDIS_URL`, `LITELLM_PROXY_URL`, `LITELLM_API_KEY`, `KEYCLOAK_URL`, `JWT_SECRET`
  - Optional: `OTLP_ENDPOINT`, `GITHUB_WEBHOOK_SECRET`, `DEV_AUTH_BYPASS` (dev only)
- Frontend: `apps/forge/.env.local` consumed by Next.js runtime
- Template: `.env.example` at repo root, copied by `scripts/setup-local.sh`

**Build:**
- Frontend: `apps/forge/tsconfig.json` (strict TS, path alias `@/*`)
- Backend: `backend/pyproject.toml` (Ruff rules `E,F,I,B,UP,SIM,PL`, per-file-ignores for `app/api/**` and `tests/**`)

**Workspace:**
- `pnpm-workspace.yaml` declares three globs (`packages/*`, `apps/*`, `mcp-servers/*`) and a `protobufjs` build exception

## Platform Requirements

**Development:**
- Node `>=20`, pnpm `>=9` (pnpm 9.15.0 exact)
- Python 3.13+
- Docker + Docker Compose v2
- Setup command: `bash scripts/setup-local.sh` (idempotent)

**Production:**
- AWS managed services per ADR-001 (compose is dev-only; production lives in `infra/terraform/`)
- ArgoCD + Helm charts in `infra/charts/` for GitOps deployment
- Conftest policy checks in `infra/conftest/`
- Identity broker at `infra/identity-broker/` (fronts Keycloak)
- Object store (S3) provisioned in `infra/object-store/`
- TLS/auth refs in `infra/auth/jwt-claims.md`, `tenant-middleware.md`, `infra/keycloak/realm-forge.json`

---

*Stack analysis: 2026-06-22*