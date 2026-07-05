#!/usr/bin/env bash
# scripts/backup-postgres.sh — pg_dump the running Postgres to
# infra/backups/forge-<env>-<UTC>.sql.gz (and optionally mirror to S3).
#
# Usage:
#   scripts/backup-postgres.sh --env=dev [--s3]
#
# Phase 7 SC-7.3 (RPO target <= 24h).
#
# References: PR-7.3 of docs/plan/phase-7-detailed.md.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV=""
MIRROR_S3=0
NOW="$(date -u +'%Y%m%dT%H%M%SZ')"

usage() {
    cat <<EOF
Usage: $0 --env=<dev|staging|prod> [options]

Options:
  --env=NAME       target environment (required)
  --s3             mirror the dump to s3://\$BACKUP_S3_BUCKET/ (env or default)
  -h, --help       show this help
EOF
}

for arg in "$@"; do
    case "$arg" in
        --env=*)  ENV="${arg#*=}" ;;
        --s3)     MIRROR_S3=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown flag: $arg" >&2; usage; exit 2 ;;
    esac
done

[[ -n "$ENV" ]] || { echo "--env is required" >&2; usage; exit 2; }
case "$ENV" in
    dev|staging|prod) ;;
    *) echo "invalid --env=$ENV (expected dev|staging|prod)" >&2; exit 2 ;;
esac

log()  { printf '\033[1;34m[backup:%s]\033[0m %s\n' "$ENV" "$*"; }
fail() { printf '\033[1;31m[backup:%s]\033[0m %s\n' "$ENV" "$*" >&2; exit 1; }

ENV_FILE="infra/env/${ENV}.env"
[[ -f "$ENV_FILE" ]] || fail "missing env file: $ENV_FILE (copy from .env.example)"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

BACKUP_DIR="${REPO_ROOT}/infra/backups"
mkdir -p "$BACKUP_DIR"

OUT_FILE="${BACKUP_DIR}/forge-${ENV}-${NOW}.sql.gz"
log "writing $OUT_FILE"

# Build the connection string pg_dump expects: postgresql://
PG_URL="$(echo "${DATABASE_URL}" | sed -E 's|^postgresql\+asyncpg://|postgresql://|')"
PGHOST="${POSTGRES_HOST:-localhost}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-forge}"
export PGPASSWORD="${POSTGRES_PASSWORD:-forge}"

START=$(date +%s)
pg_dump \
    --host="$PGHOST" \
    --port="$PGPORT" \
    --username="$PGUSER" \
    --dbname="${POSTGRES_DB:-forge}" \
    --no-owner \
    --no-privileges \
    --format=plain \
    --quote-all-identifiers \
    | gzip -9 > "$OUT_FILE"
END=$(date +%s)
SIZE=$(stat -c%s "$OUT_FILE" 2>/dev/null || stat -f%z "$OUT_FILE")
log "  bytes: ${SIZE}  wall-clock: $((END-START))s"

if (( MIRROR_S3 == 1 )); then
    if ! command -v aws >/dev/null 2>&1; then
        fail "aws CLI not on PATH; cannot mirror to S3"
    fi
    S3_BUCKET="${BACKUP_S3_BUCKET:-forge-backups-${ENV}}"
    log "mirroring to s3://${S3_BUCKET}/forge-${ENV}-${NOW}.sql.gz"
    AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-}" \
        aws s3 cp "$OUT_FILE" "s3://${S3_BUCKET}/forge-${ENV}-${NOW}.sql.gz" \
        || fail "s3 upload failed"
fi

log "OK — backup complete"
echo "$OUT_FILE"
