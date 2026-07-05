# Forge AI — Disaster Recovery Runbook

> **Scope.** Operator-facing playbook for restoring the platform after a
> regional or data-plane disaster. For day-2 on-call remediation see
> [`oncall.md`](./oncall.md) and the deeper operations reference at
> [`../operations/oncall-runbook.md`](../operations/oncall-runbook.md).

## RTO/RPO Targets (committed)

| Scenario | RTO (recovery time) | RPO (data loss window) |
|---|---|---|
| Region failure | ≤ 4 hours | ≤ 24 hours |
| DB corruption | ≤ 4 hours | ≤ 24 hours (last good backup) |
| Redis loss | ≤ 30 minutes | 0 (rebuild from Postgres) |
| LiteLLM down | N/A (queue 503s per Phase 6) | N/A |

## Scenario 1 — Region failure

**Trigger.** AWS region `us-east-1` is unavailable.

**Detection.** `/healthz` returns `degraded` for every probe; AWS
Health Dashboard shows the region degraded.

**Mitigation.**
1. Confirm the failure is region-wide.
2. Page L3 architect + L4 delegate.
3. Spin up staging in `us-west-2` from Terraform state.
4. Restore Postgres from the most recent S3 backup (see
   [`backup-restore.md`](./backup-restore.md)).
5. Re-point DNS to the new region's load balancer; wait for TTL.
6. Verify `/healthz` returns `ok` on all 4 named probes.

**RTO target.** ≤ 4 hours.
**RPO target.** ≤ 24 hours.
**Owner.** L3 architect.

## Scenario 2 — DB corruption

**Trigger.** A migration corrupts data (column drop, accidental TRUNCATE).

**Detection.** Application logs show constraint violations; `/healthz`
returns `degraded` on `db_health`.

**Mitigation.**
1. **Stop the bleed.** Set `READ_ONLY_MODE=1` in the env file; reload.
2. Identify the last good backup.
3. Restore to a NEW database (do NOT drop the corrupted one until
   verified) using `scripts/restore-postgres.sh`.
4. Reconcile audit-log gaps from the audit-log S3 mirror.
5. Swap application traffic.
6. Open an incident ticket; PIR within 5 business days per
   [`incident-response.md`](./incident-response.md).

**RTO target.** ≤ 4 hours.
**RPO target.** ≤ 24 hours.
**Owner.** L2 platform engineer (with L3 review).

## Scenario 3 — Redis loss

**Trigger.** ElastiCache / Redis container loses its data.

**Detection.** `/healthz` returns `degraded` on `redis_health`; WS
clients see stale data.

**Mitigation.**
1. Verify Redis is actually down.
2. Restart: `docker compose restart redis` (dev) or AWS CLI (prod).
3. Re-warm caches.
4. Verify `/healthz` returns `ok` on `redis_health`.

**RTO target.** ≤ 30 minutes.
**RPO target.** 0.
**Owner.** L1 on-call.

## Scenario 4 — LiteLLM down

**Trigger.** LiteLLM Proxy is unreachable, returning 5xx.

**Detection.** `/healthz` returns `degraded` on `litellm_health`.

**Mitigation.**
1. Confirm: `curl http://litellm:4000/health/liveliness`.
2. If hung, restart: `docker compose restart litellm`.
3. If upstream provider is down, engage provider failover per ADR-005.
4. **Phase 6 budget guard** — backend serves 503 from its queue
   rather than admitting unbounded calls.
5. Escalate to L2 if down >15 min, L3 if down >60 min.

**RTO target.** N/A.
**RPO target.** N/A.
**Owner.** L1 on-call → L2 if prolonged.

## Cross-References

- [backup-restore.md](./backup-restore.md)
- [oncall.md](./oncall.md)
- [incident-response.md](./incident-response.md)
- [../operations/oncall-runbook.md](../operations/oncall-runbook.md)
