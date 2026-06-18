#!/usr/bin/env bash
# scripts/smoke.sh — the FORA-371 health gate.
#
# Curl /health on the three FORA services, then assert the seeded
# tenant exists in Postgres, Redis is reachable, and the dev S3
# bucket is present in LocalStack. Exits 0 on green, non-zero on
# any failure.
#
# Designed to be re-runnable: every check is independent and
# idempotent. A re-run after a fix should be the same call.
#
# Usage:
#   ./scripts/smoke.sh
#   ./scripts/smoke.sh --verbose    # show the actual responses
#   ./scripts/smoke.sh --json       # machine-readable summary

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERBOSE=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    --verbose|-v) VERBOSE=1 ;;
    --json) JSON=1 ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# Load .env so we know the ports + creds.
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env
  set +a
fi

RUNTIME_PORT="${FORA_RUNTIME_PORT:-4001}"
ORCH_PORT="${FORA_ORCHESTRATOR_PORT:-4000}"
CCB_PORT="${FORA_CCB_LISTEN_PORT:-4003}"
FORGE_PORT="${FORA_FORGE_PORT:-3000}"
PG_URL="${FORA_DATABASE_URL:-postgres://fora:fora@localhost:5432/fora}"
REDIS_URL_LOCAL="${REDIS_URL:-redis://localhost:6379}"
LS_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
LS_REGION="${AWS_REGION:-us-east-1}"
BUCKET="${OBJECT_STORE_BUCKET:-fora-dev-bucket}"
SEED_TENANT="${FORA_SEED_TENANT_ID:-acme-corp}"

# ---------------------------------------------------------------------------
# result accumulator
# ---------------------------------------------------------------------------
PASS=0
FAIL=0
FAILURES=()

run_check() {
  local name="$1" cmd="$2"
  local out
  local rc=0
  out="$(eval "$cmd" 2>&1)" || rc=$?

  if [[ "$rc" -eq 0 ]]; then
    PASS=$((PASS + 1))
    if [[ "$JSON" -eq 0 ]]; then
      printf '  \033[32m✓\033[0m %s\n' "$name"
    fi
    [[ "$VERBOSE" -eq 1 && -n "$out" ]] && printf '    %s\n' "$out"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$name")
    if [[ "$JSON" -eq 0 ]]; then
      printf '  \033[31m✗\033[0m %s\n' "$name"
    fi
    [[ -n "$out" ]] && printf '    %s\n' "$out"
  fi
}

# ---------------------------------------------------------------------------
# health probes
# ---------------------------------------------------------------------------
[[ "$JSON" -eq 0 ]] && echo "[smoke] health probes"

# agent-runtime uses /health; orchestrator and customer-cloud-broker
# use /healthz (matching the Fastify convention they each follow).
run_check "agent-runtime          :$RUNTIME_PORT  GET /health" \
  "[[ -n \"\$(curl -fsS --max-time 5 http://localhost:$RUNTIME_PORT/health 2>/dev/null)\" ]]"

run_check "orchestrator           :$ORCH_PORT  GET /healthz" \
  "[[ -n \"\$(curl -fsS --max-time 5 http://localhost:$ORCH_PORT/healthz 2>/dev/null)\" ]]"

run_check "customer-cloud-broker  :$CCB_PORT  GET /healthz" \
  "[[ -n \"\$(curl -fsS --max-time 5 http://localhost:$CCB_PORT/healthz 2>/dev/null)\" ]]"

# Forge AI console (apps/forge, FORA-374). The /healthz probe proves
# Next.js is alive; the persona probe renders the PM dashboard to text
# to assert the persona routing and orchestrator client are wired up.
run_check "forge (AI console)    :$FORGE_PORT  GET /healthz" \
  "[[ -n \"\$(curl -fsS --max-time 10 http://localhost:$FORGE_PORT/healthz 2>/dev/null)\" ]]"

run_check "forge                 :$FORGE_PORT  GET /personas/pm (PM dashboard)" \
  "[[ -n \"\$(curl -fsS --max-time 15 http://localhost:$FORGE_PORT/personas/pm 2>/dev/null | grep -E 'Product Manager|Active runs')\" ]]"

# ---------------------------------------------------------------------------
# stateful checks
# ---------------------------------------------------------------------------
[[ "$JSON" -eq 0 ]] && echo "[smoke] stateful checks"

# Seeded tenant visible in Postgres. The migrator creates the
# `tenants` table on first run; `scripts/dev-up.sh` does the
# idempotent upsert (ON CONFLICT (slug) DO NOTHING) so this
# query is the green-or-red signal.
run_check "postgres has tenant '$SEED_TENANT'" \
  "docker compose exec -T postgres psql -U ${POSTGRES_USER:-fora} -d ${POSTGRES_DB:-fora} -tAc \"SELECT 1 FROM tenants WHERE slug = '$SEED_TENANT' LIMIT 1\" 2>/dev/null | grep -q '^1$'"

# Redis reachable. We assert on a no-op SET/GET to prove the
# connection is real, not just the docker healthcheck.
run_check "redis reachable ($REDIS_URL_LOCAL)" \
  "docker compose exec -T redis redis-cli SET fora-smoke-probe ok EX 5 NX >/dev/null 2>&1 && docker compose exec -T redis redis-cli GET fora-smoke-probe 2>/dev/null | grep -q ok"

# LocalStack has the dev S3 bucket. Uses the AWS CLI shipped with
# the image (`awslocal`).
run_check "localstack has s3 bucket '$BUCKET'" \
  "docker compose exec -T localstack awslocal s3api head-bucket --bucket '$BUCKET' --region '$LS_REGION' >/dev/null 2>&1"

# ---------------------------------------------------------------------------
# summary
# ---------------------------------------------------------------------------
TOTAL=$((PASS + FAIL))
if [[ "$JSON" -eq 1 ]]; then
  printf '{"pass":%d,"fail":%d,"total":%d,"failures":%s}\n' \
    "$PASS" "$FAIL" "$TOTAL" "$(printf '%s\n' "${FAILURES[@]:-}" | jq -R . | jq -s .)"
else
  echo
  if [[ "$FAIL" -eq 0 ]]; then
    printf '\033[32m[smoke] OK\033[0m  %d/%d checks passed\n' "$PASS" "$TOTAL"
  else
    printf '\033[31m[smoke] FAIL\033[0m  %d/%d checks failed: %s\n' \
      "$FAIL" "$TOTAL" "${FAILURES[*]}"
  fi
fi

[[ "$FAIL" -eq 0 ]]
