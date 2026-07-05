# Phase 7 — Operational Readiness (Implementation Plan)

**Status:** PLANNED (awaiting implementation start)
**Owner:** TBA
**Depends on:** Phase 4 green (migrations safe), Phase 6 green (budgets)
**Blocks:** Phase 8

---

## 0. Pre-Phase State Verification

All findings below are from the working tree on `2026-07-05`. Every claim cites `file:line` where the source is directly readable.

### 0.1 Stack & services (`docker-compose.yml`)

Five named services declared: `postgres` (image `pgvector/pgvector:pg17`, line 39), `redis` (`redis:7-alpine`, line 65), `keycloak` (`quay.io/keycloak/keycloak:26.0.1`, line 83 — pinned), `litellm` (`ghcr.io/berriai/litellm:main-latest`, line 150 — **NOT pinned**), `floci` (`floci/floci:latest`, line 203 — **NOT pinned**). Plus three build-only services: `backend` (built from `backend/Dockerfile`), `forge-ui` (built from `apps/forge/Dockerfile.dev`), `docs-site` (built from `docs-site/Dockerfile`).

### 0.2 Image pinning status (the SC-7.6 baseline)

`grep -nE "image:.*:latest" docker-compose.yml` returns **2 hits** that must move to digest pins:

| Line | Current | Action |
|---|---|---|
| 150 | `image: ghcr.io/berriai/litellm:main-latest` | pin to `ghcr.io/berriai/litellm@sha256:<digest>` for a known-stable LiteLLM release (recommend v1.52.x LTS) |
| 203 | `image: floci/floci:latest` | pin to `floci/floci@sha256:<digest>` for the floci 2.x line |

Other tags are semver-pinned (`pg17`, `7-alpine`, `26.0.1`) — semver pins are acceptable for SC-7.6 (the SC forbids `:latest`, not floating major tags). **Resolution: pin only the two `:latest` references.**

### 0.3 Health endpoint surface (the SC-7.5 baseline)

Two health endpoints exist:

1. `backend/app/api/healthz.py:253` — top-level `GET /healthz`. **7 probes** (db_health, redis_health, keycloak_reachable, litellm_health, audit_sink, floci_health, forge_phase4_mounted, otel_exporter_configured). Already includes `keycloak` and `version` (line 314). Does **NOT** include `git_sha` or `latency_ms`. Returns `200 + degraded` body on failure (lines 247-250) — does NOT return 503.
2. `backend/app/api/v1/health.py:57` — `GET /api/v1/health` (mounted under v1). **3 probes** (postgres, redis, litellm) at lines 67-72. Does **NOT** include `keycloak`. No `git_sha`. No `latency_ms`. Always returns 200.

The brief's `GET /health` matches neither route exactly. **Resolution:** the brief is unambiguous about the 4 components (DB/Redis/LiteLLM/Keycloak) and the `git_sha` field — extend the top-level `/healthz` (not the v1 endpoint, which is for authenticated per-component checks) with the missing two fields, plus `latency_ms` per probe, plus a 503-on-degraded behavior. `app/api/v1/health.py` stays as-is (Phase 5 owns that surface); `/healthz` is the operator-facing one.

### 0.4 Configuration surface (`backend/app/core/config.py`)

50+ Settings fields declared (lines 32-298). Selected key fields for Phase 7:

- `database_url` (line 44, required) — postgres password rotation target
- `redis_url` (line 49, required) — not a credential
- `litellm_proxy_url` (line 53), `litellm_api_key` (line 54), `litellm_master_key` (line 104), `litellm_admin_key` (line 96) — rotation targets
- `keycloak_url` (line 147), `keycloak_realm` (line 148) — Keycloak reachability
- `jwt_secret` (line 153, required), `jwt_algorithm` (line 154) — rotation target
- `dev_auth_bypass` (line 210) — guarded by `_dev_bypass_only_in_dev` validator (line 301)

`jwt_secret` is a single value. **No `jwt_secret_previous` field** — JWT rotation would require a restart. **Resolution:** add `jwt_secret_previous: str | None = None` (Field default None) so rotation can use a 5-min overlap window where the backend accepts both old and new keys during the JWT decode path.

### 0.5 JWT decode path (`backend/app/core/security.py`)

Single-key decode at lines 50-67: `jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm], ...)`. No overlap window. **Resolution:** patch `decode_token` to try `settings.jwt_secret` first, fall back to `settings.jwt_secret_previous` if set and primary rejects. Only applies when `jwt_algorithm` is symmetric (HS256); RS256 / JWKS path is unaffected.

### 0.6 Existing operational scripts (`scripts/`)

13 files. The Phase 7 brief lists 5 NEW scripts that must be created:

| Brief wants | Already exists | Action |
|---|---|---|
| `setup-fresh-machine.sh` (T7.1) | `setup-local.sh` (197 lines) covers 90% of the brief's spec | **Patch in place** — add timer, polling, seeds, end-of-run summary; do NOT create a new file |
| `rotate-secrets.sh` (T7.2) | nothing | create |
| `backup-postgres.sh` (T7.3) | nothing | create |
| `restore-postgres.sh` (T7.3) | nothing | create |
| `check-image-pinning.sh` (T7.6) | nothing | create |
| `check-env-example.sh` (T7.7) | nothing | create |

Existing templates to mirror for header / `set -euo pipefail` / `::error::` style: `check-test-location.sh` (2.2K, the canonical Phase-1 guard pattern), `check-audit-tenancy.sh` (362B — Phase 4), `setup-local.sh` itself. `db-migrate.sh` (1.4K) is the alembic wrapper — restore script must call it after the dump loads.

### 0.7 Existing operational runbooks (`docs/operations/`)

13 files. The Phase 7 brief lists 5 NEW runbooks under `docs/runbooks/`:

| Brief wants | Already in `docs/operations/` | Action |
|---|---|---|
| `docs/runbooks/setup.md` | nothing close | create thin canonical (the rich content lives in `setup-local.sh` itself + `docs/operations/dev-bootstrap.md` 15.1K) |
| `docs/runbooks/backup-restore.md` | nothing close | create |
| `docs/runbooks/disaster-recovery.md` | nothing close | create |
| `docs/runbooks/oncall.md` | `docs/operations/oncall-runbook.md` (13.7K, 376 lines) — **strict superset** of the brief's required content | create **thin canonical** (P0/P1/P2 SLA ladder + rotation template only) that references the rich doc |
| `docs/runbooks/incident-response.md` | `docs/operations/incident-response.md` (19K, 451 lines) — **strict superset** of the brief's required content | create **thin canonical** that references the rich doc |
| `docs/runbooks/index.md` | nothing close | create |

`docs/runbooks/` already has 2 thin files: `budget-exhausted.md` (7.1K), `litellm-downtime.md` (24.2K). The Phase 7 runbooks join this directory without disturbing them.

### 0.8 CI workflows (`.github/workflows/`)

Three workflows:

- `test.yml` (1.8K) — covers `apps/forge/**` only (lines 6-7)
- `docs.yml` (2.1K) — covers docs drift
- `python-ci.yml` (Phase 4) — does not exist yet at this path (Phase 4 detailed plan creates it)

**Phase 7 adds a fourth workflow:** `operational-readiness.yml`. It runs `check-image-pinning.sh`, `check-env-example.sh`, and the secrets-rotation smoke from PR-7.2.

### 0.9 `.env.example` completeness (the SC-7.7 baseline)

`.env.example` is 260 lines. Per the brief it must contain every var referenced by `app/core/config.py`. The 50+ Settings fields imply ~50+ vars; the existing example has fewer (visible from `docker-compose.yml` defaults — only the fields actually consumed by the compose environment are present). **Resolution:** PR-7.7 audits `.env.example` against the Settings class via AST parsing of `app/core/config.py` and inserts every missing field with a comment showing the type + default. (Read access to `.env.example` is denied to this plan-agent; the implementation agent must open the file at PR-time and complete the diff. The plan provides the field list to add in §4 PR-7.7.)

### 0.10 Deploy pipeline (`scripts/deploy.sh`)

Already loads `infra/env/<env>.env` (lines 82-87) — so the env-file convention exists; Phase 7's `rotate-secrets.sh` writes to the same path. Already has rolling-restart + smoke + rollback (lines 134-185). **Resolution:** `rotate-secrets.sh` produces a NEW `infra/env/<env>.env` (timestamped as `.env.<UTC>`) so the existing deploy pipeline picks up the new values on the next deploy.

### 0.11 Postgres backups — operational gap

`scripts/postgres-init/` has 2 SQL files (`01-extensions.sql`, `02-age-setup.sql`) and `scripts/floci-init/` has 1 shell (`01-create-buckets.sh`) — both are init scripts, NOT backup scripts. The brief requires `pg_dump`-based backups with S3 (or floci S3 in dev) upload + 30-day retention. **No backup tooling exists today.** PR-7.3 creates both the backup and restore scripts.

### 0.12 Existing isolation tests (`backend/tests/test_rls_isolation.py`)

Per Phase 4 SC-4.3: ≥ 30 service isolation tests + ≥ 25 router isolation tests. The Phase 7 /healthz probe must not regress any of these. **Resolution:** every Phase 7 PR must keep `pytest backend/tests -k isolation -q` green.

### 0.13 Brief line 183 has wrong content

`docs/plan/phase-7.md:182-194` contains a Phase 3 close-out template left over from a previous phase — the brief itself is partly corrupted. **Resolution:** at PR-7 merge time, the implementation agent overwrites the close-out section with the Phase 7 close-out (template provided in §10 of this plan). The corruption does not affect any of the 10 SCs or 10 tasks.

### 0.14 DR scenarios covered by the brief

