#!/usr/bin/env bash
# scripts/dev-up.sh — single entry point for the local dev stack.
#
# FORA-371. The Board runbook is: clone, edit .env, run this script.
#
# Steps:
#   1. Validate .env exists (copy from .env.example if missing).
#   2. docker compose up -d (postgres, redis, localstack).
#   3. Wait for the three infra services to report healthy.
#   4. pnpm install --no-frozen-lockfile (idempotent on warm cache).
#   5. pnpm -r build (one-time; subsequent runs use cached dist/).
#   6. pnpm -r migrate (applies all DB migrations; idempotent).
#   7. Start the three app services in the background (logs → .fora/logs/).
#   8. Print app URLs.
#   9. Run scripts/smoke.sh.
#
# Idempotency:
#   - docker compose up -d: no-op if already running.
#   - pnpm install: skips when node_modules is current.
#   - pnpm -r build: incremental.
#   - pnpm -r migrate: no-op on a fully-migrated DB.
#   - app starts: re-uses the existing PID if it's still alive.
#
# Usage:
#   ./scripts/dev-up.sh            # full boot + smoke
#   ./scripts/dev-up.sh --no-smoke # boot, skip smoke (for fast iteration)
#   ./scripts/dev-up.sh --down     # docker compose down (named volumes preserved)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="$REPO_ROOT/.fora/logs"
PID_DIR="$REPO_ROOT/.fora/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
RUN_SMOKE=1
DOWN_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-smoke) RUN_SMOKE=0; shift ;;
    --down) DOWN_ONLY=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 0. teardown helper
# ---------------------------------------------------------------------------
teardown() {
  echo "[dev-up] docker compose down (volumes preserved)"
  docker compose down --remove-orphans
  exit 0
}
[[ "$DOWN_ONLY" -eq 1 ]] && teardown

# ---------------------------------------------------------------------------
# 1. .env check
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  echo "[dev-up] no .env found — copying from .env.example"
  cp .env.example .env
  echo "[dev-up] edit .env to set ANTHROPIC_API_KEY, then re-run"
  echo "[dev-up] (continuing with placeholder so the infra still boots)"
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

# Reject the placeholder API key — apps will still boot (the dev
# quickstart uses Haiku 4.5 and the placeholder is a syntactically
# valid string) but any real LLM call will 401.
if [[ "${ANTHROPIC_API_KEY:-}" == "sk-ant-replace-me" ]]; then
  echo "[dev-up] WARNING: ANTHROPIC_API_KEY is the .env.example placeholder."
  echo "[dev-up] The stack will boot, but Claude-backed agents will fail."
fi

# ---------------------------------------------------------------------------
# 2. compose up
# ---------------------------------------------------------------------------
echo "[dev-up] docker compose up -d"
docker compose up -d --remove-orphans

# ---------------------------------------------------------------------------
# 3. wait for healthy
# ---------------------------------------------------------------------------
echo "[dev-up] waiting for postgres…"
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null

echo "[dev-up] waiting for redis…"
for _ in $(seq 1 60); do
  if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    break
  fi
  sleep 1
done
docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG

echo "[dev-up] waiting for localstack…"
for _ in $(seq 1 90); do
  if docker compose exec -T localstack awslocal s3 ls >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker compose exec -T localstack awslocal s3 ls >/dev/null

# ---------------------------------------------------------------------------
# 4. pnpm install
# ---------------------------------------------------------------------------
echo "[dev-up] pnpm install --no-frozen-lockfile"
pnpm install --no-frozen-lockfile >"$LOG_DIR/pnpm-install.log" 2>&1

# ---------------------------------------------------------------------------
# 5. pnpm -r build
# ---------------------------------------------------------------------------
echo "[dev-up] pnpm -r build"
pnpm -r build >"$LOG_DIR/pnpm-build.log" 2>&1 || {
  echo "[dev-up] build failed — see $LOG_DIR/pnpm-build.log"
  tail -30 "$LOG_DIR/pnpm-build.log"
  exit 1
}

# ---------------------------------------------------------------------------
# 6. pnpm -r migrate (the db-migrator package owns this script)
# ---------------------------------------------------------------------------
echo "[dev-up] pnpm -r migrate"
# `pnpm -r migrate` runs the migrate script in every workspace
# package; only @fora/db-migrator defines one today, so this is
# effectively a single call but it scales as we add more data
# packages (e.g. the upcoming event-bus-schema package).
pnpm -r migrate >"$LOG_DIR/migrate.log" 2>&1 || {
  echo "[dev-up] migrate failed — see $LOG_DIR/migrate.log"
  tail -30 "$LOG_DIR/migrate.log"
  exit 1
}

