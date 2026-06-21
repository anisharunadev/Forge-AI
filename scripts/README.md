# scripts/

Single source of truth for Forge AI v2.0 developer and operator scripts.
All scripts are bash, follow `set -euo pipefail`, and are idempotent.
The Paperclip-era scripts (`dev-up.sh`, `localstack-init.sh`,
`smoke.sh`) live in `archive/paperclip/scripts/`.

## Quick reference

| Script                  | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `setup-local.sh`        | First-time bootstrap of the local dev stack            |
| `deploy.sh`             | Build / push / migrate / restart / smoke for an env    |
| `db-migrate.sh`         | Thin wrapper around `alembic` (upgrade/downgrade/etc)  |
| `lint.sh`               | `ruff check` + `ruff format --check` + `mypy`          |
| `typecheck.sh`          | `tsc --noEmit` on `apps/forge`                         |
| `postgres-init/01-extensions.sql` | Enables pgvector, AGE, uuid-ossp, pgcrypto   |
| `postgres-init/02-age-setup.sql`  | Creates `forge_graph` + `litellm` database |
| `floci-init/01-create-buckets.sh` | Creates Forge's S3 buckets on first floci boot |
| `docs-site/Dockerfile`  | Multi-stage Astro 5 + Starlight build (static site)    |

## First-time setup

```bash
cp .env.example .env             # edit secrets
./scripts/setup-local.sh         # idempotent; safe to re-run
```

`setup-local.sh` will:

1. Verify `docker`, `docker compose`, `python3.13`, `pnpm`, `node` are installed.
2. Copy `.env.example` to `.env` if it is missing.
3. `docker compose pull` every image declared in `docker-compose.yml`.
4. `docker compose up -d` the full v2.0 stack (postgres, redis, keycloak,
   litellm, floci, backend, forge-ui, docs-site).
5. Wait for postgres + keycloak to report healthy.
6. Run `alembic upgrade head` against the dev database.
7. `pip install -r backend/requirements.txt`.
8. `pnpm install --filter @forge/forge...`.
9. Print every developer URL.

Subsequent boots are a one-liner:

```bash
docker compose up -d
```

## Local development

| Task                  | Command                                    |
| --------------------- | ------------------------------------------ |
| Tail backend logs     | `docker compose logs -f backend`           |
| Tail frontend logs    | `docker compose logs -f forge-ui`          |
| Open a postgres shell | `docker compose exec postgres psql -U forge -d forge` |
| Open a redis shell    | `docker compose exec redis redis-cli`      |
| Restart one service   | `docker compose restart backend`           |
| Tear down (keep vol)  | `docker compose down`                      |
| Tear down (drop vol)  | `docker compose down -v`                   |

## Database migrations

`scripts/db-migrate.sh` is a thin wrapper around `alembic`. It picks
up `DATABASE_URL` from `.env`. Examples:

```bash
scripts/db-migrate.sh upgrade head
scripts/db-migrate.sh downgrade -1
scripts/db-migrate.sh revision -m "add tenant_invitations table"
scripts/db-migrate.sh current
scripts/db-migrate.sh history
```

The Postgres 17 + Apache AGE + pgvector extensions are installed by
`postgres-init/01-extensions.sql` and the property graph is created
by `postgres-init/02-age-setup.sql`. Both run automatically on the
first boot of a fresh data volume.

## Lint & typecheck

```bash
scripts/lint.sh          # ruff + mypy on backend
scripts/lint.sh --fix    # autofix + format
scripts/typecheck.sh     # tsc --noEmit on apps/forge
```

These are exactly what CI runs; keeping them as scripts means the
"how do I lint?" question has one canonical answer.

## Production deploys

```bash
./scripts/deploy.sh --env=staging
./scripts/deploy.sh --env=prod
```

`deploy.sh` is the single entry point for shipping a build. It will:

1. Build `backend` and `forge-ui` images.
2. Tag and push them to the configured registry (`ghcr.io/forge-ai` by
   default; tag is the short git SHA unless overridden with `--tag=`).
   Push is **skipped for `--env=dev`**.
3. Run `alembic upgrade head` against the target database.
4. Trigger a rolling restart of the backend deployment. Dev uses
   `docker compose up -d --force-recreate backend`; staging/prod
   delegate to `infra/terraform/<env>/` (ECS / k8s / ArgoCD).
5. Run a smoke test against `/health` on the backend. On failure
   the script rolls the deployment back to the previous image and
   exits non-zero. Use `--no-rollback` to fail without rolling back.

Other useful flags:

- `--skip-push` — build but do not push (useful for dry-runs).
- `--skip-migrate` — do not run migrations (only safe if the commit
  does not touch `backend/alembic/`).
- `--skip-smoke` — skip the post-deploy health check (not for prod).

### Required per-env files

`deploy.sh` sources `infra/env/<env>.env`. Each file must define at
minimum:

```bash
DATABASE_URL=postgresql://forge:<pw>@<host>:5432/forge
LITELLM_MASTER_KEY=<hex>
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

The repo does **not** commit these files. Generate them with
`terraform output` (see `infra/terraform/<env>/`) and keep them on
the operator's workstation.

## Why floci instead of MinIO?

Floci is the open-source LocalStack Community replacement
(`https://github.com/floci-io/floci`) — LocalStack Community was sunset in
March 2026. A single ~90 MB image with ~13 MiB RAM and ~24 ms startup
emulates 58 AWS services.

For Forge AI v2.0 that means one container covers:

- S3 — artifacts, terminal exports, docs (S3-compatible API)
- SQS — async event handling
- SNS — fan-out notifications
- Lambda — serverless agent runtimes (future)
- RDS — database emulation (future)
- DynamoDB, Secrets Manager, IAM, STS

The backend talks to floci the same way it would talk to real AWS:
`boto3` and the JS SDK pick up `AWS_ENDPOINT_URL` automatically, so
production deploys leave that env var unset and the same code targets
real S3, SQS, etc. (per ADR-001: cloud-only AWS in prod).

The Docker socket is mounted into the floci container so it can spin
up Docker-backed services (Lambda runtimes, RDS emulation) on demand.

## Adding a new script

- Place it directly in this directory.
- Shebang: `#!/usr/bin/env bash`.
- First non-comment line: `set -euo pipefail`.
- Make it idempotent — the same script must produce the same end
  state whether it is run once or ten times.
- Reference the relevant ADR / DL in a header comment.
- Add it to the table above.
- `chmod +x scripts/<name>.sh` before committing.
