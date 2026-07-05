#!/usr/bin/env bash
# scripts/setup-local.sh — single command to set up Forge AI local dev.
#
# This is the entry point documented in the v2.0 README. It is
# idempotent: running it twice is a no-op the second time.
#
# Steps:
#   1. Verify prerequisites (docker, docker compose, python3.13, pnpm, node).
#   2. Copy .env.example to .env if missing.
#   3. Pull all docker images declared in docker-compose.yml.
#   4. Bring the stack up (postgres, redis, keycloak, litellm, floci,
#      backend, forge-ui).
#   5. Wait for postgres + keycloak to report healthy.
#   6. Run database migrations (alembic upgrade head).
#   7. PR-7.1: Run python -m seeds (idempotent demo tenants).
#   8. Install backend Python deps (pip install -r backend/requirements.txt).
#   9. Install frontend deps (pnpm install --filter @forge/forge).
#  10. PR-7.1: Poll /healthz until all 4 named probes are ok.
#  11. PR-7.1: Write timing report to docs/plan/phase-7-fresh-machine-time.md.
#  12. Print the developer URLs.
#
# Re-runnable. Exits non-zero on the first failed step.
#
# References: ADR-001 (cloud-only AWS in prod, floci in dev),
#             ADR-002 (PostgreSQL 17 + AGE + pgvector), DL-025.
#             SC-7.1 (setup ≤ 15 min wall-clock), SC-7.5 (/healthz).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# PR-7.1: timing harness (writes per-step seconds into a tmpfile,
# the final report is assembled at the very end).
# ---------------------------------------------------------------------------
TIMING_REPORT="${REPO_ROOT}/docs/plan/phase-7-fresh-machine-time.md"
mkdir -p "$(dirname "$TIMING_REPORT")"
TIMING_LOG="$(mktemp)"
TIMING_TOTAL_START=$(date +%s)
TIMING_TOTAL=0
HEALTHZ_OK=0

# PR-7.1: per-step timer.
step_start() {
    STEP_NAME="$1"
    STEP_START=$(date +%s)
}

step_end() {
    local now elapsed
    now=$(date +%s)
    elapsed=$(( now - STEP_START ))
    printf '%s|%s\n' "$STEP_NAME" "$elapsed" >> "$TIMING_LOG"
    log "$STEP_NAME: ${elapsed}s"
}

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[setup]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------
step_start "prerequisites"
log "checking prerequisites"

need() {
    local cmd="$1"
    local hint="${2:-}"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        fail "missing required command: $cmd${hint:+ ($hint)}"
    fi
}

need docker "install Docker Desktop or docker-ce"
need node  "install Node.js 20+"
need pnpm  "install pnpm 9+: npm i -g pnpm"
need python3 "install Python 3.13"

# `docker compose` (v2 plugin) is required; the legacy `docker-compose`
# v1 binary is not supported by our compose files.
if ! docker compose version >/dev/null 2>&1; then
    fail "docker compose v2 plugin not found. Install the 'docker-compose-plugin'."
fi

python_version="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
case "$python_version" in
    3.13|3.14) ;;
    *) fail "Python 3.13+ required, found $python_version" ;;
esac
step_end

# ---------------------------------------------------------------------------
# 2. .env bootstrap
# ---------------------------------------------------------------------------
step_start "env-bootstrap"
if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
        log "creating .env from .env.example"
        cp .env.example .env
        warn "edit .env and set LITELLM_MASTER_KEY, KEYCLOAK_ADMIN_PASSWORD, etc."
    else
        fail ".env.example not found; cannot bootstrap .env"
    fi
else
    log ".env already present; leaving untouched"
fi

# Export .env into the current shell so subsequent docker / pip
# commands inherit the same values the backend container will see.
set -a
# shellcheck disable=SC1091
source .env
set +a
step_end

# ---------------------------------------------------------------------------
# 3. Pull images
# ---------------------------------------------------------------------------
step_start "docker-pull"
log "pulling docker images (this can take a few minutes on a cold cache)"
docker compose pull
step_end

# ---------------------------------------------------------------------------
# 4. Bring the stack up
# ---------------------------------------------------------------------------
step_start "docker-up"
log "starting forge-dev stack"
docker compose up -d --remove-orphans
step_end

# ---------------------------------------------------------------------------
# 5. Wait for critical services
# ---------------------------------------------------------------------------
step_start "wait-postgres"
log "waiting for postgres to become healthy"
for _ in $(seq 1 60); do
    if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-forge}" -d "${POSTGRES_DB:-forge}" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-forge}" -d "${POSTGRES_DB:-forge}" >/dev/null \
    || fail "postgres did not become healthy within 120s"
step_end

step_start "wait-keycloak"
log "waiting for keycloak to become healthy"
for _ in $(seq 1 60); do
    if docker compose exec -T keycloak bash -c 'exec 3<>/dev/tcp/localhost/8080 && echo -e "GET /health/ready HTTP/1.1\r\nHost: localhost\r\n\r\n" >&3 && grep -q "200 OK" <&3' >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
step_end

step_start "wait-floci"
log "waiting for floci (local AWS emulator) to become healthy"
for _ in $(seq 1 60); do
    if docker compose exec -T floci curl -fsS http://localhost:4566/_localstack/health > /dev/null 2>&1; then
        break
    fi
    sleep 2
done
docker compose exec -T floci curl -fsS http://localhost:4566/_localstack/health > /dev/null 2>&1 \
    || warn "floci did not report healthy within 120s; S3 buckets may not be ready"
step_end

step_start "wait-docs-site"
log "waiting for docs-site (Astro + Starlight) to respond"
for _ in $(seq 1 30); do
    if docker compose exec -T docs-site wget -q --spider http://localhost:4321/ > /dev/null 2>&1; then
        break
    fi
    sleep 2