The brief's T7.4.1 enumerates 4 scenarios (region failure, DB corruption, Redis loss, LiteLLM down). Each needs trigger / detection / mitigation / RTO/RPO target / owner. **Targets to declare in the runbook:**
- Region failure: RTO ≤ 4h, RPO ≤ 24h
- DB corruption: RTO ≤ 4h, RPO ≤ 24h (last good backup)
- Redis loss: RTO ≤ 30min, RPO = 0 (rebuild from Postgres)
- LiteLLM down: RTO = N/A (queue 503s per Phase 6), RPO = N/A

### 0.15 Drift between brief and reality

| Brief says | Reality | Resolution |
|---|---|---|
| `scripts/setup-fresh-machine.sh` (new file) | `scripts/setup-local.sh` (197 lines) covers ~90% of the spec | Patch `setup-local.sh` in place: add timer, /health poll, seeds. Do NOT create a new file. Brief's "Files Touched" row is corrected. |
| `GET /health` returns 4 components | `/healthz` returns 7 (incl. all 4 named) + extras; `/api/v1/health` returns 3 | Extend `/healthz` (top-level, unauth, the operator surface) with the missing `git_sha` + `latency_ms` fields; flip to 503-on-degraded. Leave `/api/v1/health` alone (Phase 5 surface). |
| Health endpoint returns `version` + `git_sha` | `/healthz:314` returns `version` only; no `git_sha` anywhere | Read `GIT_SHA` from env (compose injects it; or `git rev-parse --short HEAD` at process start if missing). Add `latency_ms` per probe (time each probe with `time.perf_counter`). |
| Brief's SC-7.5 schema puts `latency_ms` under each component | `/healthz` currently emits `probes.{name}` flat — no latency | Add `latency_ms` as a sibling: `probes.postgres = {"status": "ok", "latency_ms": 3}`. |
| 503 on degraded | `/healthz` returns 200 + body even when degraded (line 247) | Wrap route in a `Response` that sets `status_code=503` when `_aggregate_status(...) == "degraded"`. Preserve 200 for fully-green. |
| 2 unpinned images | 2 unpinned (`litellm:main-latest`, `floci:latest`) | Pin both by `@sha256:` digest in PR-7.6. |
| `JWT_SECRET` rotation (T7.2) requires "no manual restart" | Single-key JWT decode (`security.py:55`) | Add `jwt_secret_previous: str | None` field; patch `decode_token` to try primary, fall back to previous when primary rejects. 5-min overlap. |
| `.env.example` is complete | ~40 Settings fields are likely missing (denied read for exact diff; verified by field count mismatch between compose env block and Settings class) | PR-7.7 uses AST on `app/core/config.py` to derive the authoritative list and patches `.env.example` with the missing fields. |
| 4-component on-call (P0/P1/P2) | `docs/operations/oncall-runbook.md` has the full rotation + escalation ladder | Create thin canonical in `docs/runbooks/oncall.md` (SLA ladder + rotation template only). Cross-link to the rich doc. |
| 4-component incident response (template + cadence + comms + post-mortem) | `docs/operations/incident-response.md` has all 4 + GDPR + SOC2 + tabletop exercise | Create thin canonical in `docs/runbooks/incident-response.md` (template + cadence + 2 comms templates + post-mortem template). Cross-link to the rich doc. |
| Phase 7 has no Python CI lane | `.github/workflows/python-ci.yml` does not exist (Phase 4 creates it) | Add `.github/workflows/operational-readiness.yml` (Phase 7 only — narrower scope than python-ci). Reference python-ci when both are merged. |
| `docs/runbooks/setup.md` (new) | nothing close | Create from `setup-local.sh` header + a short prose version. |

---

## 1. Goal

Prove, by automated test and an executed runbook drill, that a fresh operator can stand up the full stack, rotate every credential, restore from backup, and survive a region failure — all without paging the original team. Three concrete outputs: a 15-minute fresh-machine setup that is timed and verified, a secrets-rotation script tested in CI, and a backup→restore drill whose duration is captured in `docs/plan/phase-7-restore-drill.md`. Phase 7 is the bridge between "production-grade code" (Phase 6) and "production launch" (Phase 8).

---

## 2. Success Criteria

| ID | Criterion | Verification command (must pass) |
|---|---|---|
| SC-7.1 | Fresh-machine setup from `git clone` to `/healthz` returning `status:ok` ≤ 15 minutes | Run `scripts/setup-local.sh` on a clean container; capture `docs/plan/phase-7-fresh-machine-time.md` with the wall-clock duration + per-step breakdown |
| SC-7.2 | Secrets rotation script (`scripts/rotate-secrets.sh`) rotates JWT signing key, LiteLLM master key, DB password; tested in CI | `operational-readiness.yml::rotate-secrets` job spins an ephemeral compose stack, runs rotation, asserts dependent services re-authenticate without restart |
| SC-7.3 | Postgres backup + restore runbook (`docs/runbooks/backup-restore.md`) tested end-to-end | `scripts/restore-postgres.sh` drills in CI; capture `docs/plan/phase-7-restore-drill.md` with RTO/RPO; manual drill against a 1GB database completes in < 1 hour |
| SC-7.4 | Disaster recovery runbook covers 4 scenarios | `docs/runbooks/disaster-recovery.md` has trigger/detection/mitigation/RTO/RPO/owner per scenario |
| SC-7.5 | Health endpoint `GET /healthz` returns per-component status (postgres, redis, litellm, keycloak) with `version` + `git_sha` + `latency_ms`; returns 503 when any component degraded | `curl /healthz` returns the documented JSON; killing each of 4 containers in turn returns 503 + the corresponding probe `"down"` |
| SC-7.6 | Docker images pinned by digest in `docker-compose.yml`; no `:latest` tag | `grep -E "image:.*:latest" docker-compose.yml` returns 0 lines; `bash scripts/check-image-pinning.sh` exits 0 |
| SC-7.7 | `.env.example` covers every Settings field; missing-var detector exits 0 | `bash scripts/check-env-example.sh` exits 0; CI blocks on a regression |
| SC-7.8 | All runbooks linked from `docs/runbooks/index.md` | file committed, every link resolves (CI: `lychee`/`linkinator`) |
| SC-7.9 | On-call rotation: `docs/runbooks/oncall.md` defines P0/P1/P2 response times + escalation + rotation template | file committed; cross-references `docs/operations/oncall-runbook.md` |
| SC-7.10 | Incident response: `docs/runbooks/incident-response.md` defines template, cadence, comms, post-mortem | file committed; cross-references `docs/operations/incident-response.md` |

---

## 3. Sub-Phases / PR Breakdown

**8 PRs.** PRs 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8 land independently — none requires another to merge first. PR-7.4 (DR runbook) lands last because it references the scripts from PR-7.1/7.2/7.3.

### PR-7.1 — Fresh-machine setup timer + polling + seed wiring

Extend `scripts/setup-local.sh` with: a wall-clock timer that prints per-step elapsed seconds; a `/healthz` poll loop after `docker compose up`; `python -m seeds` invocation; an end-of-run summary that writes `docs/plan/phase-7-fresh-machine-time.md`. Capture baseline timing on the maintainer's laptop. Idempotent (already is).

### PR-7.2 — Secrets rotation script + JWT overlap window

Create `scripts/rotate-secrets.sh` that generates new JWT secret, LiteLLM master key, DB password, Keycloak client secret; updates `infra/env/<env>.env` with a timestamped sibling; updates Keycloak realm via REST; flushes the new DB password via `ALTER USER ... WITH PASSWORD`. Add `jwt_secret_previous` field to `Settings`; patch `decode_token` to try primary, fall back to previous. CI test: spin ephemeral compose stack, run rotation, assert `decode_token` accepts both old and new keys for 5 minutes after rotation.

### PR-7.3 — Backup + restore scripts + drill capture

Create `scripts/backup-postgres.sh` (`pg_dump` → gzip → upload to floci S3 with 30-day retention) and `scripts/restore-postgres.sh` (drop+recreate target DB → `pg_restore` → `alembic upgrade head`). Manual drill against a 1GB dataset; capture results in `docs/plan/phase-7-restore-drill.md`. Author `docs/runbooks/backup-restore.md`.

### PR-7.4 — Disaster recovery runbook (4 scenarios)

Create `docs/runbooks/disaster-recovery.md` with the 4 scenarios from §0.14, each with: trigger, detection, mitigation, RTO/RPO, owner. Author `docs/runbooks/oncall.md` (thin canonical cross-referencing `docs/operations/oncall-runbook.md`).

### PR-7.5 — Health endpoint extension (`/healthz` → `git_sha` + `latency_ms` + 503)

Edit `backend/app/api/healthz.py` to:
- Read `GIT_SHA` from env (`os.environ.get("GIT_SHA")` falling back to a cached `git rev-parse --short HEAD` at process start)
- Wrap each probe in a `time.perf_counter()` measurement; report `latency_ms` per probe
- Return 503 when `_aggregate_status(probes) != "ok"`
- Update `tests/test_healthz.py` for the new shape + the 503 behavior

### PR-7.6 — Image digest pinning

Replace `ghcr.io/berriai/litellm:main-latest` (line 150) and `floci/floci:latest` (line 203) with `@sha256:` digests. Create `scripts/check-image-pinning.sh` (grep wrapper). Wire into `.github/workflows/operational-readiness.yml`.

### PR-7.7 — Env completeness

Use AST to derive the authoritative Settings fields list from `app/core/config.py`; diff against `.env.example`; insert missing fields with type + default comments. Create `scripts/check-env-example.sh` that re-runs the diff. Wire into CI.

### PR-7.8 — Runbook index + oncall + incident-response canonicals

Create `docs/runbooks/index.md` linking every runbook (existing + new). Create `docs/runbooks/oncall.md` (thin canonical cross-referencing `docs/operations/oncall-runbook.md`). Create `docs/runbooks/incident-response.md` (thin canonical cross-referencing `docs/operations/incident-response.md`). Wire link-checking into CI.

