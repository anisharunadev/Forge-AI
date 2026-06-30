# Getting Started

> The 5-minute walkthrough to a running Forge stack.

## Prerequisites

- pnpm >= 9 (monorepo package manager)
- Python 3.13
- Docker (for Postgres / Redis / floci)
- Git

## Stack startup

```bash
# 1. Workspace deps
pnpm install

# 2. Local infra (Postgres 17 + AGE + pgvector, Redis, floci S3 emulator)
docker compose up -d postgres redis floci

# 3. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 4. Frontend (separate terminal)
cd apps/forge && pnpm dev   # http://localhost:3000
```

## Common commands

Run from repo root unless noted.

| Task | Command |
|---|---|
| Frontend dev server | `pnpm --filter forge-dashboard dev` |
| Frontend build | `pnpm --filter forge-dashboard build` |
| Frontend typecheck | `pnpm --filter forge-dashboard typecheck` |
| Frontend unit tests | `pnpm --filter forge-dashboard test` (vitest) |
| Frontend e2e tests | `pnpm --filter forge-dashboard test:e2e` (playwright) |
| Full stack dev (terminal + UI) | `pnpm dev:stack` |
| Terminal sidecar only | `pnpm dev:terminal` |
| Backend run | `cd backend && uvicorn app.main:app --reload` |
| Backend tests | `cd backend && pytest` |
| DB migrations (apply) | `cd backend && alembic upgrade head` |
| DB migration (new) | `cd backend && alembic revision --autogenerate -m "..."` |
| Seed demo tenants | `cd backend && python -m seeds` |
| Docs coverage check | `./scripts/check-feature-docs.sh` |
| Constitution check | `./scripts/check-claude-md.sh` |
| Regenerate built-features | `./scripts/generate-built-features.sh` |

## Local infrastructure

```text
docker-compose.yml (repo root) exposes:
  postgres          :5432   Postgres 17 + Apache AGE + pgvector
  redis             :6379   cache + pub/sub
  floci             :9000   S3 emulator (ADR-001)
  backend           :8000   FastAPI
  forge-terminal-server :7681  xterm.js PTY sidecar
```

## Environment templates

| Stack | Template |
|---|---|
| Root (multi-stack) | `.env.example` |
| Frontend | `apps/forge/.env.example` |
| Backend | `backend/.env.example` |

For personal prefs not shared with the team, use `.claude.local.md` (gitignored).

## Demo tenant

After seed (`cd backend && python -m seeds`):

- Tenant: `acme-corp`
- Login via Keycloak realm (see `infra/keycloak-init/`)