# ---------------------------------------------------------------------------
# 6b. seed the demo tenant. The migrator runner applies the model
# registry, not the `migrations/*.sql` files; the demo seed is a
# plain SQL upsert so the smoke test can assert on a known row.
# Idempotent: ON CONFLICT DO NOTHING, so a re-run is a no-op.
# ---------------------------------------------------------------------------
SEED_TENANT_ID="${FORA_SEED_TENANT_ID:-acme-corp}"
SEED_TENANT_NAME="${FORA_SEED_TENANT_NAME:-Acme Corp (Dev Demo)}"
SEED_TENANT_UUID="00000000-0000-0000-0000-000000000ace"

echo "[dev-up] seeding demo tenant '$SEED_TENANT_ID'"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL >"$LOG_DIR/seed.log" 2>&1
INSERT INTO tenants (id, tenant_id, slug, name)
VALUES ('$SEED_TENANT_UUID', '$SEED_TENANT_UUID', '$SEED_TENANT_ID', '$SEED_TENANT_NAME')
ON CONFLICT (slug) DO NOTHING;
SQL

# ---------------------------------------------------------------------------
# 7. start the three app services in the background
# ---------------------------------------------------------------------------
start_app() {
  local name="$1" cmd="$2" port="$3"
  local pidfile="$PID_DIR/${name}.pid"
  local logfile="$LOG_DIR/${name}.log"

  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "[dev-up] $name already running (pid=$(cat "$pidfile"))"
    return 0
  fi

  echo "[dev-up] starting $name on :$port"
  (
    # shellcheck disable=SC2086
    bash -c "$cmd" >>"$logfile" 2>&1 &
    echo $! >"$pidfile"
  )
  # Brief settle so the smoke test doesn't race the bind.
  sleep 1
}

start_app "agent-runtime" \
  "pnpm --filter @fora/agent-runtime dev" \
  "${FORA_RUNTIME_PORT:-4001}"

start_app "orchestrator" \
  "pnpm --filter @fora/orchestrator dev" \
  "${FORA_ORCHESTRATOR_PORT:-4000}"

start_app "customer-cloud-broker" \
  "pnpm --filter @fora/customer-cloud-broker dev" \
  "${FORA_CCB_LISTEN_PORT:-4003}"

# Forge AI console (apps/forge, FORA-374). Next.js 15 dev server;
# the smoke gate asserts :3000 /healthz once it has had time to bind.
start_app "forge" \
  "pnpm --filter @fora/forge dev" \
  "${FORA_FORGE_PORT:-3000}"

# Next.js dev does its first compile on the first HTTP request, not on
# bind. Wait until /healthz is actually responsive before the smoke
# gate runs so the forge probe isn't racing a cold compile.
FORGE_PORT="${FORA_FORGE_PORT:-3000}"
echo "[dev-up] waiting for forge :$FORGE_PORT (next.js first compile)…"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 "http://localhost:$FORGE_PORT/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# 8. print URLs
# ---------------------------------------------------------------------------
cat <<EOF

============================================================
FORA dev stack is up
------------------------------------------------------------
  Postgres     localhost:${POSTGRES_PORT:-5432}    (container: fora-postgres)
  Redis        localhost:${REDIS_PORT:-6379}        (container: fora-redis)
  LocalStack   localhost:${LOCALSTACK_PORT:-4566}    (container: fora-localstack)
------------------------------------------------------------
  agent-runtime          :${FORA_RUNTIME_PORT:-4001}  http://localhost:${FORA_RUNTIME_PORT:-4001}/health
  orchestrator           :${FORA_ORCHESTRATOR_PORT:-4000}  http://localhost:${FORA_ORCHESTRATOR_PORT:-4000}/healthz
  customer-cloud-broker  :${FORA_CCB_LISTEN_PORT:-4003}  http://localhost:${FORA_CCB_LISTEN_PORT:-4003}/healthz
  forge (AI console)     :${FORA_FORGE_PORT:-3000}  http://localhost:${FORA_FORGE_PORT:-3000}/healthz
------------------------------------------------------------
  Logs: $LOG_DIR
  Pids: $PID_DIR
  Teardown: ./scripts/dev-up.sh --down
============================================================

EOF

# ---------------------------------------------------------------------------
# 9. smoke test
# ---------------------------------------------------------------------------
if [[ "$RUN_SMOKE" -eq 1 ]]; then
  echo "[dev-up] running smoke test"
  if ./scripts/smoke.sh; then
    echo "[dev-up] OK — smoke green"
  else
    echo "[dev-up] FAIL — smoke red; tail app logs:"
    for f in "$LOG_DIR"/*.log; do
      echo "--- $f ---"
      tail -20 "$f"
    done
    exit 1
  fi
fi