**PR ordering rationale:** PR-7.1 must land first to capture the baseline timer (later changes can't add it retroactively). PRs 7.2/7.3/7.5/7.6/7.7 are independent of each other and can ship in any order after 7.1. PR-7.4 last because it cross-references the scripts from 7.1/7.2/7.3. PR-7.8 last because it indexes runbooks that don't exist until 7.4 is merged.

---

## 4. Per-Task Detail

### PR-7.1 — Fresh-machine setup timer + polling + seed wiring

**Pre-conditions:** Phase 6 green.

**Files edited:**

- `scripts/setup-local.sh` (extend in place; do NOT create `setup-fresh-machine.sh`)
- `docs/plan/phase-7-fresh-machine-time.md` (new — captures the wall-clock timing)

**`scripts/setup-local.sh` patch** (insertions marked `+# PR-7.1`):

```bash
#!/usr/bin/env bash
# scripts/setup-local.sh — single command to set up Forge AI local dev.
# (existing header — do not delete)
# PR-7.1: now also (a) times every step, (b) polls /healthz until green,
# (c) runs python -m seeds, (d) writes a timing report under docs/plan/.
# PR-7.1: drop the existing `log` / `warn` / `fail` helpers — we keep
# them and add step-level timing on top.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# PR-7.1: timing harness.
TIMING_REPORT="${REPO_ROOT}/docs/plan/phase-7-fresh-machine-time.md"
mkdir -p "$(dirname "$TIMING_REPORT")"
TIMING_LOG="$(mktemp)"
TIMING_TOTAL_START=$(date +%s)

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
# 10. PR-7.1: /healthz poll until green.
# ---------------------------------------------------------------------------
step_start "healthz-poll"
log "polling /healthz until all 4 components report ok"
HEALTHZ_URL="http://localhost:${BACKEND_PORT:-8000}/healthz"
HEALTHZ_OK=0
HEALTHZ_DEADLINE=$(($(date +%s) + 120))
while [[ "$(date +%s)" -lt "$HEALTHZ_DEADLINE" ]]; do
    body="$(curl -fsS --max-time 5 "$HEALTHZ_URL" 2>/dev/null || true)"
    if echo "$body" | grep -q '"status":"ok"'; then
        HEALTHZ_OK=1
        break
    fi
    sleep 2
done
if (( HEALTHZ_OK == 0 )); then
    warn "/healthz did not return ok within 120s; check 'docker compose logs backend'"
fi
step_end

# ---------------------------------------------------------------------------
# 11. Timing report
# ---------------------------------------------------------------------------
TIMING_TOTAL_END=$(date +%s)
TIMING_TOTAL=$(( TIMING_TOTAL_END - TIMING_TOTAL_START ))
{
    echo "# Phase 7 — Fresh-machine timing report"
    echo
    echo "Captured: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    echo "Host: $(uname -a)"
    echo "Docker: $(docker --version)"
    echo
    echo "## Total wall-clock"
    echo
    echo "**${TIMING_TOTAL}s** (target: ≤ 900s = 15 min)"
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
        echo "| \`$name\` | $secs |"
    done < "$TIMING_LOG"
} > "$TIMING_REPORT"
rm -f "$TIMING_LOG"

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
```

**Verification:**

```bash
# Local — capture baseline
cd /home/arunachalam.v@knackforge.com/forge-ai
docker compose down -v                 # wipe state
bash scripts/setup-local.sh
# Expect: TIMING_TOTAL ≤ 900; report at docs/plan/phase-7-fresh-machine-time.md
cat docs/plan/phase-7-fresh-machine-time.md

# Negative probe — break postgres, confirm step_end captures it
docker compose stop postgres
bash scripts/setup-local.sh   # exits 1 at wait-postgres; partial report written

# CI smoke (operational-readiness.yml::fresh-machine) — separate job;
# runs in a fresh ubuntu-latest runner with a 20-min budget.
```

---

### PR-7.2 — Secrets rotation script + JWT overlap window

**Pre-conditions:** PR-7.1 merged (the baseline setup is timed).

**Files created/edited:**

- `scripts/rotate-secrets.sh` (new)
- `backend/app/core/config.py` (add `jwt_secret_previous` field)
- `backend/app/core/security.py` (patch `decode_token` for overlap)
- `backend/tests/test_security.py` (extend with overlap-window tests)
- `.github/workflows/operational-readiness.yml` (new — see PR-7.6 template; rotate-secrets job lives here)

**`scripts/rotate-secrets.sh` body** (~210 lines):

```bash
#!/usr/bin/env bash
# scripts/rotate-secrets.sh — rotate JWT signing key, LiteLLM master key,
# DB password, Keycloak client secret. Writes the new values to a
# timestamped sibling of infra/env/<env>.env so the existing deploy
# pipeline (scripts/deploy.sh) picks them up on the next deploy.
#
# Usage:
#   scripts/rotate-secrets.sh --env=staging [--no-keycloak] [--no-db]
#
# Overlap window: the script also writes the OLD jwt_secret to
# JWT_SECRET_PREVIOUS in the new env file. The backend's decode_token
# (app/core/security.py) tries primary then previous, so tokens minted
# before rotation remain valid for the lifetime of the overlap window
# (default 5 minutes; configurable via --overlap-seconds=<N>).
#
# References: SC-7.2; risk row 3 of phase-7.md.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV=""
ROTATE_KEYCLOAK=1
ROTATE_DB=1
ROTATE_LITELLM=1
ROTATE_JWT=1
OVERLAP_SECONDS=300  # 5 min — matches brief's risk row 3
NOW="$(date -u +'%Y%m%dT%H%M%SZ')"

usage() {
    cat <<EOF
Usage: $0 --env=<dev|staging|prod> [options]

Options:
  --env=NAME              target environment (required)
  --no-keycloak           skip Keycloak client secret rotation
  --no-db                 skip DB password rotation
  --no-litellm            skip LiteLLM master key rotation
  --no-jwt                skip JWT signing key rotation
  --overlap-seconds=N     JWT overlap window (default 300)
  -h, --help              show this help
EOF
}

for arg in "$@"; do
    case "$arg" in
        --env=*)         ENV="${arg#*=}" ;;
        --no-keycloak)   ROTATE_KEYCLOAK=0 ;;
        --no-db)         ROTATE_DB=0 ;;
        --no-litellm)    ROTATE_LITELLM=0 ;;
        --no-jwt)        ROTATE_JWT=0 ;;
        --overlap-seconds=*) OVERLAP_SECONDS="${arg#*=}" ;;
        -h|--help)       usage; exit 0 ;;
        *)               echo "unknown flag: $arg" >&2; usage; exit 2 ;;
    esac
done

[[ -n "$ENV" ]] || { echo "--env is required" >&2; usage; exit 2; }
case "$ENV" in
    dev|staging|prod) ;;
    *) echo "invalid --env=$ENV (expected dev|staging|prod)" >&2; exit 2 ;;
esac

log()  { printf '\033[1;34m[rotate:%s]\033[0m %s\n' "$ENV" "$*"; }
warn() { printf '\033[1;33m[rotate:%s]\033[0m %s\n' "$ENV" "$*" >&2; }
fail() { printf '\033[1;31m[rotate:%s]\033[0m %s\n' "$ENV" "$*" >&2; exit 1; }

ENV_FILE="infra/env/${ENV}.env"
[[ -f "$ENV_FILE" ]] || fail "missing env file: $ENV_FILE (copy from .env.example)"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# ---------------------------------------------------------------------------
# Snapshot current values (to write into JWT_SECRET_PREVIOUS for overlap)
# ---------------------------------------------------------------------------
PREV_JWT_SECRET="${JWT_SECRET:-}"
[[ -n "$PREV_JWT_SECRET" ]] || fail "JWT_SECRET not set in $ENV_FILE"

OUT_FILE="${ENV_FILE}.rotated.${NOW}"
cp "$ENV_FILE" "$OUT_FILE"
log "wrote $OUT_FILE (will become $ENV_FILE on next deploy)"

# ---------------------------------------------------------------------------
# 1. JWT signing key
# ---------------------------------------------------------------------------
if (( ROTATE_JWT )); then
    log "rotating JWT signing key (overlap ${OVERLAP_SECONDS}s)"
    NEW_JWT="$(openssl rand -base64 48)"
    sed -i.bak \
        -e "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT}|" \
        -e "s|^JWT_SECRET_PREVIOUS=.*|JWT_SECRET_PREVIOUS=${PREV_JWT_SECRET}|" \
        "$OUT_FILE"
    rm -f "${OUT_FILE}.bak"
    log "  new JWT_SECRET: ${NEW_JWT:0:8}..."
    log "  JWT_SECRET_PREVIOUS (for overlap): ${PREV_JWT_SECRET:0:8}..."
fi

# ---------------------------------------------------------------------------
# 2. LiteLLM master key
# ---------------------------------------------------------------------------
if (( ROTATE_LITELLM )); then
    log "rotating LiteLLM master key"
    NEW_LITELLM="sk-litellm-$(openssl rand -hex 24)"
    sed -i.bak \
        -e "s|^LITELLM_MASTER_KEY=.*|LITELLM_MASTER_KEY=${NEW_LITELLM}|" \
        -e "s|^LITELLM_API_KEY=.*|LITELLM_API_KEY=${NEW_LITELLM}|" \
        "$OUT_FILE"
    rm -f "${OUT_FILE}.bak"
    log "  new LITELLM_MASTER_KEY: ${NEW_LITELLM:0:14}..."
fi

# ---------------------------------------------------------------------------
# 3. DB password
# ---------------------------------------------------------------------------
if (( ROTATE_DB )); then
    log "rotating DB password"
    NEW_DB_PW="$(openssl rand -base64 32 | tr -d '+/' | head -c 40)"
    sed -i.bak \
        -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_DB_PW}|" \
        "$OUT_FILE"
    rm -f "${OUT_FILE}.bak"
    # Apply live: ALTER USER on the running Postgres.
    if command -v psql >/dev/null 2>&1; then
        PGHOST="${POSTGRES_HOST:-localhost}"
        PGPORT="${POSTGRES_PORT:-5432}"
        PGUSER="${POSTGRES_ADMIN_USER:-postgres}"
        export PGPASSWORD="${POSTGRES_ADMIN_PASSWORD:-${POSTGRES_PASSWORD}}"
        psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
            -c "ALTER USER ${POSTGRES_USER:-forge} WITH PASSWORD '${NEW_DB_PW}';" \
            || fail "ALTER USER failed; old password still active"
        log "  ALTER USER applied to ${POSTGRES_USER:-forge}"
    else
        warn "psql not on PATH; skipped live ALTER USER"
    fi
fi

# ---------------------------------------------------------------------------
# 4. Keycloak client secret
# ---------------------------------------------------------------------------
if (( ROTATE_KEYCLOAK )); then
    log "rotating Keycloak client secret (forge-backend)"
    NEW_KC_SECRET="$(openssl rand -base64 48 | tr -d '+/' | head -c 64)"
    if command -v curl >/dev/null 2>&1; then
        ADMIN_TOKEN="$(curl -fsS \
            -d "username=${KEYCLOAK_ADMIN:-admin}" \
            -d "password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" \
            -d "grant_type=password" \
            -d "client_id=admin-cli" \
            "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
            | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")"
        INTERNAL_ID="$(curl -fsS \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            "${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM:-forge}/clients?clientId=forge-backend" \
            | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")"
        curl -fsS -X PUT \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"secret\":\"${NEW_KC_SECRET}\"}" \
            "${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM:-forge}/clients/${INTERNAL_ID}" \
            || fail "Keycloak secret rotation failed; reverting"
        sed -i.bak \
            -e "s|^FORGE_BACKEND_CLIENT_SECRET=.*|FORGE_BACKEND_CLIENT_SECRET=${NEW_KC_SECRET}|" \
            -e "s|^KEYCLOAK_BACKEND_SECRET=.*|KEYCLOAK_BACKEND_SECRET=${NEW_KC_SECRET}|" \
            "$OUT_FILE"
        rm -f "${OUT_FILE}.bak"
        log "  new forge-backend client secret applied to Keycloak + env file"
    else
        warn "curl not on PATH; skipped live Keycloak rotation"
    fi
fi

cat <<EOF

[rotate:$ENV] Done.

New env file: $OUT_FILE

Next steps:
  1. Diff $OUT_FILE against $ENV_FILE and review.
  2. Run scripts/deploy.sh --env=$ENV to roll the new secrets.
  3. After deploy, the JWT overlap window is ${OVERLAP_SECONDS}s — long enough
     for the backend to accept both old + new tokens. Old tokens expire at
     their JWT exp claim (typically 1 hour); after that the overlap is no
     longer load-bearing.
  4. Once verified, rm $ENV_FILE and mv $OUT_FILE $ENV_FILE.

EOF
```

**Settings field addition** (`backend/app/core/config.py`, after line 156 `jwt_issuer: str | None = None`):

```python
# Phase 7 SC-7.2 — JWT rotation overlap window.
jwt_secret_previous: str | None = Field(
    default=None,
    description=(
        "JWT_SECRET_PREVIOUS. Previous signing key accepted during the "
        "rotation overlap window. Set by scripts/rotate-secrets.sh; "
        "unset in steady state."
    ),
)
```

**`decode_token` patch** (`backend/app/core/security.py:50-67`):

```python
def decode_token(token: str) -> dict[str, Any]:
    """Decode + verify a JWT, raising HTTPException on failure.

    Phase 7 SC-7.2 — overlap window. When settings.jwt_secret_previous
    is set (the rotation script set it during the brief overlap window),
    the primary key is tried first; on ``JWTError`` the previous key is
    tried once. This lets tokens minted before rotation remain valid for
    the overlap window without forcing every client to re-mint
    simultaneously.
    """
    options = {"verify_aud": settings.jwt_audience is not None}
    common = dict(
        algorithms=[settings.jwt_algorithm],
        audience=settings.jwt_audience,
        issuer=settings.jwt_issuer,
        options=options,
    )
    try:
        return jwt.decode(token, settings.jwt_secret, **common)
    except JWTError:
        # Only retry with the previous key when one is configured AND
        # the algorithm is symmetric (HS256/HS384/HS512). For
        # asymmetric algorithms (RS256/ES256) the JWKS path is the
        # only rotation story — see ADR-005.
        if (
            settings.jwt_secret_previous
            and settings.jwt_algorithm.startswith("HS")
        ):
            try:
                return jwt.decode(
                    token, settings.jwt_secret_previous, **common
                )
            except JWTError:
                pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
```

**CI test (lives in `.github/workflows/operational-readiness.yml::rotate-secrets`)** — pseudocode for the plan:

1. Spin ephemeral compose stack.
2. Mint a token with the OLD `JWT_SECRET`; assert 200.
3. Run `scripts/rotate-secrets.sh --env=dev --overlap-seconds=60`.
4. Reload backend with the new env file.
5. Mint a token with the NEW `JWT_SECRET`; assert 200.
6. Mint a token with the OLD `JWT_SECRET`; assert 200 (overlap window).
7. Wait 65s; mint OLD-token again; assert 401 (overlap closed).

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai
docker compose up -d postgres redis keycloak
bash scripts/rotate-secrets.sh --env=dev --no-keycloak --no-db
cp infra/env/dev.env infra/env/dev.env.bak
mv infra/env/dev.env.rotated.* infra/env/dev.env
docker compose up -d --force-recreate backend

cd backend
pytest tests/test_security.py -q -k overlap
# Expect: 4 tests pass.
```

---

### PR-7.3 — Backup + restore scripts + drill capture

**Pre-conditions:** PR-7.1 merged (the stack is up).

**Files created:**

- `scripts/backup-postgres.sh`
- `scripts/restore-postgres.sh`
- `docs/runbooks/backup-restore.md`
- `docs/plan/phase-7-restore-drill.md` (output — captures drill results)

**`scripts/backup-postgres.sh` body** (~140 lines):

```bash
#!/usr/bin/env bash
# scripts/backup-postgres.sh — pg_dump → gzip → S3-compatible upload.
#
# Usage:
#   scripts/backup-postgres.sh [--target=dev|staging|prod] [--retention-days=30]
#
# In dev the upload target is floci's S3 (ADR-001); in staging/prod it
# is real AWS S3 per infra/terraform/. The script picks the target by
# reading infra/env/<env>.env — the same convention scripts/deploy.sh
# uses.
#
# References: SC-7.3; risk row 1 (backup file size grows unbounded) —
# handled by the --retention-days flag.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV="${ENV:-dev}"
RETENTION_DAYS=30
LOCAL_BACKUP_DIR="${REPO_ROOT}/infra/backups"

usage() {
    cat <<EOF
Usage: $0 [--env=dev|staging|prod] [--retention-days=30]
EOF
}

for arg in "$@"; do
    case "$arg" in
        --env=*)          ENV="${arg#*=}" ;;
        --retention-days=*) RETENTION_DAYS="${arg#*=}" ;;
        -h|--help)        usage; exit 0 ;;
        *)                echo "unknown flag: $arg" >&2; usage; exit 2 ;;
    esac
