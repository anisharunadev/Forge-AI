---
title: Quickstart
description: From git clone to a running Forge AI stack in roughly fifteen minutes.
---

This page takes you from a fresh `git clone` to a running Forge AI stack and your first `forge-*` command. Target: **fifteen minutes** on a Linux or macOS host with Docker, Node 20+, pnpm 9+, and Python 3.13+ installed.

## What is this?

A condensed version of the [Local setup guide](/guides/local-setup/). The quickstart skips optional features (Keycloak realm import, full AWS topology) and focuses on the loop: clone, run, invoke, observe.

## Prerequisites

| Tool | Minimum version | Why |
|---|---|---|
| Node.js | 20 LTS | Next.js dev server, MCP server TS packages |
| pnpm | 9+ | Monorepo workspace manager |
| Python | 3.13+ | FastAPI backend, LangGraph orchestrator |
| Docker | 24+ | Postgres, Redis, LocalStack |
| Docker Compose | v2 | Local infra |
| `curl`, `jq` | any | Smoke tests |

## How do I use it?

### Step 1 — Clone and configure

```bash
git clone <repo-url> forge-ai
cd forge-ai

cp .env.example .env
$EDITOR .env   # set ANTHROPIC_API_KEY (required for Claude-backed agents)
```

The `.env` file is the configuration surface. It must include `ANTHROPIC_API_KEY`; other provider keys are optional until you exercise multi-provider workflows.

### Step 2 — Install dependencies

```bash
pnpm install
```

The root `package.json` exposes workspace-wide scripts including `forge:list` and `forge:exec`.

### Step 3 — Run infrastructure

```bash
docker compose up -d
docker compose ps   # → 3 services healthy: postgres, redis, localstack
```

The bundled stack boots:

- **postgres** (`postgres:16-alpine`) on `:5432`
- **redis** (`redis:7-alpine`) on `:6379`
- **localstack** (`localstack/localstack:3.8`) on `:4566` (S3 + IAM + STS + Secrets Manager)

### Step 4 — Run the backend

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e .

alembic upgrade head                # run migrations

# In one terminal
uvicorn backend.app.main:app --reload --port 8000
```

Smoke test:

```bash
curl http://localhost:8000/api/v1/health
```

### Step 5 — Run the frontend

```bash
# from repo root, in a second terminal
pnpm --filter forge-dashboard dev       # listens on :3000
```

Smoke test:

```bash
curl http://localhost:3000/healthz
open http://localhost:3000/dashboard
```

### Step 6 — Run your first forge-* command

From the [Command Center](http://localhost:3000/forge-command-center):

1. Pick a category (try `Onboarding`).
2. Pick a command (try `forge-onboard-detect-stack`).
3. Fill the args form.
4. Submit.

Or from the CLI:

```bash
pnpm forge:list                            # list all 63 commands
pnpm forge:exec forge-onboard-detect-stack \
  --args '{"repo_id":"acme-api"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

You should see the command echo in the Command Center within a few seconds and land in the audit ledger at `/api/v1/audit/`.

## How does it work?

Forge's local stack is a faithful subset of production. PostgreSQL 16 stands in for production PostgreSQL 17 + Apache AGE + pgvector (the differences are extension-only — the schema is portable). LocalStack stands in for AWS. Keycloak is opt-in.

The full production topology is in [Production deployment](/guides/production-deploy/) and the architecture diagram is in [Architecture overview](/architecture/overview/).

## When should I use it?

Use the quickstart when:

- You want to evaluate Forge locally before requesting an AWS account.
- You are a contributor setting up your development environment.
- You want to test a `forge-*` command against sample repos before touching production.

If you need a production-shaped stack (multi-AZ RDS, real Keycloak, real KMS, real CloudTrail), skip to [Production deployment](/guides/production-deploy/).

## What's next?

| If you want to… | Go to |
|---|---|
| Run a full SDLC workflow end-to-end | [First SDLC run](/guides/first-sdlc-run/) |
| Connect a real repo and ingest it | [Project Intelligence → Scan repo](/commands/project-intelligence/) |
| Understand the architecture | [Architecture tour](/start-here/architecture-tour/) |
| Operate a pilot | [Pilot program](/operations/pilot-overview/) |
| Customize agents | [Custom agents](/guides/custom-agents/) |

## Related

- [Local setup guide](/guides/local-setup/) — the long form with troubleshooting
- [Troubleshooting](/guides/troubleshooting/) — common pitfalls
- [forge-* commands](/reference/forge-commands/) — the executable reference
