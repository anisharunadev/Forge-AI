# Runbook: Disaster Recovery (Postgres + Object Storage)

Phase 8 SC-8.4. Covers RTO/RPO targets, backup cadence, restore
procedure, and the drill harness (`scripts/dr-drill.sh`).

## Targets

- **RTO (Recovery Time Objective):** 4 hours
- **RPO (Recovery Point Objective):** 1 hour
- **Backup cadence:** Postgres snapshot every 1h; object-storage
  (S3/MinIO) snapshot every 6h.
- **Backup retention:** 7 daily, 4 weekly, 3 monthly.

## Backup schedule

| Source | Tool | Cadence | Retention |
|---|---|---|---|
| Postgres (RDS) | `pg_dump` → S3 `forge-backups/postgres/` | hourly | 7d/4w/3mo |
| Object storage (S3/MinIO) | `aws s3 sync` → S3 `forge-backups/s3/` | every 6h | 7d/4w/3mo |
| Redis (sessions, audit chain) | AOF + RDB every 6h | 7d/4w/3mo |

The backup worker lives in `backend/app/services/scheduler/jobs/`
(separate from the launch-scope plan; Phase 7 ships the runner).

## Restore procedure

### 1. Verify scope

Confirm with the on-call channel which tenants are affected and
the target snapshot timestamp.

### 2. Identify the last-good snapshot

```bash
aws s3 ls forge-backups/postgres/ --recursive | sort | tail -1
```

### 3. Provision a clean DB

Spin a fresh RDS / Postgres instance.

### 4. Restore

```bash
# Download the snapshot.
aws s3 cp s3://forge-backups/postgres/<snapshot>.sql.gz /tmp/

# Restore.
gunzip -c /tmp/<snapshot>.sql.gz | psql "$DATABASE_URL"
```

### 5. Verify

```bash
# Row counts must match the pre-wipe baseline.
psql "$DATABASE_URL" -c "SELECT count(*) FROM audit_events;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM cost_entries;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM kg_nodes;"

# First-login smoke test.
curl -fsS https://forge.example.com/api/v1/forge/health
```

### 6. Cutover

Update the connection pool DNS / RDS endpoint to the restored
instance. Restart the backend pods.

## Drill

`scripts/dr-drill.sh` runs against a staging tenant. Snapshots
row counts, wipes the DB, restores from the most recent backup,
and asserts row counts match.

```bash
# Local: simulate against docker compose Postgres.
bash scripts/dr-drill.sh

# Staging:
TENANT_SLUG=acme-corp bash scripts/dr-drill.sh
```

The drill exits non-zero if:

- Pre-wipe row counts can't be captured.
- Restore takes longer than the RTO budget (4h).
- Any post-restore row count differs from the pre-wipe baseline.

## Files exist

- Runbook: `docs/runbooks/disaster-recovery.md` (this file)
- Drill harness: `scripts/dr-drill.sh`
- Drill report: `docs/plan/phase-8-dr-drill.md`

## Known limitations

- Redis state is restored last (sessions); first-login failures
  before Redis recovery are expected and tolerated.
- Cross-region restore is not yet automated; manual DNS cutover
  is required.
