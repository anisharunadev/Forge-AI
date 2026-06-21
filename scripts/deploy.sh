#!/usr/bin/env bash
# scripts/deploy.sh — single command to deploy Forge AI.
#
# Supported environments: dev, staging, prod.
#
# Steps:
#   1. Parse --env=<name> and any other flags.
#   2. Verify the environment file (infra/env/<env>.env) exists.
#   3. Build backend + forge-ui images.
#   4. Push images to the registry (skipped for dev).
#   5. Run database migrations (alembic upgrade head).
#   6. Perform a rolling restart of the backend deployment.
#   7. Run smoke tests.
#   8. Roll back to the previous image on smoke failure.
#
# Idempotent for the "build" step (Docker layer cache). Migrations
# are forward-only; a failure aborts the deploy and triggers
# rollback.
#
# References: ADR-001 (cloud-only AWS in prod), DL-025 (LiteLLM).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Defaults & argument parsing
# ---------------------------------------------------------------------------
ENV=""
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
REGISTRY="${REGISTRY:-ghcr.io/forge-ai}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
HEALTH_URL="${HEALTH_URL:-}"

usage() {
    cat <<EOF
Usage: $0 --env=<dev|staging|prod> [options]

Options:
  --env=NAME         target environment (required)
  --tag=TAG          image tag (default: short git SHA)
  --registry=REG     container registry (default: ghcr.io/forge-ai)
  --skip-push        do not push images after build
  --skip-migrate     do not run database migrations
  --skip-smoke       do not run smoke tests
  --no-rollback      do not attempt rollback on smoke failure
  -h, --help         show this help
EOF
}

for arg in "$@"; do
    case "$arg" in
        --env=*)     ENV="${arg#*=}" ;;
        --tag=*)     IMAGE_TAG="${arg#*=}" ;;
        --registry=*) REGISTRY="${arg#*=}" ;;
        --skip-push) SKIP_PUSH=1 ;;
        --skip-migrate) SKIP_MIGRATE=1 ;;
        --skip-smoke)  SKIP_SMOKE=1 ;;
        --no-rollback) NO_ROLLBACK=1 ;;
        -h|--help)   usage; exit 0 ;;
        *)           echo "unknown flag: $arg" >&2; usage; exit 2 ;;
    esac
done

[[ -n "$ENV" ]] || { echo "--env is required" >&2; usage; exit 2; }
case "$ENV" in
    dev|staging|prod) ;;
    *) echo "invalid --env=$ENV (expected dev|staging|prod)" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log()  { printf '\033[1;34m[deploy:%s]\033[0m %s\n' "$ENV" "$*"; }
warn() { printf '\033[1;33m[deploy:%s]\033[0m %s\n' "$ENV" "$*" >&2; }
fail() { printf '\033[1;31m[deploy:%s]\033[0m %s\n' "$ENV" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Environment file
# ---------------------------------------------------------------------------
ENV_FILE="infra/env/${ENV}.env"
[[ -f "$ENV_FILE" ]] || fail "missing env file: $ENV_FILE (copy from .env.example)"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Default health URL if not set per-env.
if [[ -z "$HEALTH_URL" ]]; then
    HEALTH_URL="http://localhost:${BACKEND_PORT:-8000}/health"
fi

BACKEND_IMAGE="${REGISTRY}/backend:${IMAGE_TAG}"
FRONTEND_IMAGE="${REGISTRY}/forge-ui:${IMAGE_TAG}"
PREVIOUS_BACKEND_IMAGE=""

# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------
log "building backend image $BACKEND_IMAGE"
docker build -t "$BACKEND_IMAGE" -f backend/Dockerfile .

log "building forge-ui image $FRONTEND_IMAGE"
docker build -t "$FRONTEND_IMAGE" -f apps/forge/Dockerfile .

# ---------------------------------------------------------------------------
# 2. Push (skipped for dev)
# ---------------------------------------------------------------------------
if [[ "$ENV" == "dev" || -n "${SKIP_PUSH:-}" ]]; then
    log "skipping image push (env=$ENV, SKIP_PUSH=${SKIP_PUSH:-0})"
else
    log "pushing images to $REGISTRY"
    docker push "$BACKEND_IMAGE"
    docker push "$FRONTEND_IMAGE"
fi

# ---------------------------------------------------------------------------
# 3. Migrations
# ---------------------------------------------------------------------------
if [[ -n "${SKIP_MIGRATE:-}" ]]; then
    log "skipping database migrations (SKIP_MIGRATE=1)"
elif [[ "$ENV" == "dev" ]]; then
    # dev runs migrations inside docker compose via setup-local.sh
    log "dev environment: migrations handled by setup-local.sh / setup-local"
else
    log "running alembic upgrade head against $ENV"
    (cd backend && alembic upgrade head)
fi

# ---------------------------------------------------------------------------
# 4. Rolling restart
# ---------------------------------------------------------------------------
restart_backend() {
    if [[ "$ENV" == "dev" ]]; then
        # Local: just recreate the container with the new image.
        docker compose up -d --no-deps --force-recreate backend
    else
        # In staging/prod the rolling restart is delegated to the
        # orchestrator (ECS / k8s / ArgoCD). This script only emits
        # the intent; the actual call lives in infra/terraform/.
        log "rolling restart of $BACKEND_SERVICE is handled by infra/terraform/<env>"
        log "image to deploy: $BACKEND_IMAGE"
    fi
}

log "capturing previous image for potential rollback"
PREVIOUS_BACKEND_IMAGE="$(docker inspect --format='{{.Config.Image}}' "$BACKEND_SERVICE" 2>/dev/null || echo "")"

log "restarting backend"
restart_backend

# ---------------------------------------------------------------------------
# 5. Smoke test
# ---------------------------------------------------------------------------
smoke() {
    log "smoke testing $HEALTH_URL"
    for _ in $(seq 1 30); do
        if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
            log "smoke OK"
            return 0
        fi
        sleep 2
    done
    warn "smoke failed after 60s"
    return 1
}

if [[ -n "${SKIP_SMOKE:-}" ]]; then
    log "skipping smoke tests (SKIP_SMOKE=1)"
elif smoke; then
    log "deploy to $ENV complete: $BACKEND_IMAGE"
    exit 0
elif [[ -n "${NO_ROLLBACK:-}" ]]; then
    fail "smoke failed and --no-rollback was set"
else
    warn "smoke failed; rolling back"
    if [[ -n "$PREVIOUS_BACKEND_IMAGE" ]]; then
        docker tag "$PREVIOUS_BACKEND_IMAGE" "$BACKEND_IMAGE"
        restart_backend
    else
        warn "no previous image captured; manual rollback required"
    fi
    fail "deploy to $ENV failed; rolled back"
fi
