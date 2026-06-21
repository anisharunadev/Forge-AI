---
title: Production Deployment
description: Stand up a production-shaped Forge AI stack on AWS.
---

This guide walks through standing up a production-shaped Forge AI stack on AWS. It assumes you have an AWS account with admin access, a Route 53 hosted zone, and a Keycloak deployment strategy.

## What is this?

The full V1 topology, derived from the eight ADRs. This is what you stand up when a pilot tenant signs.

## Topology

```text
+--------------------------------+        +---------------------------------+
|      Primary AWS Account        |        |       Audit AWS Account          |
|                                 |        |                                  |
|  ECS Fargate cluster            |        |  RDS PostgreSQL 17               |
|   - FastAPI backend             |  --->  |   - audit_log (no RLS)           |
|   - LangGraph orchestrator      | mirror |   - S3 Object Lock anchors       |
|                                 |        |                                  |
|  RDS PostgreSQL 17              |        |  CloudTrail → S3 (Object Lock)   |
|   - Apache AGE                  |        |                                  |
|   - pgvector                    |        |                                  |
|   - RLS on every table          |        |                                  |
|   - audit_log (local copy)      |        |                                  |
|                                 |        |                                  |
|  ElastiCache Redis              |        |                                  |
|  S3 buckets (per-tenant CMK)    |        |                                  |
|  Secrets Manager (per-tenant)   |        |                                  |
|  KMS (per-tenant CMK)           |        |                                  |
|  CloudWatch                     |        |                                  |
|  LiteLLM Proxy (ECS service)    |        |                                  |
+--------------------------------+        +---------------------------------+
```

See [Architecture overview](/architecture/overview/) for the long-form description and [ADR-001](/architecture/adr-001-aws/) for the binding decision.

## Pre-requisites

- AWS account with admin access (or scoped Terraform apply role).
- Route 53 hosted zone for your domain.
- Terraform 1.5+.
- A Keycloak deployment (RDS-backed, multi-AZ) reachable from the ECS subnets.
- An Anthropic API key (or alternative LLM provider key).

## Phases

### Phase 1 — Network and accounts

Create:

- Two AWS accounts (primary + audit) under an AWS Organization.
- A VPC per account with /18 CIDR, public + private subnets across 3 AZs.
- VPC peering (or Transit Gateway) between the accounts for the audit mirror.
- Route 53 hosted zone + ACM certificate.

### Phase 2 — Data plane (primary account)

Provision:

- RDS PostgreSQL 17 with the `age` and `vector` extensions enabled.
- ElastiCache Redis (cluster mode disabled for V1).
- S3 buckets per service, encrypted with a CMK.
- Secrets Manager with per-tenant secrets.
- KMS CMK per tenant (or a single CMK with tenant aliases, depending on policy).
- ECS Fargate cluster with the FastAPI service.
- Application Load Balancer in front of the service.

### Phase 3 — LiteLLM Proxy (primary account)

Provision the LiteLLM Proxy as an ECS service:

- Reads `litellm_config.yaml` from S3.
- Holds virtual keys per tenant.
- Emits Prometheus metrics to a CloudWatch agent.
- Audited through its own access log.

See [ADR-005](/architecture/adr-005-litellm/) for the proxy's design constraints.

### Phase 4 — Audit plane (audit account)

Provision:

- RDS PostgreSQL 17 with the `audit_log` table only (no extensions needed beyond what's required for hash chain).
- S3 bucket with Object Lock (compliance mode).
- CloudTrail to S3 with cross-account delivery from the primary.
- Daily Lambda that computes the hash chain anchor and writes to S3.

See [ADR-008](/architecture/adr-008-worm-audit/) for the audit topology and chain construction.

### Phase 5 — Identity

Provision Keycloak:

- Realm per tenant (or one realm with tenant-aware clients).
- OIDC clients for the backend and the frontend.
- SAML federation if the tenant requires it.
- Roles: `user`, `admin`, `steward`, `security_reviewer`, `architect`, `release_manager`.

### Phase 6 — Observability

Provision:

- CloudWatch log groups per service.
- ADOT (AWS Distro for OpenTelemetry) collector in each ECS task.
- Dashboards for: LiteLLM cost by tenant, approval latency, deployment latency, error budgets.
- Alarms: cost > budget envelope, hash chain anchor failure, deploy error rate spike.

### Phase 7 — Frontend

Provision:

- Next.js 15 build → S3 + CloudFront.
- WAF in front of CloudFront.
- Route 53 alias to the CloudFront distribution.

### Phase 8 — First tenant

- Provision a per-tenant CMK in KMS.
- Provision a per-tenant prefix in Secrets Manager.
- Insert the tenant row.
- Issue the first virtual key in the LiteLLM Proxy.
- Run `forge-onboard-bootstrap` (admin) to seed the project intelligence and connectors.

## Verification

After Phase 8:

```bash
curl https://api.forge-ai.com/api/v1/health
curl https://api.forge-ai.com/api/v1/audit/count

pnpm forge:exec forge-onboard-welcome \
  --args '{"tenant_id":"acme-corp","project_id":"acme-api"}' \
  --tenant-id acme-corp --project-id acme-api --user-id admin@acme.com
```

The health check returns 200, the audit count grows as commands run, and `forge-onboard-welcome` produces a populated dashboard.

## Rollback

If a deploy breaks prod, `forge-deploy-rollback` is the standard path. See [Rollback procedures](/operations/rollback/) for the full runbook.

## When to use this guide

Use this guide when:

- Standing up a new production tenant.
- Re-provisioning after a disaster recovery event.
- Auditing your topology against the eight ADRs.

Don't use this guide for local development — use [Local setup](/guides/local-setup/).

## Related

- [Architecture overview](/architecture/overview/)
- [ADR-001: AWS-only deployment](/architecture/adr-001-aws/)
- [ADR-002: PostgreSQL + AGE + pgvector](/architecture/adr-002-postgres-age/)
- [ADR-008: Append-only WORM audit](/architecture/adr-008-worm-audit/)
- [Rollback procedures](/operations/rollback/)
