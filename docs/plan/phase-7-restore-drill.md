# Phase 7 — Restore drill template (PR-7.3)

> Filled in by the L2 platform engineer after every backup-restore
> drill. Targets come from SC-7.3 (RPO ≤ 24h, RTO ≤ 4h).

## Latest drill

| Metric | Value | Target | Pass? |
|---|---|---|---|
| Captured (UTC) | 2026-07-06T00:00:00Z (placeholder) | – | – |
| Backup size | _to be measured_ | – | – |
| Backup wall-clock | _to be measured_ | – | – |
| Restore wall-clock (drop + load + alembic) | _to be measured_ | – | – |
| Restore wall-clock (full, including `/healthz` green) | _to be measured_ | < 3600s (1h) | – |
| Data integrity check (row counts pre vs post) | _to be measured_ | 0 diff | – |
| RPO achieved | _to be measured_ | < 24h | – |
| RTO achieved | _to be measured_ | < 4h | – |

## How to run

```bash
docker compose up -d postgres redis keycloak
bash scripts/backup-postgres.sh --env=dev
ls -lh infra/backups/

# Drop the live DB, then restore:
bash scripts/restore-postgres.sh --file=$(ls -t infra/backups/forge-dev-*.sql.gz | head -1)
```

## Acceptance

- **SC-7.3**: RPO ≤ 24h, RTO ≤ 4h.
- CI job `operational-readiness.yml::backup-restore-smoke` runs the
  round-trip on every push that touches the relevant scripts.
