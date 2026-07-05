# Phase 7 — Operational Readiness

**Status:** PENDING
**Owner:** TBA
**Depends on:** Phase 4 (migrations safe), Phase 6 (budgets)
**Blocks:** Phase 8

---

## Goal

A new operator can stand up the full stack, rotate secrets, restore from backup, and survive a region failure — all without paging the original team.

## Why seventh

- After Phase 6, the system is production-grade in code. Phase 7 makes it operable.
- "It works on my machine" is the most common 3am-page generator. Phase 7 makes the machine reproducible.

## Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-7.1 | Fresh-machine setup from `git clone` to running app ≤ 15 minutes | `scripts/setup-fresh-machine.sh` runs end-to-end and is timed |
| SC-7.2 | Secrets rotation script (`scripts/rotate-secrets.sh`) rotates JWT signing key, LiteLLM master key, DB password; tested in CI | CI runs the rotation in ephemeral env; all dependent services re-auth without restart |
| SC-7.3 | Postgres backup + restore runbook (`docs/runbooks/backup-restore.md`) tested end-to-end | restore-from-backup drill completes in < 1 hour with documented steps |
| SC-7.4 | Disaster recovery runbook covers: region failure, DB corruption, Redis loss | `docs/runbooks/disaster-recovery.md` committed, peer-reviewed |
| SC-7.5 | Health check endpoint `/health` returns per-component status (DB, Redis, LiteLLM, Keycloak) with version + git SHA | `curl /health` returns JSON with all four |
| SC-7.6 | Docker images pinned by digest in `docker-compose.yml`; no `latest` tag | `grep -E "image:.*:latest" docker-compose.yml` returns empty |
| SC-7.7 | All runbooks linked from `docs/runbooks/index.md` | file committed, links resolve |
| SC-7.8 | `.env.example` is complete; no missing vars compared to `.env` template | `scripts/check-env-example.sh` exits 0 |
| SC-7.9 | On-call rotation: `docs/runbooks/oncall.md` defines P0/P1/P2 response times + escalation | file committed |
| SC-7.10 | Status page: integration with Statuspage or self-hosted; incident template | `docs/runbooks/incident-response.md` |

## Tasks

### T7.1 — Fresh-machine setup
- T7.1.1 Author `scripts/setup-fresh-machine.sh`:
  - install pnpm, python 3.13, docker, psql, redis-cli
  - `cp .env.example .env.local`
  - `docker compose up -d postgres redis keycloak litellm`
  - `pnpm install`
  - `pip install -r backend/requirements.txt`
  - `alembic upgrade head`
  - `python -m seeds`
  - `pnpm dev:stack` (in background)
  - polls `/health` until green
- T7.1.2 Time the run; document in `docs/runbooks/setup.md`.
- T7.1.3 If > 15 min, profile the slowest step and optimize (parallel docker pulls, pre-built wheels).

### T7.2 — Secrets rotation
- T7.2.1 Author `scripts/rotate-secrets.sh`:
  - generate new JWT signing key
  - generate new LiteLLM master key
  - generate new DB password
  - update Keycloak client secret
  - write new values to `.env.local` (and to a secrets manager in prod)
  - reload affected services (or note which need restart)
- T7.2.2 CI test: rotate secrets in ephemeral env; assert dependent services (FastAPI, LiteLLM) re-auth without manual restart.

### T7.3 — Backup + restore
- T7.3.1 Author `scripts/backup-postgres.sh`:
  - `pg_dump` to timestamped file in `infra/backups/`
  - upload to S3 (or configured backend) with retention 30 days
- T7.3.2 Author `scripts/restore-postgres.sh`:
  - takes backup file path
  - drops + recreates target DB
  - loads dump
  - runs alembic upgrade head (idempotent)
- T7.3.3 Drill: corrupt dev DB, run restore, verify app boots.
- T7.3.4 Author `docs/runbooks/backup-restore.md` with step-by-step.

