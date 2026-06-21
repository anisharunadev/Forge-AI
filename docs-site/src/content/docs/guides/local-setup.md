---
title: Local Setup
description: Set up a Forge AI development environment on Linux or macOS.
---

This is the long-form version of the [Quickstart](/start-here/quickstart/). It covers every prerequisite, every configuration knob, and every common pitfall.

## Prerequisites

| Tool | Minimum | Why |
|---|---|---|
| Node.js | 20 LTS | Next.js dev server, MCP server TS packages |
| pnpm | 9+ | Monorepo workspace manager |
| Python | 3.13+ | FastAPI backend, LangGraph orchestrator |
| Docker | 24+ | Postgres, Redis, LocalStack |
| Docker Compose | v2 | Local infra |
| Git | 2.40+ | Repo checkout |
| `make` | any | Optional convenience targets |
| `curl`, `jq` | any | Smoke tests |

Recommended host specs:

- 8 vCPU, 16 GB RAM (the FastAPI backend + Next.js dev server + Postgres + Redis + LocalStack is comfortable on this).
- 20 GB free disk for Docker images and Postgres data.

## Clone and configure

```bash
git clone <repo-url> forge-ai
cd forge-ai

cp .env.example .env
$EDITOR .env
```

The `.env` file is the configuration surface. Required:

| Var | Example | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Required for Claude-backed agents |
| `FORGE_DATABASE_URL` | `postgresql://forge:forge@localhost:5432/forge` | Defaults to docker-compose |
| `FORGE_REDIS_URL` | `redis://localhost:6379/0` | Defaults to docker-compose |

Optional, used by individual features:

| Var | Feature |
|---|---|
| `OPENAI_API_KEY` | OpenAI model provider |
| `GITHUB_TOKEN` | GitHub connector |
| `JIRA_API_TOKEN` | Jira connector |
| `CONFLUENCE_API_TOKEN` | Confluence connector |

## Run infrastructure

```bash
docker compose up -d
docker compose ps          # → 3 services healthy: postgres, redis, localstack
```

Services:

- **postgres** (`postgres:16-alpine`) on `:5432` — local stand-in for production PostgreSQL 17 + Apache AGE + pgvector. Schema is portable.
- **redis** (`redis:7-alpine`) on `:6379` — cache + pub/sub.
- **localstack** (`localstack/localstack:3.8`) on `:4566` — local AWS (S3 + IAM + STS + Secrets Manager).

## Run the backend

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e .

alembic upgrade head                # run migrations
uvicorn backend.app.main:app --reload --port 8000
```

Smoke test:

```bash
curl http://localhost:8000/api/v1/health
```

Visit `http://localhost:8000/docs` for the interactive Swagger UI (dev only).

## Run the frontend

```bash
# from repo root, in a second terminal
pnpm --filter forge-dashboard dev       # listens on :3000
```

Smoke test:

```bash
curl http://localhost:3000/healthz
open http://localhost:3000/dashboard
```

## Common pitfall — the `app.tenant_id` setting

Every database transaction sets `app.tenant_id` from the request context. The connection pool resets it between tenants. If you write a backend script that talks to Postgres directly, you must set the GUC manually:

```sql
SET app.tenant_id = 'acme-corp';
SET app.project_id = 'acme-api';
```

Otherwise RLS denies every read and write.

## Common pitfall — provider keys

`forge-onboard-detect-stack` works without any provider keys. Most other commands need at least `ANTHROPIC_API_KEY`. The LiteLLM Proxy will fail loudly with a 503 if no virtual key is configured for the tenant.

To bootstrap a tenant's virtual key, use the platform seed script (see the README in `infra/`).

## Common pitfall — port collisions

If `:3000`, `:5432`, `:6379`, `:4566`, or `:8000` is taken, edit `docker-compose.yml` or the corresponding launch command. The backend respects `FORGE_DATABASE_URL` etc., so the changes are isolated.

## Run tests

```bash
pnpm --filter forge-dashboard test
cd backend && pytest
```

## Tear down

```bash
docker compose down -v   # -v removes volumes; without it Postgres data persists
```

## When to use this guide

Use this guide when:

- Setting up a development environment for the first time.
- Troubleshooting a fresh install.
- Adding a new contributor to the project.

For production, skip to [Production deployment](/guides/production-deploy/).

## Related

- [Quickstart](/start-here/quickstart/)
- [Troubleshooting](/guides/troubleshooting/)
- [Production deployment](/guides/production-deploy/)