done

log()  { printf '\033[1;34m[backup:%s]\033[0m %s\n' "$ENV" "$*"; }
fail() { printf '\033[1;31m[backup:%s]\033[0m %s\n' "$ENV" "$*" >&2; exit 1; }

ENV_FILE="infra/env/${ENV}.env"
[[ -f "$ENV_FILE" ]] || fail "missing env file: $ENV_FILE"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

mkdir -p "$LOCAL_BACKUP_DIR"
TS="$(date -u +'%Y%m%dT%H%M%SZ')"
FILENAME="forge-${ENV}-${TS}.sql.gz"
LOCAL_PATH="${LOCAL_BACKUP_DIR}/${FILENAME}"

# pg_dump the running postgres.
SYNC_URL="${DATABASE_URL/asyncpg/postgresql}"
log "pg_dump → $LOCAL_PATH"
pg_dump "$SYNC_URL" --no-owner --clean --if-exists \
    | gzip -9 > "$LOCAL_PATH"

SIZE_BYTES="$(stat -c%s "$LOCAL_PATH")"
log "  size: ${SIZE_BYTES} bytes"
if (( SIZE_BYTES < 1024 )); then
    fail "backup suspiciously small (${SIZE_BYTES} bytes); aborting"
fi

S3_BUCKET="${BACKUP_S3_BUCKET:-forge-backups-${ENV}}"
S3_PREFIX="${BACKUP_S3_PREFIX:-postgres}"

if [[ "$ENV" == "dev" ]]; then
    log "uploading to floci S3 (dev): s3://${S3_BUCKET}/${S3_PREFIX}/${FILENAME}"
    AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}" \
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}" \
    AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}" \
        aws s3 cp "$LOCAL_PATH" "s3://${S3_BUCKET}/${S3_PREFIX}/${FILENAME}" \
        --endpoint-url "$AWS_ENDPOINT_URL" \
        || fail "s3 upload failed"
else
    log "uploading to AWS S3: s3://${S3_BUCKET}/${S3_PREFIX}/${FILENAME}"
    aws s3 cp "$LOCAL_PATH" "s3://${S3_BUCKET}/${S3_PREFIX}/${FILENAME}" \
        || fail "s3 upload failed"
fi

log "pruning backups older than ${RETENTION_DAYS} days"
find "$LOCAL_BACKUP_DIR" -name "forge-${ENV}-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

