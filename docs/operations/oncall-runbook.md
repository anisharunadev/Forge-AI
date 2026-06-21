# Forge AI — On-Call Runbook (Day-2 Operations)

> **Purpose.** Day-2 operations runbook for the on-call engineer. Use this when you are paged.
>
> **Audience.** L1 on-call (rotating). L2 platform engineers and L3 architects reference this for handoff and escalation.
>
> **Cadence.** This runbook is consulted:
> 1. At the start of every on-call shift (read the relevant sections).
> 2. When paged (follow the alert-specific remediation).
> 3. After every page (post-incident notes per [rollback-procedures.md §PIR](rollback-procedures.md#post-incident-review-template)).

## On-Call Basics

### Shift

| Item | Value |
|---|---|
| Shift length | 1 week (Monday 09:00 → following Monday 09:00 local) |
| Handoff | Friday 16:00 local; 30-minute overlap with next on-call |
| Page routing | PagerDuty (or equivalent) — primary channel |
| Slack channel | `#forge-oncall` |
| Escalation channel | `#forge-oncall-escalation` (L2/L3) |

### Responsibilities

| Responsibility | SLA |
|---|---|
| Acknowledge page | ≤5 minutes |
| Triage alert | ≤15 minutes |
| Engage runbook remediation | ≤30 minutes |
| Escalate to L2 if remediation fails | ≤45 minutes |
| Write post-incident notes | End of shift |

### L1 → L2 → L3 → L4 Escalation

| Tier | Who | When to escalate |
|---|---|---|
| L1 | On-call (you) | Default starting point |
| L2 | Platform engineer | Remediation fails; or Tier 2 rollback triggers per [rollback-procedures.md](rollback-procedures.md) |
| L3 | Architect | Cross-cutting change; or Tier 2 rollback authorization |
| L4 | CISO delegate | Security incident per [incident-response.md](incident-response.md) |

L1 always engages the on-call channel. Escalation is documented in the alert + audit log.

## Health Check Endpoints

Health checks are the first thing to run when paged. Run them in this order.

| Endpoint | URL pattern | What it tells you |
|---|---|---|
| FastAPI liveness | `GET /health/live` | Backend is up |
| FastAPI readiness | `GET /health/ready` | Backend + dependencies are ready |
| PostgreSQL | `GET /health/db` | RDS reachable; connection pool OK |
| Redis | `GET /health/redis` | ElastiCache reachable; pub/sub working |
| LiteLLM Proxy | `GET /health/liveliness` (on proxy) | Proxy up; routes configured |
| Audit log | `GET /health/audit` | Audit log writer reachable; hash chain valid |
| Per-tenant health | `GET /health/tenant/<tenant_id>` | Tenant-specific health (RLS, connectors, cost) |

### Health Check Procedure

```bash
# Run all health checks in sequence
for endpoint in /health/live /health/ready /health/db /health/redis /health/audit; do
  echo "=== $endpoint ==="
  curl -sS -w "\nHTTP %{http_code}\n" "https://forge.example.com$endpoint"
done

# Per-tenant health
curl -sS "https://forge.example.com/health/tenant/<tenant_id>"
```

### Expected Results

| Endpoint | Healthy response | Failure mode |
|---|---|---|
| `/health/live` | 200 with `{"status":"live"}` | Backend down — page L2 |
| `/health/ready` | 200 with all dependencies `ok` | Backend degraded — page L2 |
| `/health/db` | 200 with pool stats | DB issue — see [PostgreSQL Connection Pool Exhausted](#postgresql-connection-pool-exhausted) |
| `/health/redis` | 200 with pub/sub lag in ms | Redis issue — see [Redis Pub/Sub Lag](#redis-pubsub-lag) |
| `/health/audit` | 200 with hash chain head | Audit issue — page L2 immediately |
| `/health/tenant/<id>` | 200 with per-tenant health | Tenant issue — investigate per alert |

## Common Alerts and Remediations

The alerts below are the most common pages. Each has a triage path and a remediation. If remediation fails, escalate per the tier table at the top of this runbook.

### LiteLLM Proxy Down

| Severity | Page |
|---|---|
| Critical | Yes — all `forge-*` commands that require LLM calls will fail |

#### Symptoms

- `/health/liveliness` on LiteLLM Proxy returns non-200.
- `forge-arch-new`, `forge-dev-build`, and similar commands return 5xx.
- Cost ledger has no new rows in the past 10 minutes.

#### Triage

| Step | Action |
|---|---|
| 1 | `curl https://litellm.example.com/health/liveliness` |
| 2 | Check ECS service status for LiteLLM |
| 3 | Check recent deploys or config changes |
| 4 | Check LiteLLM logs for the most recent error |

#### Remediation

| Step | Action | Owner |
|---|---|---|
| 1 | If LiteLLM process is hung, restart ECS service | L1 |
| 2 | If LiteLLM is up but unreachable from backend, check security groups | L2 |
| 3 | If LiteLLM is up but p99 latency is high, scale horizontally | L2 |
| 4 | If the underlying provider is down, engage failover per [ADR-005](../architecture/decisions/0005-litellm-proxy-provider-abstraction.md) | L3 |

#### Escalation

- If the proxy is down >15 minutes, escalate to L2.
- If the proxy is down >60 minutes, escalate to L3 and consider Tier-1 rollback per [rollback-procedures.md](rollback-procedures.md).

### PostgreSQL Connection Pool Exhausted

| Severity | Page |
|---|---|
| High | Yes — backend will reject new connections |

#### Symptoms

- `/health/db` reports pool exhaustion.
- Backend returns 503 on most endpoints.
- Audit log shows connection timeout errors.

#### Triage

| Step | Action |
|---|---|
| 1 | `SELECT count(*) FROM pg_stat_activity;` (via bastion) |
| 2 | Check for long-running queries |
| 3 | Check for connection leaks (idle in transaction) |
| 4 | Check RDS metrics (CPU, connections, IOPS) |

#### Remediation

| Step | Action | Owner |
|---|---|---|
| 1 | Terminate idle-in-transaction connections | L1 |
| 2 | Kill long-running queries | L1 (with care) |
| 3 | If pool is still exhausted, restart backend ECS service to release pool | L2 |
| 4 | If exhaustion is sustained, scale RDS up | L2 |

#### Escalation

- If the issue persists after one restart, escalate to L2.
- If multiple tenants are affected, escalate to L3.

### Redis Pub/Sub Lag

| Severity | Page |
|---|---|
| Medium | Yes — realtime updates will lag |

#### Symptoms

- `/health/redis` reports pub/sub lag >5s.
- WebSocket clients see stale data.
- Terminal Center shows delayed output.

#### Triage

| Step | Action |
|---|---|
| 1 | `redis-cli --latency -h <redis-host>` |
| 2 | Check ElastiCache metrics (CPU, memory, evictions) |
| 3 | Check for large pub/sub messages
| 4 | Check WebSocket connection count |

#### Remediation

| Step | Action | Owner |
|---|---|---|
| 1 | If lag is transient, monitor | L1 |
| 2 | If lag is sustained, restart affected WebSocket sessions | L1 |
| 3 | If ElastiCache is under memory pressure, scale up | L2 |
| 4 | If ElastiCache is failing over, monitor until stable | L1 |

#### Escalation

- If lag >30 minutes, escalate to L2.
- If lag correlates with data loss, escalate to L3 immediately.

### Terminal Session Leak (PTY Not Closed)

| Severity | Page |
|---|---|
| Medium | Yes — resource leak |

#### Symptoms

- Active terminal session count grows over time.
- Backend process count grows.
- `/health/ready` reports high session count.

#### Triage

| Step | Action |
|---|---|
| 1 | List active sessions: `SELECT count(*) FROM terminal_sessions WHERE status='active';` |
| 2 | Check for sessions with no recent activity |
| 3 | Check backend logs for PTY close errors |
| 4 | Check for orphaned subprocesses |

#### Remediation

| Step | Action | Owner |
|---|---|---|
| 1 | Force-close orphaned sessions via the admin endpoint | L1 |
| 2 | Investigate the root cause of the leak in [ADR-006](../architecture/decisions/0006-terminal-center-xterm-native-pty.md) PTY code | L2 |
| 3 | If the leak is in agent code, engage the agent owner for a fix | L3 |

#### Escalation

- If the leak persists after force-close, escalate to L2.
- If the leak is in production code, file a bug and engage L3 for prioritization.

### Cost Ledger Drift

| Severity | Page |
|---|---|
| High | Yes — cost attribution is broken |

#### Symptoms

- LiteLLM reports calls but cost_ledger has no matching rows.
- Per-tenant cost reports show flatlines.
- Cost anomaly alerts fire.

#### Triage

| Step | Action |
|---|---|
| 1 | Compare LiteLLM call count to cost_ledger row count over the same window |
| 2 | Check audit log for cost_ledger write failures |
| 3 | Check for clock skew between LiteLLM and PostgreSQL |
| 4 | Check the cost ledger writer process |

#### Remediation

| Step | Action | Owner |
|---|---|---|
| 1 | If the writer is down, restart it | L1 |
| 2 | If there is a backlog, replay missing rows from LiteLLM logs | L2 |
| 3 | If the drift is consistent, engage L3 to investigate the root cause | L3 |

#### Escalation

- If the drift is >1% of expected cost, escalate to L2.
- If the drift correlates with tenant billing, escalate to L3 and notify sponsor.

### RLS Bypass Attempt

| Severity | Page |
|---|---|
| Critical | Yes — security incident |

#### Symptoms

- Audit log shows queries with `tenant_id` mismatch.
- Error logs show RLS policy violations.
- Cross-tenant access alerts fire.

#### Triage

| Step | Action |
|---|---|
| 1 | Identify the affected user/connection |
| 2 | Snapshot the relevant audit log rows |
| 3 | Determine if the bypass was successful (data leaked) or blocked (policy denied) |
| 4 | Page L4 delegate immediately |

#### Remediation

**This is a security incident.** Follow [incident-response.md](incident-response.md). Do not attempt to remediate from this runbook alone.

#### Escalation

- Immediate L4 escalation.
- If confirmed cross-tenant leak, Tier-3 rollback per [rollback-procedures.md §Tier 3](rollback-procedures.md#tier-3-rollback-tenant-revert).

## Log Locations

| Log | Location | Retention | Owner |
|---|---|---|---|
| Backend application logs | CloudWatch `/ecs/forge-backend` | 30 days | Platform Engineer |
| LiteLLM Proxy logs | CloudWatch `/ecs/litellm-proxy` | 30 days | Platform Engineer |
| PostgreSQL logs | RDS log stream | 30 days | Platform Engineer |
| Redis logs | ElastiCache slow log | 14 days | Platform Engineer |
| Audit log (WORM) | PostgreSQL `audit_log` table + S3 mirror per [ADR-008](../architecture/decisions/0008-append-only-worm-audit-trail.md) | Permanent | L4 delegate |
| Nginx / ALB access logs | S3 `s3://forge-logs/alb/` | 90 days | Platform Engineer |
| WebSocket logs | CloudWatch `/ecs/forge-backend/ws` | 14 days | Platform Engineer |
| Terminal session logs (byte-level) | S3 `s3://forge-audit/terminal/<session_id>/` | Permanent (WORM) | L4 delegate |

## Metrics Dashboards (Grafana)

| Dashboard | URL pattern | Primary audience |
|---|---|---|
| Platform Overview | `https://grafana.example.com/d/forge-platform` | L1, L2 |
| Per-Tenant Health | `https://grafana.example.com/d/forge-tenant` | L2, Pilot Owner |
| LiteLLM Cost & Latency | `https://grafana.example.com/d/forge-litellm` | L2, Finance |
| Audit Log Integrity | `https://grafana.example.com/d/forge-audit` | L3, L4 |
| Approval Latency | `https://grafana.example.com/d/forge-approvals` | Pilot Owner, Architect |
| Cost Ledger Drift | `https://grafana.example.com/d/forge-cost` | L2, Finance |
| Cycle Tracking (P2/P4) | `https://grafana.example.com/d/forge-cycles` | Pilot Owner, Dev Lead |

### Key Panels to Watch

| Panel | Threshold |
|---|---|
| LiteLLM p99 latency | Alert >10s |
| PostgreSQL connection pool utilization | Alert >80% |
| Redis pub/sub lag | Alert >5s |
| Audit log hash chain drift | Alert any drift |
| Per-tenant weekly cost | Alert >80% of budget |
| Approval queue depth | Alert >5 items per gate |
| Terminal session count | Alert >200 active |

## On-Call Rotation Template

The rotation is managed in the on-call scheduling tool (PagerDuty or equivalent). The template below is the canonical schedule shape.

| Week | L1 On-Call | L1 Backup | L2 On-Call | L3 On-Call |
|---|---|---|---|---|
| W1 | Alice | Bob | Carol | Dan |
| W2 | Bob | Alice | Carol | Dan |
| W3 | Alice | Bob | Dan | Carol |
| W4 | Bob | Alice | Dan | Carol |

### Rotation Rules

| Rule | Reason |
|---|---|
| Two-person L1 rotation (primary + backup) | Avoid single-point-of-failure on vacation |
| L2 does not rotate weekly (1-2 week rotation) | Stability for platform issues |
| L3 does not rotate weekly (monthly rotation) | Stability for cross-cutting issues |
| L4 delegate is always available (no rotation) | Security incidents do not wait for shift changes |

### Shift Handoff Checklist

| # | Item | Verified by |
|---|---|---|
| 1 | Read the post-incident notes from the previous shift | Outgoing + incoming |
| 2 | Verify all alert routing is correct | Outgoing |
| 3 | Check open issues and ongoing incidents | Incoming |
| 4 | Review this runbook for any updates since last shift | Incoming |
| 5 | Confirm escalation contact info | Both |
| 6 | Sign handoff in the on-call log | Both |

## Escalation Contacts

| Tier | Primary | Backup | How to reach |
|---|---|---|---|
| L1 | On-call | Backup on-call | PagerDuty |
| L2 | Platform engineer | Secondary platform engineer | Phone (in PagerDuty escalation) |
| L3 | Architect | Secondary architect | Phone (in PagerDuty escalation) |
| L4 | CISO delegate | CISO | Phone (in PagerDuty escalation) |

All escalations are recorded in the incident audit log.

## Cross-References

- **Rollback procedures.** [rollback-procedures.md](rollback-procedures.md) — covers Tier 1/2/3 rollbacks once an alert has been triaged.
- **Incident response.** [incident-response.md](incident-response.md) — for security incidents.
- **Pilot phases.** [P0](pilot-p0-pre-pilot.md), [P1](pilot-p1-kickoff.md), [P1.5](pilot-p15-validation.md), [P2](pilot-p2-execution.md), [P3](pilot-p3-evaluation.md), [P4](pilot-p4-expansion.md) — each phase has its own alert expectations.
- **Success metrics.** [success-metrics.md](success-metrics.md) — KPIs that show up in the dashboards.
- **Architecture.** [ADR-006 Terminal Center](../architecture/decisions/0006-terminal-center-xterm-native-pty.md), [ADR-008 Append-only audit log](../architecture/decisions/0008-append-only-worm-audit-trail.md), [ADR-005 LiteLLM](../architecture/decisions/0005-litellm-proxy-provider-abstraction.md).
