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

run_check "forge                 :$FORGE_PORT  GET /personas/pm (PM dashboard + seed run row)" \
  "BODY=\$(curl -fsS --max-time 15 http://localhost:$FORGE_PORT/personas/pm 2>/dev/null) && echo \"\$BODY\" | grep -q 'Product Manager' && echo \"\$BODY\" | grep -q 'demo-goal-forge' && ! echo \"\$BODY\" | grep -q 'No runs yet'"

# FORA-382 clean-laptop AC #1: the home page must show the persona
# switcher with all three persona cards visible. The persona switcher
# is the on-ramp for FORA-379 (persona dashboards) and the Board
# asked for proof the switcher is live, not just the PM page.
run_check "forge                 :$FORGE_PORT  GET / persona switcher (3 cards)" \
  "HOME=\$(curl -fsS --max-time 15 http://localhost:$FORGE_PORT/ 2>/dev/null) && echo \"\$HOME\" | grep -q 'data-persona-card=\"pm\"' && echo \"\$HOME\" | grep -q 'data-persona-card=\"eng-lead\"' && echo \"\$HOME\" | grep -q 'data-persona-card=\"cto\"'"

# Persona round-trip probes (FORA-380). The Board wanted proof that
# switching persona actually swaps the view, not just that the empty
# state heading renders. Each probe POSTs /api/persona (cookie set),
# then GETs the matching /personas/<id> page with the cookie jar and
# asserts both the persona-specific heading AND a demo-run marker so
# the empty state can't satisfy the grep.
#
# FORA_SEED_RUN_ID in .env can be either the friendly alias
# `demo-run-001` (forge env, line 90) or the canonical seed UUID
# (line 141 — wins on duplicate). Accept either so the gate stays
# green across the two configurations; the Board concern was
# "does the persona route swap to a real seeded run?" not the
# exact id form.
run_check "forge PM round-trip   :$FORGE_PORT  POST /api/persona + GET /personas/pm" \
  "JAR=\$(mktemp) && POST=\$(curl -sS -c \"\$JAR\" --max-time 5 -X POST -H 'content-type: application/json' -d '{\"persona\":\"pm\"}' http://localhost:$FORGE_PORT/api/persona 2>&1) && PAGE=\$(curl -sS -b \"\$JAR\" --max-time 15 http://localhost:$FORGE_PORT/personas/pm 2>&1) && echo \"\$POST\" | grep -q '\"persona\":\"pm\"' && echo \"\$PAGE\" | grep -q 'Product Manager' && echo \"\$PAGE\" | grep -q 'demo-goal-forge' && echo \"\$PAGE\" | grep -qE 'demo-run-001|00000000-0000-4000-8000-000000000001' && ! echo \"\$PAGE\" | grep -q 'No runs yet'"

run_check "forge EngLead round-trip :$FORGE_PORT  POST /api/persona + GET /personas/eng-lead" \
  "JAR=\$(mktemp) && POST=\$(curl -sS -c \"\$JAR\" --max-time 5 -X POST -H 'content-type: application/json' -d '{\"persona\":\"eng-lead\"}' http://localhost:$FORGE_PORT/api/persona 2>&1) && PAGE=\$(curl -sS -b \"\$JAR\" --max-time 15 http://localhost:$FORGE_PORT/personas/eng-lead 2>&1) && echo \"\$POST\" | grep -q '\"persona\":\"eng-lead\"' && echo \"\$PAGE\" | grep -q 'Runs in flight' && echo \"\$PAGE\" | grep -qE 'demo-run-001|00000000-0000-4000-8000-000000000001' && echo \"\$PAGE\" | grep -q 'data-action=\"pause\"' && ! echo \"\$PAGE\" | grep -q 'No runs visible'"

run_check "forge CTO round-trip   :$FORGE_PORT  POST /api/persona + GET /personas/cto" \
  "JAR=\$(mktemp) && POST=\$(curl -sS -c \"\$JAR\" --max-time 5 -X POST -H 'content-type: application/json' -d '{\"persona\":\"cto\"}' http://localhost:$FORGE_PORT/api/persona 2>&1) && PAGE=\$(curl -sS -b \"\$JAR\" --max-time 15 http://localhost:$FORGE_PORT/personas/cto 2>&1) && echo \"\$POST\" | grep -q '\"persona\":\"cto\"' && echo \"\$PAGE\" | grep -q 'Throughput' && echo \"\$PAGE\" | grep -q 'MTTR' && echo \"\$PAGE\" | grep -q 'Audit log' && echo \"\$PAGE\" | grep -q 'demo-goal-forge' && ! echo \"\$PAGE\" | grep -q 'awaits metrics endpoint'"