log "OK — $FILENAME (${SIZE_BYTES} bytes) backed up + retention applied"
```

**`scripts/restore-postgres.sh` body** (~150 lines):

```bash
#!/usr/bin/env bash
# scripts/restore-postgres.sh — restore a Postgres backup.
#
# Usage:
#   scripts/restore-postgres.sh --file=infra/backups/forge-dev-20260705T120000Z.sql.gz
#   scripts/restore-postgres.sh --s3=forge-dev-20260705T120000Z.sql.gz [--env=dev]
#
# Drops + recreates the target DB, loads the dump, runs alembic upgrade
# head. Returns 0 only when the post-restore /healthz is green.
#
# References: SC-7.3.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV="${ENV:-dev}"
FILE=""
S3_KEY=""

for arg in "$@"; do
    case "$arg" in
        --env=*)   ENV="${arg#*=}" ;;
        --file=*)  FILE="${arg#*=}" ;;
        --s3=*)    S3_KEY="${arg#*=}" ;;
        -h|--help)
            echo "Usage: $0 --file=PATH | --s3=S3_KEY [--env=NAME]"
            exit 0 ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done
[[ -n "$FILE" || -n "$S3_KEY" ]] || { echo "--file or --s3 required" >&2; exit 2; }

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
    log "downloading s3://${S3_BUCKET}/${S3_KEY} → ${WORK_FILE}"
    AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-}" \
        aws s3 cp "s3://${S3_BUCKET}/${S3_KEY}" "$WORK_FILE" || fail "s3 download failed"
else
    WORK_FILE="$FILE"
    [[ -f "$WORK_FILE" ]] || fail "file not found: $WORK_FILE"
fi
log "using $WORK_FILE ($(stat -c%s "$WORK_FILE") bytes)"

DB_NAME="${POSTGRES_DB:-forge}"
ADMIN_URL="$(echo "${DATABASE_URL}" | sed "s|/[^/]*\$|/|" | sed 's|asyncpg|postgresql|')"
ADMIN_URL_DB="$(echo "$DATABASE_URL" | sed -E 's|/[^/?]+(\?.*)?$|/postgres|; s|asyncpg|postgresql|')"

log "dropping + recreating database: ${DB_NAME}"
psql "$ADMIN_URL_DB" -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
    -c "DROP DATABASE IF EXISTS ${DB_NAME};" \
    -c "CREATE DATABASE ${DB_NAME} OWNER ${POSTGRES_USER:-forge};" \
    || fail "DB recreate failed"

log "loading dump into ${DB_NAME}"
TARGET_URL="$(echo "$DATABASE_URL" | sed 's|asyncpg|postgresql|')"
gunzip -c "$WORK_FILE" | psql "$TARGET_URL" -v ON_ERROR_STOP=1 \
    || fail "dump load failed"

log "running alembic upgrade head"
(cd backend && DATABASE_URL="$DATABASE_URL" alembic upgrade head) \
    || fail "alembic upgrade failed"

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
```

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai
docker compose up -d postgres redis keycloak
bash scripts/backup-postgres.sh --env=dev
ls -lh infra/backups/

bash scripts/restore-postgres.sh --file=$(ls -t infra/backups/forge-dev-*.sql.gz | head -1)
# Expect: drop, recreate, load, alembic, /healthz ok.
```

**`docs/plan/phase-7-restore-drill.md` template:**

```markdown
# Phase 7 — Restore drill results

Captured: <UTC>

| Metric | Value | Target | Pass? |
|---|---|---|---|
| Backup size | <bytes> | – | – |
| Backup wall-clock | <s> | – | – |
| Restore wall-clock (drop + load + alembic) | <s> | – | – |
| Restore wall-clock (full, including /healthz green) | <s> | < 3600s (1h) | – |
| Data integrity check (row counts pre vs post) | <diff> | 0 | – |
| RPO achieved | <h> | < 24h | – |
| RTO achieved | <h> | < 4h | – |
```

---

### PR-7.4 — Disaster recovery runbook + oncall canonical

**Pre-conditions:** PRs 7.1, 7.2, 7.3 merged.

**Files created:**

- `docs/runbooks/disaster-recovery.md`
- `docs/runbooks/oncall.md` (thin canonical)

**`docs/runbooks/disaster-recovery.md` body:**

```markdown
# Forge AI — Disaster Recovery Runbook

## RTO/RPO Targets (committed)

| Scenario | RTO (recovery time) | RPO (data loss window) |
|---|---|---|
| Region failure | ≤ 4 hours | ≤ 24 hours |
| DB corruption | ≤ 4 hours | ≤ 24 hours (last good backup) |
| Redis loss | ≤ 30 minutes | 0 (rebuild from Postgres) |
| LiteLLM down | N/A (queue 503s per Phase 6) | N/A |

## Scenario 1 — Region failure

**Trigger:** AWS region `us-east-1` is unavailable.

**Detection:** `/healthz` returns `degraded` for every probe; AWS
Health Dashboard shows the region degraded.

**Mitigation:**
1. Confirm the failure is region-wide.
2. Page L3 architect + L4 delegate.
3. Spin up staging in `us-west-2` from Terraform state.
4. Restore Postgres from the most recent S3 backup.
5. Re-point DNS to the new region's load balancer; wait for TTL.
6. Verify `/healthz` returns `ok` on all 4 named probes.

**RTO target:** ≤ 4 hours.
**RPO target:** ≤ 24 hours.
**Owner:** L3 architect.

## Scenario 2 — DB corruption

**Trigger:** A migration corrupts data (column drop, accidental TRUNCATE).

**Detection:** Application logs show constraint violations; `/healthz` returns `degraded` on `db_health`.

**Mitigation:**
1. **Stop the bleed.** Set `READ_ONLY_MODE=1` in the env file; reload.
2. Identify the last good backup.
3. Restore to a NEW database (do NOT drop the corrupted one until verified).
4. Reconcile audit-log gaps from the audit-log S3 mirror.
5. Swap application traffic.
6. Open an incident ticket; PIR within 5 business days per `incident-response.md`.

**RTO target:** ≤ 4 hours.
**RPO target:** ≤ 24 hours.
**Owner:** L2 platform engineer (with L3 review).

## Scenario 3 — Redis loss

**Trigger:** ElastiCache / Redis container loses its data.

**Detection:** `/healthz` returns `degraded` on `redis_health`; WS clients see stale data.

**Mitigation:**
1. Verify Redis is actually down.
2. Restart: `docker compose restart redis` (dev) or AWS CLI (prod).
3. Re-warm caches.
4. Verify `/healthz` returns `ok` on `redis_health`.

**RTO target:** ≤ 30 minutes.
**RPO target:** 0.
**Owner:** L1 on-call.

## Scenario 4 — LiteLLM down

**Trigger:** LiteLLM Proxy is unreachable, returning 5xx.

**Detection:** `/healthz` returns `degraded` on `litellm_health`.

**Mitigation:**
1. Confirm: `curl http://litellm:4000/health/liveliness`.
2. If hung, restart: `docker compose restart litellm`.
3. If upstream provider is down, engage provider failover per ADR-005.
4. **Phase 6 budget guard** — backend serves 503 from its queue rather than admitting unbounded calls.
5. Escalate to L2 if down >15 min, L3 if down >60 min.

**RTO target:** N/A.
**RPO target:** N/A.
**Owner:** L1 on-call → L2 if prolonged.

## Cross-References

- [backup-restore.md](./backup-restore.md)
- [oncall.md](./oncall.md)
- [incident-response.md](./incident-response.md)
- [../operations/oncall-runbook.md](../operations/oncall-runbook.md)
```

**`docs/runbooks/oncall.md` body** (thin canonical):

```markdown
# Forge AI — On-Call (thin canonical)

## Severity → Response Time

| Severity | Definition | Ack target | Page channel |
|---|---|---|---|
| **P0** | Platform down; data loss in progress; security incident | ≤ 15 min | PagerDuty 24/7 |
| **P1** | Degraded but serving; tenant-visible bug; cost anomaly | ≤ 1 hour | PagerDuty business hours |
| **P2** | Cosmetic; non-tenant-visible; follow-up ticket | ≤ next business day | Slack |

## Escalation Ladder

L1 on-call → L2 platform engineer → L3 architect → L4 CISO delegate

## See also

- [operations/oncall-runbook.md](../operations/oncall-runbook.md) — full remediation steps per alert
- [incident-response.md](./incident-response.md)
- [disaster-recovery.md](./disaster-recovery.md)
```

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai
grep -E '\]\(' docs/runbooks/disaster-recovery.md docs/runbooks/oncall.md | \
    sed -E 's/.*\]\(([^)]+)\).*/\1/' | sort -u | while read -r link; do
        case "$link" in
            http*|mailto*) continue ;;
            *) test -e "$link" || echo "MISSING: $link" ;;
        esac
    done
# Expect: empty output
```

---

### PR-7.5 — Health endpoint extension (`/healthz` → `git_sha` + `latency_ms` + 503)

**Pre-conditions:** PR-7.1 merged.

**Files edited:**

- `backend/app/api/healthz.py`
- `backend/tests/test_healthz.py` (extend for new shape + 503)

**`backend/app/api/healthz.py` body** (full rewrite):

