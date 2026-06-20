---
title: Production deploy
description: Single-node production with Postgres + Redis. The smallest install that meets the SOC 2 Type I bar.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/tech-stack.md
generator: readme
approval_required: false
---

A **single-node** Forge AI install, suitable for one design partner on a single VM (e.g., `t3.large` or `m6i.xlarge`). This is the smallest install that meets the SOC 2 Type I bar (per [`customer/standards.md` §2](https://github.com/fora-platform/fora/blob/main/workspace/customer/standards.md)).

If you're a multi-tenant platform team, skip to [Self-host on AWS →](/self-host/aws/) for the EKS reference architecture.

## Architecture

```
                  ┌─────────────────────────────────┐
                  │      Forge AI single-node prod       │
                  │  (one VM, all processes co-located)│
                  ├─────────────────────────────────┤
                  │                                  │
   Internet  ─────►  CloudFront + WAF                │
                  │           │                      │
                  │           ▼                      │
                  │   Forge (Next.js) :3000          │
                  │   Orchestrator :4000             │
                  │   Agent Runtime :4001            │
                  │   MCP servers (1 per tool)       │
                  │           │                      │
                  │           ▼                      │
                  │   Postgres 16 + pgvector         │
                  │   Redis 7                        │
                  │   S3 (audit archive)             │
                  │   CloudWatch Logs                │
                  └─────────────────────────────────┘
                                  │
                                  ▼
                  ┌─────────────────────────────────┐
                  │  Audit account (separate)        │
                  │  SQS + S3 (append-only)          │
                  └─────────────────────────────────┘
```

The audit account is **separate** by policy — see [Multi-tenancy →](/architecture/multi-tenancy/).

## Provision the VM

Use Ubuntu 22.04 LTS or Amazon Linux 2023. Minimum:

| Resource | Minimum | Recommended |
| --- | --- | --- |
| vCPU | 4 | 8 |
| RAM | 16 GB | 32 GB |
| Storage | 100 GB gp3 | 250 GB gp3 (with 1000 IOPS) |
| Network | 1 Gbps | 5 Gbps |

```bash
# On the VM, as root
apt update && apt install -y docker.io docker-compose-v2 postgresql-client redis-tools
systemctl enable --now docker
```

## Provision Postgres + Redis

For single-node, you can run them on the same VM or split them out. We recommend **splitting them out** so a Postgres restart doesn't take down the agent runtime.

| Option | When to use | Cost (~) |
| --- | --- | --- |
| **Same VM** (Docker) | Quick demo | $0 |
| **RDS Postgres** + **ElastiCache Redis** | Real production | $200/mo |
| **Aurora Postgres** + **ElastiCache Redis** | Multi-AZ | $500/mo |

If you go with RDS:

```bash
aws rds create-db-instance \
  --db-instance-identifier fora-prod-pg \
  --db-instance-class db.t3.medium \
  --engine postgres --engine-version 16.2 \
  --master-username fora --master-user-password "$PG_PASSWORD" \
  --allocated-storage 100 --storage-type gp3 \
  --vpc-security-group-ids sg-... \
  --db-subnet-group-name fora-prod \
  --backup-retention-period 14 \
  --enable-cloudwatch-logs-exports postgresql \
  --tags Key=env,Value=prod Key=app,Value=fora
```

## Deploy the platform

We ship a `deploy.sh` that bootstraps a single-node install:

```bash
# from the VM
git clone https://github.com/fora-platform/fora.git /opt/fora
cd /opt/fora
./deploy.sh --env=prod --mode=single-node
```

The script:

1. Writes `.env` with the secrets from AWS Secrets Manager.
2. Runs `docker compose up -d` for the platform processes.
3. Runs the DB migrations.
4. Seeds the audit-account SQS consumer.
5. Configures the CloudWatch agent.
6. Wires `systemd` so the platform restarts on reboot.

## Configure environment

See [Environment variables →](/self-host/environment/) for the full list. The minimum for single-node prod:

```bash
# .env
NODE_ENV=production
DATABASE_URL=postgres://fora:$PG_PASSWORD@db...rds.amazonaws.com:5432/fora
REDIS_URL=redis://redis...use1.cache.amazonaws.com:6379/0

ANTHROPIC_API_KEY=sk-ant-...
Forge AI_AUDIT_SQS_URL=https://sqs.us-east-1.amazonaws.com/.../audit-log

# Optional: Slack/Teams webhook for alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

## Verify

```bash
# Health check
curl -fsS https://fora.example.com/healthz | jq

# Stage check
curl -fsS https://fora.example.com/api/v1/stages | jq

# Smoke run
./bin/fora-cli run new \
  --tenant=demo \
  --type=smoke \
  --prompt="Health check" \
  --wait
```

Expected output:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "stages": ["ideation", "architect", "dev", "qa", "security", "devops", "docs"],
  "model": "claude-haiku-4-5",
  "build_sha": "..."
}
```

## Configure backups

| Component | Backup strategy | Retention |
| --- | --- | --- |
| **Postgres** | RDS automated backups + daily snapshot to S3 | 14 days (RDS), 90 days (S3) |
| **Redis** | Daily RDB snapshot to S3 | 7 days |
| **S3 audit log** | Cross-region replication to `us-west-2` | 365 days (compliance) |
| **Secrets** | Secrets Manager rotation, 30-day cycle | forever |

## Set up monitoring

We ship a Grafana dashboard under `infra/grafana/`. Import it:

```bash
kubectl create configmap grafana-dashboards --from-file=infra/grafana/ \
  -n monitoring   # only if running EKS; on single-node, import via Grafana UI
```

Alerts (via CloudWatch → SNS → PagerDuty):

| Alert | Condition | Severity |
| --- | --- | --- |
| `OrchestratorDown` | No health check for > 2 min | S0 |
| `AuditAccountLag` | Audit SQS depth > 1000 for > 5 min | S1 |
| `CostOverrun` | A run > $50 mid-flight | S1 |
| `TenantIsolationBreach` | Any cross-tenant query | **S0 (page on-call)** |
| `MCPCircuitOpen` | An MCP server's breaker open for > 10 min | S2 |

## Where to next

- **[Self-host on AWS →](/self-host/aws/)** — the full EKS reference architecture.
- **[Environment variables →](/self-host/environment/)** — every env var.
- **[Security →](/security/)** — the threat model, IAM, and compliance posture.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/tech-stack.md</code> + <code>PRD.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
