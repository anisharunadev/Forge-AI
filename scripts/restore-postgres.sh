#!/usr/bin/env bash
# scripts/restore-postgres.sh — drop + recreate the target DB and load
# a backup file (or s3 object) into it, then run alembic upgrade head
# and confirm /healthz reports ok.
#
# Usage:
#   scripts/restore-postgres.sh --env=dev --file=infra/backups/forge-dev-20260101T000000Z.sql.gz
#   scripts/restore-postgres.sh --env=dev --s3-key=forge-dev-20260101T000000Z.sql.gz
#
# Phase 7 SC-7.3 (RTO target <= 4h).
#
# References: PR-7.3 of docs/plan/phase-7-detailed.md.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV=""
FILE=""
S3_KEY=""

usage() {
    cat <<EOF
Usage: $0 --env=NAME (--file=PATH | --s3-key=KEY)

Options:
  --env=NAME       target environment (required)
  --file=PATH      local backup file (gzip-compressed pg_dump)
  --s3-key=KEY     S3 key inside \$BACKUP_S3_BUCKET
  -h, --help       show this help
EOF
}

for arg in "$@"; do
    case "$arg" in
        --env=*)    ENV="${arg#*=}" ;;
        --file=*)   FILE="${arg#*=}" ;;
        --s3-key=*) S3_KEY="${arg#*=}" ;;
        -h|--help)  usage; exit 0 ;;
        *) echo "unknown flag: $arg" >&2; usage; exit 2 ;;
    esac
done

[[ -n "$ENV" ]] || { echo "--env is required" >&2; usage; exit 2; }
case "$ENV" in
    dev|staging|prod) ;;
    *) echo "invalid --env=$ENV" >&2; exit 2 ;;
esac
[[ -n "$FILE" || -n "$S3_KEY" ]] || { echo "either --file or --s3-key is required" >&2; usage; exit 2; }

log()  { printf '\033[1;34m[restore:%s]\033[0m %s\n' "$ENV" "$*"; }
fail() { printf '\033[1;31m[restore:%s]\033[0m %s\n' "$ENV" "$*" >&2; exit 1; }

ENV_FILE="infra/env/${ENV}.env"
[[ -f "$ENV_FILE" ]] || fail "missing env file: $ENV_FILE"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

WORK_FILE=""
if [[ -n "$S3_KEY" ]]; then
    WORK_FILE="/tmp/${S3_KEY##*/}"
    S3_BUCKET="${BACKUP_S3_BUCKET:-forge-backups-${ENV}}"
    log "downloading s3://${S3_BUCKET}/${S3_KEY} -> ${WORK_FILE}"
    AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-}" \
        aws s3 cp "s3://${S3_BUCKET}/${S3_KEY}" "$WORK_FILE" || fail "s3 download failed"
else
    WORK_FILE="$FILE"
    [[ -f "$WORK_FILE" ]] || fail "file not found: $WORK_FILE"
fi
log "using $WORK_FILE ($(stat -c%s "$WORK_FILE") bytes)"

export PGPASSWORD="${POSTGRES_PASSWORD:-forge}"
PGHOST="${POSTGRES_HOST:-localhost}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-forge}"
ADMIN_USER="${POSTGRES_ADMIN_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-forge}"

ADMIN_URL="postgresql://${ADMIN_USER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/postgres"
TARGET_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}"

log "dropping + recreating database: ${DB_NAME}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
    -c "DROP DATABASE IF EXISTS ${DB_NAME};" \
    -c "CREATE DATABASE ${DB_NAME} OWNER ${PGUSER};" \
    || fail "DB recreate failed"

log "loading dump into ${DB_NAME}"
gunzip -c "$WORK_FILE" | psql "$TARGET_URL" -v ON_ERROR_STOP=1 \
    || fail "dump load failed"

if [[ -d backend/alembic ]]; then
    log "running alembic upgrade head"
    (cd backend && DATABASE_URL="${DATABASE_URL}" alembic upgrade head) \
        || fail "alembic upgrade failed"
else
    log "backend/alembic not present; skipping alembic"
fi

log "waiting for backend /healthz to return ok"
HEALTHZ_URL="http://localhost:${BACKEND_PORT:-8000}/healthz"
HEALTHZ_OK=0
DEADLINE=$(($(date +%s) + 120))
while [[ "$(date +%s)" -lt "$DEADLINE" ]]; do
    if curl -fsS --max-time 5 "$HEALTHZ_URL" 2>/dev/null | grep -q '"status":"ok"'; then
        HEALTHZ_OK=1
        break
    fi
    sleep 2
done
(( HEALTHZ_OK == 1 )) || fail "/healthz did not return ok within 120s"

log "OK — restore complete and backend healthy"
[[ -n "$S3_KEY" ]] && rm -f "$WORK_FILE"
