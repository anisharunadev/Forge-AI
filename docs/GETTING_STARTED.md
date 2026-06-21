# Getting Started — Forge AI for New Developers

This guide gets you from `git clone` to a running Forge AI stack in roughly fifteen minutes. It assumes a Unix-like host (Linux or macOS) with Docker, Node, pnpm, and Python installed.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 20+ (LTS) | Next.js 15 dev server, MCP server TS packages |
| pnpm | 9+ | Monorepo workspace manager |
| Python | 3.13+ | FastAPI backend, LangGraph orchestrator |
| Docker | 24+ | Postgres, Redis, LocalStack |
| Docker Compose | v2 (`docker compose`) | Local infra |
| Git | 2.40+ | Repo checkout |
| `make` | any | Optional convenience targets |
| `curl`, `jq` | any | Smoke tests |

## Clone and setup

```bash
git clone <repo-url> forge-ai
cd forge-ai

# Copy the env template and set ANTHROPIC_API_KEY (required for Claude-backed agents)
cp .env.example .env
$EDITOR .env

# Install JS deps across the monorepo
pnpm install
```

The root `package.json` exposes workspace-wide scripts including `forge:list` and `forge:exec` (see [`docs/FORGE_COMMANDS.md`](FORGE_COMMANDS.md)).

## Run infrastructure

```bash
docker compose up -d
docker compose ps          # → 3 services healthy: postgres, redis, localstack
```

The bundled stack (see [`docker-compose.yml`](../docker-compose.yml)) boots:

- **postgres** (`postgres:16-alpine`) on `:5432`
- **redis** (`redis:7-alpine`) on `:6379`
- **localstack** (`localstack/localstack:3.8`) on `:4566` (S3 + IAM + STS + Secrets Manager)

For the full Postgres 17 + Apache AGE + pgvector image used by the backend, see [`backend/README.md`](../backend/README.md).

## Run the backend

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e .

alembic upgrade head               # run migrations

# In one terminal
uvicorn backend.app.main:app --reload --port 8000
```

Smoke test:

```bash
curl http://localhost:8000/api/v1/health
```

## Run the frontend

```bash
# from repo root, in a second terminal
pnpm --filter forge-dashboard dev      # listens on :3000
```

Smoke test:

```bash
curl http://localhost:3000/healthz
open http://localhost:3000/dashboard
```

The console proxies server-side requests to `FORA_FORGE_API_URL` (default `http://localhost:4000` for the orchestrator; point it at the FastAPI backend with `FORA_FORGE_API_URL=http://localhost:8000` for the Phase 2 dev loop).

## Access the app

| URL | Purpose |
| --- | --- |
| http://localhost:3000/dashboard | All-persona landing dashboard |
| http://localhost:3000/forge-command-center | Run `forge-*` commands |
| http://localhost:3000/forge-terminal | xterm.js + native PTY |
| http://localhost:3000/knowledge-center | Browse + search the KG |
| http://localhost:3000/personas/pm | PM dashboard |
| http://localhost:3000/personas/eng-lead | Eng Lead dashboard |
| http://localhost:3000/personas/cto | CTO / VP Eng dashboard |
| http://localhost:8000/api/v1/health | Backend health |
| http://localhost:8000/docs | FastAPI interactive Swagger (dev only) |

## Run tests

```bash
# Backend (Python)
cd backend
pytest backend/tests                              # full suite
pytest backend/tests -k "architecture"            # one area
pytest backend/tests -x --cov=app --cov-report=term-missing

# Frontend unit (Vitest)
pnpm --filter forge-dashboard test

# Frontend e2e (Playwright)
pnpm --filter forge-dashboard test:e2e

# Forge command smoke
pnpm forge:list
pnpm forge:exec forge-intel-scan-repo --args '{"repo_id":"acme-api"}'
```

Test conventions: [`docs/testing/test-strategy.md`](testing/test-strategy.md), [`docs/testing/test-naming.md`](testing/test-naming.md).

## First contribution

1. **Pick a task.** ADRs and pilot docs are great sources of small, well-scoped work; the planning briefs under `docs/planning-artifacts/briefs/` are too.

2. **Read the rules.** [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) is the single-page summary; the eight constitutional rules are immutable.

3. **Branch.**

   ```bash
   git checkout -b feat/<short-name>
   ```

4. **Write code + tests.** Tests live next to the package they exercise (`backend/tests/`, `apps/forge/__tests__/`, `apps/forge/tests/`).

5. **Run the test gates locally** before pushing:

   ```bash
   ruff check backend/app backend/tests
   mypy backend/app
   pytest backend/tests
   pnpm --filter forge-dashboard typecheck
   pnpm --filter forge-dashboard test
   ```

6. **Open a draft PR.** The staged workflow runs the bar automatically — Knowledge Layer check, ADR coverage check, RLS / multi-tenancy check, audit-trail check, OpenAPI regeneration.

7. **Sign the CLA** on first PR.

## Common pitfalls

- **Forgot `ANTHROPIC_API_KEY`.** The Claude-backed agents fail at the first token; LiteLLM Proxy logs the 401. Set it in `.env` and restart the backend.
- **`port already in use`.** Postgres (`5432`), Redis (`6379`), LocalStack (`4566`), FastAPI (`8000`), Orchestrator (`4000`), Forge console (`3000`). Override via `.env`.
- **Tests can't connect to Postgres.** `docker compose ps` first; the backend test fixtures expect a live `postgres` container with the FORA role and DB.
- **OpenAPI spec is stale.** The live spec is regenerated by the Documentation Agent on doc runs; locally you can run `python -c "from backend.app.main import app; import json; print(json.dumps(app.openapi(), indent=2))" > docs/openapi.json` to refresh.
- **`forge:exec` says "unknown command".** The command map lives at [`backend/app/services/forge_commands.py`](../backend/app/services/forge_commands.py); run `pnpm forge:list` to see the canonical 60+ entries.

## Next steps

- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — system architecture
- [`docs/FORGE_COMMANDS.md`](FORGE_COMMANDS.md) — `forge-*` command reference
- [`docs/architecture/decisions/`](architecture/decisions/README.md) — ADRs
- [`docs/testing/test-strategy.md`](testing/test-strategy.md) — how we test
- [`docs/operations/oncall-runbook.md`](operations/oncall-runbook.md) — oncall expectations
