# Forge AI — Backup & Restore (thin canonical)

> **Purpose.** Operator-facing entry-point for database backup and
> restore. The authoritative scripts are:

- [`../../scripts/backup-postgres.sh`](../../scripts/backup-postgres.sh) — `pg_dump` to `infra/backups/`
- [`../../scripts/restore-postgres.sh`](../../scripts/restore-postgres.sh) — drop + recreate + load + alembic + `/healthz`

## Quick reference

```bash
# Daily backup (no S3 mirror)
scripts/backup-postgres.sh --env=dev

# Mirror to S3 (prod)
scripts/backup-postgres.sh --env=prod --s3

# Restore from the most recent local backup
scripts/restore-postgres.sh --env=dev --file=$(ls -t infra/backups/forge-dev-*.sql.gz | head -1)

# Restore from S3
scripts/restore-postgres.sh --env=prod --s3-key=forge-prod-20260101T000000Z.sql.gz
```

## Targets (Phase 7 SC-7.3)

| Metric | Target |
|---|---|
| RPO | ≤ 24 hours |
| RTO | ≤ 4 hours |

## See also

- [disaster-recovery.md](./disaster-recovery.md) — DB corruption scenario
