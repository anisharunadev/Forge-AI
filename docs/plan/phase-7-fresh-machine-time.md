# Phase 7 — Fresh-machine setup timing (PR-7.1)

> Captured by the extended `scripts/setup-local.sh` run. The script
> writes this file at the end of every invocation; values below
> reflect the most recent capture on the working tree.

## Status

- PR-7.1 implementation merged: setup-local.sh records wall-clock per step
  and polls `/healthz` until `status: ok`.
- `docs/plan/phase-7-fresh-machine-time.md` is regenerated on every
  invocation; the table below shows the **latest** capture.
- For a baseline measurement run the script end-to-end on a clean
  checkout; the target is **≤ 900s wall-clock** (SC-7.1).

## Latest capture

| Field | Value |
|---|---|
| Captured (UTC) | 2026-07-06T00:00:00Z (placeholder) |
| Total wall-clock | _to be measured on next clean-machine run_ |
| `/healthz` final | `status=ok` (SC-7.5 verified by `tests/test_healthz.py`) |

## Per-step instrumentation

| Step | Description |
|---|---|
| `prerequisites` | docker, docker compose v2, python 3.13+, pnpm 9+, node 20+ |
| `env-bootstrap` | copy `.env.example` → `.env`, source env |
| `docker-pull` | `docker compose pull` |
| `docker-up` | `docker compose up -d --remove-orphans` |
| `wait-postgres` | `pg_isready` poll, ≤ 120s |
| `wait-keycloak` | TCP + HTTP probe, ≤ 120s |
| `wait-floci` | `/_localstack/health` probe, ≤ 120s |
| `wait-docs-site` | docs-site spider, ≤ 60s |
| `alembic-upgrade` | `alembic upgrade head` |
| `seeds` | `python -m seeds` (idempotent) |
| `pip-install` | `pip install -r backend/requirements.txt` |
| `pnpm-install` | `pnpm install --filter @forge/forge...` |
| `healthz-poll` | curl `/healthz` until `status=ok`, ≤ 120s |

## How to re-capture

```bash
docker compose down -v                 # wipe state
bash scripts/setup-local.sh            # captures the wall-clock
cat docs/plan/phase-7-fresh-machine-time.md
```

## Acceptance

- **SC-7.1**: total wall-clock ≤ 900s. Tracked per-run in the table
  above; the script itself fails non-zero when `/healthz` does not
  report `ok` within 120s.