done
docker compose exec -T docs-site wget -q --spider http://localhost:4321/ > /dev/null 2>&1 \
    || warn "docs-site did not respond within 60s; check 'docker compose logs docs-site'"
step_end

# ---------------------------------------------------------------------------
# 6. Database migrations
# ---------------------------------------------------------------------------
step_start "alembic-upgrade"
log "running alembic migrations"
if [[ -d backend/alembic ]]; then
    (cd backend && DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER:-forge}:${POSTGRES_PASSWORD:-forge}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-forge}}" alembic upgrade head)
else
    warn "backend/alembic not present yet (parallel work in progress); skipping migrations"
fi
step_end

# ---------------------------------------------------------------------------
# 7. PR-7.1: python -m seeds — idempotent demo tenants.
# ---------------------------------------------------------------------------
step_start "seeds"
log "running python -m seeds"
if [[ -d backend/seeds ]]; then
    (cd backend && python -m seeds) || warn "seeds reported an error; continuing"
else
    warn "backend/seeds not present yet; skipping"
fi
step_end

# ---------------------------------------------------------------------------
# 8. Backend Python deps
# ---------------------------------------------------------------------------
step_start "pip-install"
log "installing backend python dependencies"
if [[ -f backend/requirements.txt ]]; then
    python3 -m pip install --quiet -r backend/requirements.txt
else
    warn "backend/requirements.txt missing; skipping pip install"
fi
step_end

# ---------------------------------------------------------------------------
# 9. Frontend deps
# ---------------------------------------------------------------------------
step_start "pnpm-install"
log "installing forge-ui node dependencies"
if [[ -d apps/forge ]]; then
    pnpm install --filter @forge/forge... --prefer-offline
else
    warn "apps/forge not present yet; skipping pnpm install"
fi
step_end

# ---------------------------------------------------------------------------
# 10. PR-7.1: /healthz poll until green (the four named deps + 503 surface).
# ---------------------------------------------------------------------------
step_start "healthz-poll"
log "polling /healthz until all 4 components report ok"
HEALTHZ_URL="http://localhost:${BACKEND_PORT:-8000}/healthz"
HEALTHZ_DEADLINE=$(($(date +%s) + 120))
while [[ "$(date +%s)" -lt "$HEALTHZ_DEADLINE" ]]; do
    body="$(curl -fsS --max-time 5 "$HEALTHZ_URL" 2>/dev/null || true)"
    if [[ -n "$body" ]] && echo "$body" | grep -q '"status":"ok"'; then
        HEALTHZ_OK=1
        log "/healthz reports status=ok"
        break
    fi
    sleep 2
done
if (( HEALTHZ_OK == 0 )); then
    warn "/healthz did not return status=ok within 120s; inspect 'docker compose logs backend'"
fi
step_end

# ---------------------------------------------------------------------------
# 11. PR-7.1: timing report.
# ---------------------------------------------------------------------------
TIMING_TOTAL=$(($(date +%s) - TIMING_TOTAL_START))
{
    echo "# Phase 7 — Fresh-machine setup timing (PR-7.1)"
    echo
    echo "Captured: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    echo "Host: $(uname -a)"
    echo "Docker: $(docker --version 2>/dev/null || echo 'unknown')"
    echo
    echo "## Total wall-clock"
    echo
    echo "**${TIMING_TOTAL}s** (target: \u2264 900s = 15 min)"
    if (( TIMING_TOTAL > 900 )); then
        echo
        echo "> FAIL: SC-7.1 not met. Profile the slowest step below."
    else
        echo
        echo "> SC-7.1 met."
    fi
    echo
    echo "## Per-step breakdown"
    echo
    echo "| Step | seconds |"
    echo "|------|--------:|"
    while IFS='|' read -r name secs; do
        printf '| `%s` | %s |\n' "$name" "$secs"
    done < "$TIMING_LOG"
    echo
    echo "## /healthz status"
    echo
    if (( HEALTHZ_OK == 1 )); then
        echo "Final poll: status=ok."
    else
        echo "Final poll: NOT ok within 120s. Inspect 'docker compose logs backend'."
    fi
} > "$TIMING_REPORT"
rm -f "$TIMING_LOG"
log "timing report: $TIMING_REPORT"

# ---------------------------------------------------------------------------
# 12. Done
# ---------------------------------------------------------------------------
cat <<EOF

[setup] Forge AI local dev is ready in ${TIMING_TOTAL}s.

  Backend (FastAPI):    http://localhost:${BACKEND_PORT:-8000}
  /healthz:             ${HEALTHZ_URL}
  Frontend (Next.js):   http://localhost:${FORGE_UI_PORT:-3000}
  Docs (Astro/Starlight): http://localhost:${DOCS_SITE_PORT:-4321}
  Postgres:             localhost:${POSTGRES_PORT:-5432}  (user: ${POSTGRES_USER:-forge})
  Redis:                localhost:${REDIS_PORT:-6379}
  Keycloak admin:       http://localhost:${KEYCLOAK_PORT:-8080}  (${KEYCLOAK_ADMIN:-admin} / ${KEYCLOAK_ADMIN_PASSWORD:-admin})
  Keycloak realm:       http://localhost:${KEYCLOAK_PORT:-8080}/realms/forge
  LiteLLM Proxy:        http://localhost:${LITELLM_PORT:-4000}
  floci (local AWS):    http://localhost:${FLOCI_PORT:-4566}  (S3, SQS, SNS, Lambda, RDS, ...)

Timing report: ${TIMING_REPORT}

Next:
  docker compose logs -f backend    # tail backend
  docker compose down               # stop (preserves volumes)

EOF

if (( HEALTHZ_OK == 0 )); then
    exit 1
fi