### T7.4 — Disaster recovery runbook
- T7.4.1 Author `docs/runbooks/disaster-recovery.md` covering:
  - region failure: switch DNS, restore DB to new region, warm caches
  - DB corruption: identify last good backup, restore, reconcile audit log gaps
  - Redis loss: rebuild from Postgres (cost ledger, rate limit counters re-warm)
  - LiteLLM down: serve 503 from queue (Phase 6 capability); on-call escalation
- T7.4.2 Each scenario has: trigger, detection, mitigation, RTO/RPO target, owner.

### T7.5 — Health endpoint detail
- T7.5.1 `GET /health` returns:
  ```json
  {
    "status": "ok",
    "version": "0.x.y",
    "git_sha": "...",
    "components": {
      "postgres": {"status": "ok", "latency_ms": 3},
      "redis": {"status": "ok", "latency_ms": 1},
      "litellm": {"status": "ok", "latency_ms": 50},
      "keycloak": {"status": "ok", "latency_ms": 12}
    }
  }
  ```
- T7.5.2 Returns 503 if any component degraded (latency > threshold or error).
- T7.5.3 Tested with each component killed in turn.

### T7.6 — Pin image versions
- T7.6.1 Replace every `:latest` in `docker-compose.yml` with a pinned digest or semver tag.
- T7.6.2 Add `scripts/check-image-pinning.sh` to CI.

### T7.7 — Env completeness
- T7.7.1 Diff `.env.example` against required env vars (derived from `app/core/config.py`).
- T7.7.2 Add missing entries to `.env.example` with comments.

### T7.8 — Runbook index
- T7.8.1 `docs/runbooks/index.md` lists every runbook with one-line summary + link.
- T7.8.2 Each runbook has owner + last-updated date + last-drilled date.

### T7.9 — On-call rotation
- T7.9.1 Author `docs/runbooks/oncall.md`:
  - rotation schedule template (one-week shifts)
  - P0 response: 15 min ack, 24/7 page
  - P1 response: 1 hour ack, business hours page
  - P2 response: next business day
  - escalation: primary → secondary → manager
  - handoff document template

### T7.10 — Incident response
- T7.10.1 Author `docs/runbooks/incident-response.md`:
  - incident template (title, severity, summary, timeline, root cause, remediation)
  - status-page update cadence
  - customer comms templates (P0 / P1)
  - post-mortem template

## Files Touched

| File | Action |
|------|--------|
| `scripts/setup-fresh-machine.sh` | create |
| `scripts/rotate-secrets.sh` | create |
| `scripts/backup-postgres.sh` | create |
| `scripts/restore-postgres.sh` | create |
| `scripts/check-image-pinning.sh` | create |
| `scripts/check-env-example.sh` | create |
| `backend/app/api/v1/health.py` | edit (detail) |
| `docker-compose.yml` | edit (pin images) |
| `.env.example` | edit (completeness) |
| `docs/runbooks/setup.md` | create |
| `docs/runbooks/backup-restore.md` | create |
| `docs/runbooks/disaster-recovery.md` | create |
| `docs/runbooks/oncall.md` | create |
| `docs/runbooks/incident-response.md` | create |
| `docs/runbooks/index.md` | create |
| `docs/plan/phase-7-fresh-machine-time.md` | create (output) |
| `docs/plan/phase-7-restore-drill.md` | create (output) |

## Risks

| Risk | Mitigation |
|------|-----------|
| Backup file size grows unbounded | Implement retention + compression; alert at 80% quota |
| Restore takes longer than 1 hour | Benchmark; if RTO > 1h, switch to logical replication + WAL archiving |
| Secrets rotation causes brief downtime | Use overlap window: old + new keys valid for 5 min during rotation |
| Runbooks rot as the system evolves | Each runbook has "Last verified" date; quarterly review cycle |
| Image digest pinning breaks reproducibility on registry changes | Document a fallback to semver pinning + manual digest update runbook |

## Out of Scope

- Multi-region active-active (single-region failover only).
- Auto-scaling policies.
- Cost optimization of cloud spend.

## Definition of Done

- 15-min fresh setup proven.
- Secrets rotation script tested in CI.
- Restore drill succeeds.
- DR runbook peer-reviewed.
- Health endpoint returns per-component status.
- On-call + incident response runbooks published.