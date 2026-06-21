#!/usr/bin/env bash
# scripts/db-migrate.sh — thin wrapper around `alembic` for Forge AI.
#
# Usage:
#   scripts/db-migrate.sh upgrade head          # apply all pending
#   scripts/db-migrate.sh downgrade -1          # roll back one
#   scripts/db-migrate.sh revision -m "msg"     # create a new revision
#   scripts/db-migrate.sh current               # show current head
#   scripts/db-migrate.sh history               # show revision history
#
# This script picks up DATABASE_URL from the environment. In
# dev it falls back to the value docker-compose.yml prints when
# the backend container starts. The compose-managed service
# (postgres) must be running and healthy.
#
# References: ADR-002 (PostgreSQL 17 + AGE + pgvector).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/backend"

# Load .env if present so DATABASE_URL is inherited.
if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_ROOT/.env"
    set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "[db-migrate] DATABASE_URL not set; using compose default" >&2
    export DATABASE_URL="postgresql://${POSTGRES_USER:-forge}:${POSTGRES_PASSWORD:-forge}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-forge}"
fi

if [[ ! -d alembic ]]; then
    echo "[db-migrate] backend/alembic not present yet (parallel work in progress); nothing to do" >&2
    exit 0
fi

exec alembic "$@"
