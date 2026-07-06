# Phase 8 — Disaster Recovery Drill Report

**Status:** PENDING — drill harness ready (`scripts/dr-drill.sh`),
awaiting staging run.

## Target

- **RTO:** 4 hours (14,400 seconds)
- **RPO:** 1 hour (hourly Postgres snapshot cadence)

## Steps

1. Pick a staging tenant with realistic data volume.
2. Capture pre-wipe row counts (audit_events, cost_entries, kg_nodes, ideation_ideas, stories).
3. Wipe the public schema.
4. Restore from the most recent S3 snapshot.
5. Capture post-restore row counts.
6. Diff pre/post — match expected.
7. Record elapsed time.

## RTO / RPO actual

_Filled in after the first successful drill._

## Follow-ups

- Cross-region restore automation (currently manual DNS cutover).
- Redis session recovery is best-effort; first-login may require re-auth.
- Object-storage (S3/MinIO) restore not yet wired into the harness.

## Run command

```bash
TENANT_SLUG=acme-corp bash scripts/dr-drill.sh
```