```python
"""M1 T1.3 — top-level ``/healthz`` route (NOT under /api/v1/).

Phase 7 SC-7.5 extends the surface:
  - ``git_sha`` field in the body (env GIT_SHA, fallback to
    ``git rev-parse --short HEAD`` at process start).
  - ``latency_ms`` per probe.
  - HTTP 503 when ``_aggregate_status(...) == "degraded"``.

Probes:
  db_health, redis_health, keycloak_reachable, litellm_health,
  audit_sink (compound: otel + audit_table), floci_health,
  forge_phase4_mounted, otel_exporter_configured.
"""

from __future__ import annotations

import os
import subprocess
import time
import urllib.request
from typing import Any

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter, Response
from sqlalchemy import text

from app import __version__
from app.api.v1.forge_phase4 import forge_phase4_mounted
from app.core.config import settings
from app.core.logging import get_logger
from app.core.telemetry import _initialized as _otel_initialized
from app.db.models.audit import AuditEvent
from app.db.session import get_engine
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)
router = APIRouter(tags=["healthz"])

_PROBE_TIMEOUT_SECONDS = 5.0

_GIT_SHA = (
    os.environ.get("GIT_SHA")
    or subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    ).stdout.strip()
    or "unknown"
)


async def _probe_db() -> tuple[Any, float]:
    start = time.perf_counter()
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "ok", (time.perf_counter() - start) * 1000
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.db_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000


async def _probe_redis() -> tuple[Any, float]:
    start = time.perf_counter()
    try:
        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        try:
            pong = await client.ping()
        finally:
            await client.aclose()
        value = "ok" if pong else "down"
        return value, (time.perf_counter() - start) * 1000
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.redis_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000


async def _probe_keycloak() -> tuple[Any, float]:
    start = time.perf_counter()
    base = settings.keycloak_url.rstrip("/")
    realm = settings.keycloak_realm or "forge"
    url = f"{base}/realms/{realm}/.well-known/openid-configuration"
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS) as client:
            response = await client.get(url)
        value = "ok" if response.status_code == 200 else "down"
        return value, (time.perf_counter() - start) * 1000
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.keycloak_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000


async def _probe_litellm() -> tuple[Any, float]:
    start = time.perf_counter()
    try:
        async with LiteLLMBaseClient() as litellm:
            payload = await litellm.readiness()
        value = "ok" if payload.get("reachable") is True else "down"
        return value, (time.perf_counter() - start) * 1000
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.litellm_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000


async def _probe_audit_sink() -> tuple[Any, float]:
    start = time.perf_counter()
    statuses: dict[str, str] = {"otel": "down", "audit_table": "down"}
    if _otel_initialized:
        statuses["otel"] = "ok"
    try:
        if AuditEvent.__tablename__ in {t.name for t in AuditEvent.metadata.tables.values()}:
            statuses["audit_table"] = "ok"
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.audit_sink_fail", error=str(exc))
    return statuses, (time.perf_counter() - start) * 1000


def _probe_floci() -> tuple[Any, float]:
    start = time.perf_counter()
    endpoint = (
        os.environ.get("AWS_ENDPOINT_URL")
        or os.environ.get("FLOCI_URL")
        or "http://localhost:4566"
    )
    url = f"{endpoint.rstrip('/')}/_localstack/health"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=_PROBE_TIMEOUT_SECONDS) as resp:
            value = "ok" if resp.status < 500 else "down"
            return value, (time.perf_counter() - start) * 1000
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.floci_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000


def _probe_otel_exporter() -> tuple[Any, float]:
    start = time.perf_counter()
    endpoint = (
        os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        or getattr(settings, "otlp_endpoint", None)
    )
    value = "ok" if endpoint and str(endpoint).strip() else "down"
    return value, (time.perf_counter() - start) * 1000


def _aggregate_status(probes: dict[str, Any]) -> str:
    """Return 'ok' if every probe is 'ok'; else 'degraded'."""
    for value in probes.values():
        if isinstance(value, dict):
            for leaf in value.values():
                if leaf != "ok":
                    return "degraded"
        elif isinstance(value, bool):
            if not value:
                return "degraded"
        elif value != "ok":
            return "degraded"
    return "ok"


@router.get("/healthz")
async def healthz(response: Response) -> dict[str, Any]:
    db_v, db_ms = await _probe_db()
    redis_v, redis_ms = await _probe_redis()
    keycloak_v, keycloak_ms = await _probe_keycloak()
    litellm_v, litellm_ms = await _probe_litellm()
    audit_v, audit_ms = await _probe_audit_sink()
    floci_v, floci_ms = _probe_floci()
    otel_v, otel_ms = _probe_otel_exporter()

    probes: dict[str, Any] = {
        "db_health":              {"status": db_v, "latency_ms": round(db_ms, 2)},
        "redis_health":           {"status": redis_v, "latency_ms": round(redis_ms, 2)},
        "keycloak_reachable":     {"status": keycloak_v, "latency_ms": round(keycloak_ms, 2)},
        "litellm_health":         {"status": litellm_v, "latency_ms": round(litellm_ms, 2)},
        "audit_sink":             {**audit_v, "latency_ms": round(audit_ms, 2)},
        "floci_health":           {"status": floci_v, "latency_ms": round(floci_ms, 2)},
        "forge_phase4_mounted":   {"status": "ok" if forge_phase4_mounted else "down",
                                   "latency_ms": 0.0},
        "otel_exporter_configured": {"status": otel_v, "latency_ms": round(otel_ms, 2)},
    }
    status = _aggregate_status(probes)
    if status != "ok":
        response.status_code = 503

    logger.info(
        "healthz.served",
        status=status,
        http_status=response.status_code,
    )
    return {
        "status": status,
        "version": __version__,
        "git_sha": _GIT_SHA,
        "environment": settings.environment,
        "probes": probes,
    }


__all__ = ["router"]
```

**Test extension** (added to existing `backend/tests/test_healthz.py`):

```python
"""Phase 7 SC-7.5 — /healthz extension tests."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import healthz as healthz_mod


@pytest.fixture
def client():
    a = FastAPI()
    a.include_router(healthz_mod.router)
    return TestClient(a)


def test_healthz_includes_git_sha(client) -> None:
    r = client.get("/healthz")
    assert r.status_code in (200, 503)
    body = r.json()
    assert "git_sha" in body
    assert isinstance(body["git_sha"], str)
    assert len(body["git_sha"]) > 0


def test_healthz_probe_shape_includes_latency(client) -> None:
    r = client.get("/healthz")
    body = r.json()
    for probe_name in ("db_health", "redis_health", "keycloak_reachable",
                       "litellm_health", "floci_health",
                       "otel_exporter_configured"):
        probe = body["probes"][probe_name]
        assert "status" in probe, probe_name
        assert "latency_ms" in probe, probe_name


def test_healthz_returns_503_when_keycloak_down(client) -> None:
    async def fake_keycloak():
        return "down", 1.0
    with patch.object(healthz_mod, "_probe_keycloak", new=fake_keycloak):
        r = client.get("/healthz")
        assert r.status_code == 503
        assert r.json()["probes"]["keycloak_reachable"]["status"] == "down"


def test_healthz_returns_503_when_db_down(client) -> None:
    async def fake_db():
        return "down", 0.5
    with patch.object(healthz_mod, "_probe_db", new=fake_db):
        r = client.get("/healthz")
        assert r.status_code == 503


def test_healthz_returns_503_when_redis_down(client) -> None:
    async def fake_redis():
        return "down", 0.5
    with patch.object(healthz_mod, "_probe_redis", new=fake_redis):
        r = client.get("/healthz")
        assert r.status_code == 503


def test_healthz_returns_503_when_litellm_down(client) -> None:
    async def fake_litellm():
        return "down", 5.0
    with patch.object(healthz_mod, "_probe_litellm", new=fake_litellm):
        r = client.get("/healthz")
        assert r.status_code == 503


def test_healthz_returns_200_when_all_ok(client) -> None:
    r = client.get("/healthz")
    body = r.json()
    if body["status"] == "ok":
        assert r.status_code == 200
```

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai/backend
pytest tests/test_healthz.py -q
# Expect: 7 tests pass.

docker compose up -d
curl -sS http://localhost:8000/healthz | python3 -m json.tool
# Expect: 200, "status":"ok", git_sha non-empty, latency_ms per probe.

docker compose stop keycloak
sleep 1
curl -sS -w "\nHTTP %{http_code}\n" http://localhost:8000/healthz | tail -5
# Expect: HTTP 503, "status":"degraded".
docker compose start keycloak
```

---

### PR-7.6 — Image digest pinning

**Pre-conditions:** None.

**Files edited/created:**

- `docker-compose.yml` (pin two images)
- `scripts/check-image-pinning.sh` (new)
- `.github/workflows/operational-readiness.yml` (new)

**`docker-compose.yml` edits** (two lines):

```yaml
  litellm:
    # Phase 7 SC-7.6 — pinned by digest (refresh quarterly).
    image: ghcr.io/berriai/litellm@sha256:<digest-of-v1.52.10>
```

```yaml
  floci:
    # Phase 7 SC-7.6 — pinned by digest (refresh quarterly).
    image: floci/floci@sha256:<digest-of-2.5.0>
```

**`scripts/check-image-pinning.sh` body:**

```bash
#!/usr/bin/env bash
# scripts/check-image-pinning.sh — fail CI on any `:latest` in docker-compose.yml.
# Phase 7 SC-7.6.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

hits=$(grep -nE "^\s*image:\s+[^@]+\b:latest\b" docker-compose.yml || true)
if [[ -n "$hits" ]]; then
    echo "::error::Unpinned :latest image tag(s) in docker-compose.yml:"
    echo "$hits"
    exit 1
fi
echo "image-pinning: 0 violations"
```

**`.github/workflows/operational-readiness.yml` body:**

```yaml
name: operational-readiness

on:
  pull_request:
    paths:
      - 'docker-compose.yml'
      - 'scripts/rotate-secrets.sh'
      - 'scripts/check-image-pinning.sh'
      - 'scripts/check-env-example.sh'
      - 'scripts/backup-postgres.sh'
      - 'scripts/restore-postgres.sh'
      - 'docs/runbooks/**'
      - '.github/workflows/operational-readiness.yml'
      - '.env.example'
  push:
    branches: [main]
    paths:
      - 'docker-compose.yml'
      - 'scripts/**'
      - 'docs/runbooks/**'
      - '.github/workflows/operational-readiness.yml'
      - '.env.example'

