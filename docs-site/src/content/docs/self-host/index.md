---
title: Self-hosting overview
description: Run Forge AI inside your own AWS account, with EKS, RDS, ElastiCache, and an audit-account boundary.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/tech-stack.md
generator: readme
approval_required: false
---

Self-hosting Forge AI means running the platform **inside your own AWS account** with full data sovereignty. This is the **default** for design partners and required for any production use of Forge AI in a regulated industry.

## Why self-host

- **Data stays in your account.** The platform, the audit log, the secrets, and the per-tenant MCP namespaces all live in your AWS organization.
- **You own the auth.** SSO via your own OIDC provider (Okta, Google Workspace, Azure AD, JumpCloud).
- **You own the model provider.** Pick Anthropic, OpenAI, or self-hosted (v1.1).
- **You own the audit log.** The log ships to a **separate** AWS account (the audit account) that Forge AI cannot read.

## The reference architecture

```
                            ┌─────────────────────────┐
                            │   your-corp-org (AWS)    │
                            └─────────────┬───────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
    ┌─────────▼─────────┐       ┌─────────▼─────────┐        ┌─────────▼─────────┐
    │  Platform account │       │  Audit account    │        │ Customer accounts │
    │  (prod)           │       │  (separate)       │        │  (per-tenant, opt)│
    ├───────────────────┤       ├───────────────────┤        ├───────────────────┤
    │  EKS cluster      │       │  SQS + S3         │        │  EKS namespaces   │
    │  RDS Postgres 16  │◄──────│  (append-only)    │◄───────│  (per-tenant MCP) │
    │  ElastiCache 7    │       │  KMS (CMK)        │        │  Customer IAM     │
    │  S3 (artefacts)   │       └───────────────────┘        │  Customer Secrets  │
    │  KMS (CMK)        │                                    └───────────────────┘
    │  Secrets Manager  │
    │  CloudWatch + OTLP│
    └───────────────────┘
              │
              ▼
    ┌───────────────────┐
    │  LLM provider     │
    │  (Anthropic /     │
    │   OpenAI / self)  │
    └───────────────────┘
```

Three accounts minimum. **The audit account boundary is non-negotiable** — see [Multi-tenancy →](/architecture/multi-tenancy/).

## What's in the Terraform

The reference architecture is defined in `infra/terraform/`:

| Module | What it creates |
| --- | --- |
| `modules/vpc/` | 3-AZ VPC, public + private subnets, NAT, flow logs |
| `modules/eks/` | EKS 1.29 cluster, managed node groups, IRSA roles |
| `modules/rds/` | RDS Postgres 16 (Multi-AZ), pgvector extension |
| `modules/elasticache/` | ElastiCache Redis 7 cluster |
| `modules/s3/` | S3 buckets for artefacts + audit archive (cross-region replication) |
| `modules/kms/` | Customer-managed keys per environment |
| `modules/secrets/` | Secrets Manager with 30-day rotation |
| `modules/audit-account/` | SQS + S3 + IAM role for cross-account audit shipping |
| `modules/mcp-namespace/` | Per-tenant IAM roles + Secrets Manager entries |
| `modules/argocd/` | ArgoCD ApplicationSet, GitOps sync |

## What you operate

After `terraform apply`, you operate:

- **EKS cluster** — ArgoCD syncs the workloads; Karpenter scales node groups.
- **RDS** — automated backups, point-in-time recovery, Performance Insights.
- **ElastiCache** — cluster mode, daily snapshots.
- **S3** — lifecycle rules, cross-region replication, object lock (audit bucket).
- **KMS** — key rotation, key policies, audit.
- **Secrets Manager** — rotation, least-privilege access.
- **CloudWatch + Grafana** — metrics, logs, traces via OTLP.
- **PagerDuty** — the alert path.

## Sizing

| Concurrent runs | EKS nodes | RDS class | Redis class | Cost (~$ / mo) |
| --- | --- | --- | --- | --- |
| 10 | 3 × m6i.large | db.t3.medium | cache.t3.medium | 800 |
| 50 | 6 × m6i.xlarge | db.r6g.large | cache.r6g.large | 2,500 |
| 100+ | 12+ × m6i.2xlarge | db.r6g.xlarge | cache.r6g.xlarge | 5,000+ |

## Where to next

- **[AWS reference architecture →](/self-host/aws/)** — the full Terraform.
- **[Kubernetes (EKS) →](/self-host/kubernetes/)** — the Helm chart + ArgoCD wiring.
- **[Environment variables →](/self-host/environment/)** — every env var.
- **[Security →](/security/)** — the threat model + IAM + secrets + compliance.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