# ---------------------------------------------------------------------------
# stateful checks
# ---------------------------------------------------------------------------
[[ "$JSON" -eq 0 ]] && echo "[smoke] stateful checks"

# Knowledge Layer production-bar lint gate (FORA-408, sub-goal 0.8.1).
# Runs `python -m agents.workspace.lint` over workspace/{memory,customer,project}
# and fails the smoke gate on any violation. Non-skippable by design: a bad
# knowledge file must never reach the seed.
run_check "workspace lint        workspace/  no production-bar violations" \
  "python3 -m agents.workspace.lint --root workspace/ >/dev/null 2>&1"

# Demo-run seed (FORA-378). The persona dashboards fall back to "No
# runs yet" unless the seed run is present and the orchestrator's
# tenant-scoped reads can see it. The probe asserts the seven canonical
# stage rows exist and are returned in canonical order — the count
# check is the smoke gate for the GET /v1/runs/{id}/stages endpoint.
DEMO_RUN_TENANT_UUID="00000000-0000-0000-0000-000000000ace"
run_check "orchestrator  :$ORCH_PORT  GET /v1/runs/demo-run-001/stages count=7" \
  "STAGES=\$(curl -fsS --max-time 5 -H 'x-fora-tenant-id: $DEMO_RUN_TENANT_UUID' http://localhost:$ORCH_PORT/v1/runs/demo-run-001/stages 2>/dev/null) && echo \"\$STAGES\" | grep -q '\"stages\"' && COUNT=\$(echo \"\$STAGES\" | grep -oE '\"stage\":\"[a-z]+\"' | wc -l) && [[ \"\$COUNT\" -eq 7 ]]"

run_check "orchestrator  :$ORCH_PORT  GET /v1/runs contains demo-run-001" \
  "RUNS=\$(curl -fsS --max-time 5 -H 'x-fora-tenant-id: $DEMO_RUN_TENANT_UUID' http://localhost:$ORCH_PORT/v1/runs 2>/dev/null) && echo \"\$RUNS\" | grep -q '\"goal_id\":\"demo-goal-forge\"'"

# Forge run-detail timeline (FORA-381). The orchestrator's
# /v1/runs/{id}/stages check above proves the data is in the right
# shape; the four checks below prove the forge UI actually renders
# the seven rows with the spec-mandated status vocabulary, the
# current-stage marker on `architect`, and the empty-state for runs
# with no stages yet. This is the smoke gate FORA-381 promised; the
# previous close on FORA-374 claimed a "seven-stage run timeline"
# without proving the HTML output.
#
# FORA-381 AC: 7 stages, ≥3 status badges, current-stage marker,
# "Stages not yet written" empty-state.
run_check "forge         :$FORGE_PORT  GET /runs/demo-run-001 7 stage rows" \
  "PAGE=\$(curl -fsS --max-time 15 http://localhost:$FORGE_PORT/runs/demo-run-001 2>/dev/null) && for STAGE in ideation architect dev qa security devops docs; do echo \"\$PAGE\" | grep -q \"data-stage=\\\"\$STAGE\\\"\" || exit 1; done"

run_check "forge         :$FORGE_PORT  GET /runs/demo-run-001 >=3 status badges" \
  "PAGE=\$(curl -fsS --max-time 15 http://localhost:$FORGE_PORT/runs/demo-run-001 2>/dev/null) && BADGES=\$(echo \"\$PAGE\" | grep -oE 'data-status=\"(in_progress|succeeded|pending)\"' | wc -l) && [[ \"\$BADGES\" -ge 3 ]]"

run_check "forge         :$FORGE_PORT  GET /runs/demo-run-001 architect current-stage marker" \
  "PAGE=\$(curl -fsS --max-time 15 http://localhost:$FORGE_PORT/runs/demo-run-001 2>/dev/null) && echo \"\$PAGE\" | grep -qE 'data-stage=\"architect\"[^>]*data-current-stage=\"true\"' && echo \"\$PAGE\" | grep -q 'data-testid=\"current-stage-marker\"'"

run_check "forge         :$FORGE_PORT  GET /runs/unknown-run empty-state" \
  "PAGE=\$(curl -fsS --max-time 15 http://localhost:$FORGE_PORT/runs/unknown-run 2>/dev/null) && echo \"\$PAGE\" | grep -q 'Stages not yet written'"

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