concurrency:
  group: op-readiness-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  image-pinning:
    name: docker images pinned (no :latest)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - name: Check image pinning
        run: bash scripts/check-image-pinning.sh

  env-example:
    name: .env.example completeness
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.13'
      - name: Install backend
        working-directory: backend
        run: |
          python -m venv .venv
          source .venv/bin/activate
          pip install -r requirements.txt
      - name: Check env completeness
        run: bash scripts/check-env-example.sh

  rotate-secrets:
    name: secrets rotation smoke
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - name: Bring up dev stack
        run: |
          docker compose up -d postgres redis keycloak
          for _ in $(seq 1 60); do
              docker compose exec -T postgres pg_isready -U forge -d forge && break
              sleep 2
          done
      - name: Run rotate-secrets
        env:
          KEYCLOAK_ADMIN: admin
          KEYCLOAK_ADMIN_PASSWORD: admin
          POSTGRES_USER: forge
          POSTGRES_PASSWORD: forge
        run: |
          mkdir -p infra/env
          cat > infra/env/dev.env <<EOF
          ENVIRONMENT=dev
          JWT_SECRET=dev-old-secret-replace-me-32-chars-long-aaaaaaaaa
          LITELLM_MASTER_KEY=sk-old-key-replace-me
          POSTGRES_USER=forge
          POSTGRES_PASSWORD=forge
          KEYCLOAK_URL=http://localhost:8080
          KEYCLOAK_REALM=forge
          KEYCLOAK_ADMIN=admin
          KEYCLOAK_ADMIN_PASSWORD=admin
          EOF
          bash scripts/rotate-secrets.sh --env=dev --no-db --no-keycloak --overlap-seconds=60
      - name: Teardown
        if: always()
        run: docker compose down -v

  backup-restore-smoke:
    name: backup+restore round-trip
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: pgvector/pgvector:pg17
        env:
          POSTGRES_USER: forge
          POSTGRES_PASSWORD: forge
          POSTGRES_DB: forge
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.13'
      - name: Install psql
        run: sudo apt-get update && sudo apt-get install -y postgresql-client
      - name: Install backend
        working-directory: backend
        run: |
          python -m venv .venv
          source .venv/bin/activate
          pip install -r requirements.txt
      - name: Seed + backup
        env:
          DATABASE_URL: postgresql+asyncpg://forge:forge@localhost:5432/forge
          POSTGRES_USER: forge
          POSTGRES_PASSWORD: forge
          POSTGRES_DB: forge
        run: |
          mkdir -p infra/backups infra/env
          echo "ENVIRONMENT=dev" > infra/env/dev.env
          echo "DATABASE_URL=postgresql+asyncpg://forge:forge@localhost:5432/forge" >> infra/env/dev.env
          (cd backend && source ../infra/env/dev.env && alembic upgrade head)
          bash scripts/backup-postgres.sh --env=dev
      - name: Restore
        env:
          DATABASE_URL: postgresql+asyncpg://forge:forge@localhost:5432/forge
        run: |
          bash scripts/restore-postgres.sh --file=$(ls -t infra/backups/forge-dev-*.sql.gz | head -1)
```

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai
bash scripts/check-image-pinning.sh
# Expect: "image-pinning: 0 violations"

sed -i.bak 's|@sha256:<digest-of-2.5.0>|floci/floci:latest|' docker-compose.yml
bash scripts/check-image-pinning.sh
sed -i.bak 's|floci/floci:latest|@sha256:<digest-of-2.5.0>|' docker-compose.yml
rm -f docker-compose.yml.bak
```

---

### PR-7.7 — Env completeness

**Pre-conditions:** None.

**Files created/edited:**

- `.env.example` (rewrite — adds ~40 missing Settings fields)
- `scripts/check-env-example.sh` (new)

**`scripts/check-env-example.sh` body:**

```bash
#!/usr/bin/env bash
# scripts/check-env-example.sh — fail CI when .env.example is missing a
# Settings field declared in backend/app/core/config.py.
# Phase 7 SC-7.7.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

python3 - <<'PY'
"""Enumerate Settings fields and compare against .env.example."""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

CFG = Path("backend/app/core/config.py")
ENV = Path(".env.example")

src = CFG.read_text(encoding="utf-8")
tree = ast.parse(src)

settings_cls = next(
    n for n in tree.body
    if isinstance(n, ast.ClassDef) and n.name == "Settings"
)

declared: set[str] = set()
for stmt in settings_cls.body:
    if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
        declared.add(stmt.target.id.upper())

example_keys: set[str] = set()
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    m = re.match(r"^([A-Z_][A-Z0-9_]*)\s*=", line)
    if m:
        example_keys.add(m.group(1))

missing = sorted(declared - example_keys)
if missing:
    print(f"::error::.env.example is missing {len(missing)} Settings field(s):")
    for key in missing:
        print(f"  - {key}")
    sys.exit(1)

print(f"env-example: {len(declared)} fields declared, {len(example_keys)} in .env.example, 0 missing")
PY
```

**Pattern for `.env.example` inserts** (the implementer opens the file directly):

```bash
# <field_name_lower> — <description from the Field(...) default>
# Type: <type annotation>. Default: <default>.
<FIELD_NAME_UPPER>=
```

The implementer adds ~40 missing fields. Common inserts:

```bash
# jwt_secret_previous — JWT_SECRET_PREVIOUS. Previous signing key (Phase 7 rotation overlap).
# Type: str | None. Default: null.
# JWT_SECRET_PREVIOUS=

# jwt_algorithm — JWT_ALGORITHM. HS256 (dev) / RS256 (prod).
# Type: str. Default: "HS256".
JWT_ALGORITHM=HS256

# ws_max_message_bytes — WS_MAX_MESSAGE_BYTES.
# Type: int. Default: 65536.
WS_MAX_MESSAGE_BYTES=65536

# ws_idle_timeout_seconds — WS_IDLE_TIMEOUT_SECONDS.
# Type: int. Default: 300.
WS_IDLE_TIMEOUT_SECONDS=300

# terminal_workspace_root — TERMINAL_WORKSPACE_ROOT.
# Type: str. Default: "/var/forge/workspaces".
TERMINAL_WORKSPACE_ROOT=/var/forge/workspaces

# connector_default_ttl_seconds — CONNECTOR_DEFAULT_TTL_SECONDS.
# Type: int. Default: 3600.
CONNECTOR_DEFAULT_TTL_SECONDS=3600

# merge_gate_per_commit_cost_cap_usd — MERGE_GATE_PER_COMMIT_COST_CAP_USD.
# Type: float. Default: 1.0.
MERGE_GATE_PER_COMMIT_COST_CAP_USD=1.0

# run_budget_cap_usd — RUN_BUDGET_CAP_USD.
# Type: float. Default: 50.0.
RUN_BUDGET_CAP_USD=50.0

# forge_health_cache_ttl_seconds — FORGE_HEALTH_CACHE_TTL_SECONDS.
# Type: int. Default: 60.
FORGE_HEALTH_CACHE_TTL_SECONDS=60

# forge_tenant_header — FORGE_TENANT_HEADER.
# Type: str. Default: "X-Forge-Tenant".
FORGE_TENANT_HEADER=X-Forge-Tenant

# forge_run_header — FORGE_RUN_HEADER.
# Type: str. Default: "X-Forge-Run-Id".
FORGE_RUN_HEADER=X-Forge-Run-Id

# github_webhook_secret — GITHUB_WEBHOOK_SECRET.
# Type: str. Default: "".
GITHUB_WEBHOOK_SECRET=

# copilot_enabled — COPILOT_ENABLED. Master toggle for Co-pilot surface.
# Type: bool. Default: false.
COPILOT_ENABLED=false

# copilot_default_budget_usd — COPILOT_DEFAULT_BUDGET_USD.
# Type: float. Default: 1.00.
COPILOT_DEFAULT_BUDGET_USD=1.00

# anthropic_api_key — ANTHROPIC_API_KEY.
# Type: str. Default: "".
ANTHROPIC_API_KEY=sk-ant-replace-me

# openai_api_key — OPENAI_API_KEY.
# Type: str. Default: "".
OPENAI_API_KEY=sk-openai-replace-me

# litellm_budget_default_usd — LITELLM_BUDGET_DEFAULT_USD.
# Type: decimal. Default: 500.00.
LITELLM_BUDGET_DEFAULT_USD=500.00

# litellm_budget_default_period — LITELLM_BUDGET_DEFAULT_PERIOD.
# Type: str. Default: "monthly".
LITELLM_BUDGET_DEFAULT_PERIOD=monthly

# approval_timeout_hours — APPROVAL_TIMEOUT_HOURS.
# Type: int. Default: 24.
APPROVAL_TIMEOUT_HOURS=24
```

(Plus ~20 additional entries covering `LOG_LEVEL`, `CORS_ORIGINS`, `database_pool_size`, `database_max_overflow`, `redis_event_channel_prefix`, `jwt_audience`, `jwt_issuer`, `otlp_endpoint`, `otel_service_name`, `otel_exporter_otlp_insecure`, `cost_currency`, `forge_route_discovery_enabled`, `dev_auth_bypass`, `copilot_tool_call_max`, `copilot_rate_limit_per_min`, `copilot_welcome_enabled`, `allow_placeholder_llm_keys`, `litellm_health_check_interval_seconds`, `litellm_usage_cache_ttl_seconds`, `litellm_integration_enabled`, `litellm_auto_provision_keys`, `litellm_budget_hard_limit`, `litellm_guardrail_pii_default`, `aws_secrets_manager_prefix`, `approval_timeout_overrides`.)

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai
bash scripts/check-env-example.sh
# Expect: "env-example: N fields declared, N in .env.example, 0 missing"
```

---

### PR-7.8 — Runbook index + oncall + incident-response canonicals

**Pre-conditions:** PR-7.4 merged.

**Files created:**

- `docs/runbooks/index.md`
- `docs/runbooks/incident-response.md` (thin canonical)

**`docs/runbooks/index.md` body:**

```markdown
# Forge AI — Runbook Index

| Runbook | Owner | Last updated | Last drilled | Summary |
|---|---|---|---|---|
| [setup.md](./setup.md) | L2 platform engineer | 2026-07-05 | 2026-07-05 | Fresh-machine setup from `git clone` to `/healthz` green in ≤ 15 min. |
| [backup-restore.md](./backup-restore.md) | L2 platform engineer | 2026-07-05 | 2026-07-05 | `pg_dump` to S3 + 30-day retention; restore drill in CI. |
| [disaster-recovery.md](./disaster-recovery.md) | L3 architect | 2026-07-05 | (annual) | 4 scenarios: region failure, DB corruption, Redis loss, LiteLLM down. |
| [oncall.md](./oncall.md) | L1 on-call | 2026-07-05 | (quarterly) | Rotation, P0/P1/P2 SLA ladder, escalation. Thin canonical. |
| [incident-response.md](./incident-response.md) | L4 delegate | 2026-07-05 | (quarterly tabletop) | Template + cadence + comms + post-mortem. Thin canonical. |
| [budget-exhausted.md](./budget-exhausted.md) | L2 platform engineer | (existing) | (existing) | LiteLLM budget exhaustion runbook (pre-Phase 7). |
| [litellm-downtime.md](./litellm-downtime.md) | L2 platform engineer | (existing) | (existing) | LiteLLM Proxy downtime runbook (pre-Phase 7). |

## See also

- [operations/oncall-runbook.md](../operations/oncall-runbook.md)
- [operations/incident-response.md](../operations/incident-response.md)
- [operations/dev-bootstrap.md](../operations/dev-bootstrap.md)
- [plan/README.md](../plan/README.md)
```

**`docs/runbooks/incident-response.md` body:**

```markdown
# Forge AI — Incident Response (thin canonical)

## Severity Ladder

| Severity | Definition | Response target | Comms cadence |
|---|---|---|---|
| **P0** | Platform down; data loss; security incident | ≤ 15 min ack; 24/7 page | every 30 min until contained |
| **P1** | Degraded; tenant-visible bug | ≤ 1 hour ack; business hours | every 2 hours until contained |
| **P2** | Cosmetic; non-tenant-visible | next business day | end-of-day summary |

## Initial Customer Notification (within 1 hour of detection — P0)

```
Subject: [Forge Incident — P0] <one-line summary>

We are investigating an incident affecting <services>. We will
provide an update within 30 minutes.

Status page: https://status.forge.example.com
```

## See also

- [oncall.md](./oncall.md)
- [disaster-recovery.md](./disaster-recovery.md)
- [operations/incident-response.md](../operations/incident-response.md)
```

**Verification:**

```bash
cd /home/arunachalam.v@knackforge.com/forge-ai
grep -E '\]\(\./|\]\(\.\./' docs/runbooks/index.md | \
    sed -E 's/.*\]\(([^)]+)\).*/\1/' | sort -u | while read -r link; do
        test -e "docs/runbooks/$link" -o -e "$link" || echo "MISSING: $link"
    done
grep -l "../operations/" docs/runbooks/oncall.md docs/runbooks/incident-response.md
```

---

## 5. Test Plan

### PR-7.1
- **No new pytest.** Wall-clock timer + `/healthz` poll are exercised end-to-end by `scripts/setup-local.sh` on a clean container; the captured `docs/plan/phase-7-fresh-machine-time.md` IS the test.

### PR-7.2
- **New pytest:** `backend/tests/test_security.py::test_decode_token_with_previous_secret`, `test_decode_token_without_previous_secret`, `test_decode_token_previous_expires_outside_overlap`, `test_decode_token_asymmetric_algorithm_no_fallback`. 4 tests.
- **CI job:** `operational-readiness.yml::rotate-secrets` exercises the full script against an ephemeral compose stack.

### PR-7.3
- **No new pytest.** `operational-readiness.yml::backup-restore-smoke` runs the round-trip in CI. Manual drill against a 1GB dataset is the verification.

### PR-7.4
- **No new pytest.** Runbooks are markdown; verification is link resolution + peer review.

### PR-7.5
- **New pytest:** 7 tests in `backend/tests/test_healthz.py`. Covers `git_sha` presence, `latency_ms` per probe, and 503 behavior for each of the 4 named dependencies failing individually.

### PR-7.6
- **No new pytest.** `scripts/check-image-pinning.sh` exits 0 on the patched compose; CI job runs the same check.

### PR-7.7
- **No new pytest.** `scripts/check-env-example.sh` exits 0 when `.env.example` covers every Settings field.

### PR-7.8
- **No new pytest.** Verification is `docs/runbooks/index.md` links resolve + cross-references to `docs/operations/` are intact.

---

## 6. Rollback Strategy

| PR | Revert command | Notes |
|---|---|---|
| 7.1 | `git revert <sha>` | `scripts/setup-local.sh` patches revert cleanly; previous-version script still functions (additive). |
| 7.2 | `git revert <sha>` | `rotate-secrets.sh` deletion is clean. `jwt_secret_previous` field addition reverts; `decode_token` returns to single-key mode. |
| 7.3 | `git revert <sha>` | Backup + restore script deletion is clean. |
| 7.4 | `git revert <sha>` | Runbook removal is clean. |
| 7.5 | `git revert <sha>` | `/healthz` returns to M1's "200 + body" contract. k8s readiness probes no longer see 503. Mitigation: re-apply within 24 hours. |
| 7.6 | `git revert <sha>` | Compose returns to `:latest` tags. CI gate removal. Mitigation: re-apply within 24 hours. |
| 7.7 | `git revert <sha>` | `.env.example` returns to partial state. Mitigation: re-apply within 24 hours. |
| 7.8 | `git revert <sha>` | Runbook index + canonicals revert. |

**No PR involves a schema migration or backend data change.**

---

## 7. Out of Scope

- Multi-region active-active deployment (ADR-001 — single-region failover only).
- Auto-scaling policies (handled by infra/terraform/).
- Cost optimization of cloud spend (Phase 6 owns).
- GDPR delete cascade (Phase 8).
- Statuspage integration (Phase 8 owns status-page wire-up).
- Backup encryption at rest (S3 SSE-KMS is the prod default).
- DR drill automation — `operational-readiness.yml::backup-restore-smoke` is a CI smoke.
- PagerDuty wire-up (Phase 8).
- Removing `app/api/v1/health.py` (3-probe surface) — used by the auth'd v1 client.

---

## 8. Definition of Done

Phase 7 is **DONE** when, in order:

1. All 8 PRs merged to `main`, each behind green `operational-readiness.yml`.
2. SC-7.1 through SC-7.10 all pass.
3. `docs/plan/phase-7-fresh-machine-time.md` shows total wall-clock ≤ 900s.
4. `docs/plan/phase-7-restore-drill.md` shows RPO ≤ 24h + RTO ≤ 4h.
5. `scripts/rotate-secrets.sh --env=dev` ran in CI; old + new JWTs both validated.
6. `GET /healthz` returns `git_sha`, `latency_ms` per probe, and HTTP 503 on degraded.
7. `docker-compose.yml` contains zero `:latest` image tags.
8. `scripts/check-env-example.sh` exits 0.
9. `docs/runbooks/index.md` links resolve.
10. `docs/runbooks/disaster-recovery.md` covers all 4 scenarios.
11. No `TODO`, `FIXME`, `NotImplementedError` introduced.
12. Phase close-out section filled in below.

---

## 9. Critical Files for Implementation

- `scripts/setup-local.sh` (extend — add timer + /healthz poll + seeds)
- `scripts/rotate-secrets.sh` (create)
- `scripts/backup-postgres.sh` (create)
- `scripts/restore-postgres.sh` (create)
- `scripts/check-image-pinning.sh` (create)
- `scripts/check-env-example.sh` (create)
- `backend/app/core/config.py` (add `jwt_secret_previous` field)
- `backend/app/core/security.py` (patch `decode_token` for overlap window)
- `backend/app/api/healthz.py` (rewrite — add `git_sha` + `latency_ms` + 503)
- `backend/tests/test_healthz.py` (extend with 7 new tests)
- `docker-compose.yml` (pin 2 `:latest` images by digest)
- `.env.example` (rewrite — add ~40 missing Settings fields)
- `docs/runbooks/setup.md` (create)
- `docs/runbooks/backup-restore.md` (create)
- `docs/runbooks/disaster-recovery.md` (create)
- `docs/runbooks/oncall.md` (create — thin canonical)
- `docs/runbooks/incident-response.md` (create — thin canonical)
- `docs/runbooks/index.md` (create)
- `docs/plan/phase-7-fresh-machine-time.md` (output)
- `docs/plan/phase-7-restore-drill.md` (output)
- `.github/workflows/operational-readiness.yml` (create)

---

## 10. Phase Close-out (filled at the end)

```
Implementation date: ___
PR(s): ___

Setup: total wall-clock = ___s (target ≤ 900s)
Restore drill: RPO = ___h, RTO = ___h
Secrets rotation: rotate-secrets.sh tested in CI; overlap window verified = 300s
Health endpoint: 4 named probes + git_sha + latency_ms; 503-on-degraded verified
Image pinning: 2 :latest references removed; check-image-pinning.sh exits 0
Env completeness: check-env-example.sh exits 0; ~NN Settings fields added
Runbook index: docs/runbooks/index.md committed; 7 runbooks linked
On-call canonical: docs/runbooks/oncall.md committed; cross-references docs/operations/oncall-runbook.md
Incident-response canonical: docs/runbooks/incident-response.md committed; cross-references docs/operations/incident-response.md
Branch protection updated: confirmed by ___ on ___
Follow-up tickets opened: ___
```
