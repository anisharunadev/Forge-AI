---
title: AWS reference architecture
description: The full Terraform for the Forge AI EKS reference architecture.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/tech-stack.md
generator: readme
approval_required: false
---

The full reference architecture for self-hosting Forge AI on AWS. Everything is in [`infra/terraform/`](https://github.com/fora-platform/fora/tree/main/infra/terraform).

## 1. Prerequisites

- AWS account(s) with **Organization** enabled.
- `aws-cli` v2.15+.
- `terraform` 1.9+.
- `kubectl` 1.29+.
- `helm` 3.14+.
- `argocd-cli` 2.10+.
- A domain you control (Route 53 hosted zone).
- An **Anthropic API key** (or OpenAI).

## 2. Bootstrap the accounts

```bash
# from infra/terraform/bootstrap/
terraform init
terraform apply \
  -var="org_name=your-corp" \
  -var="audit_account_email=audit@your-corp.com" \
  -var="platform_account_email=platform@your-corp.com"
```

This creates the AWS Organization, the audit account, the platform account, and the cross-account IAM roles for the audit shipping path.

## 3. Provision the platform account

```bash
# from infra/terraform/envs/prod/
terraform init
terraform apply \
  -var="env=prod" \
  -var="domain=fora.your-corp.com" \
  -var="audit_account_id=123456789012"
```

The apply takes ~25 minutes. It creates:

- 3-AZ VPC with public + private subnets
- EKS 1.29 cluster with managed node groups (Karpenter-ready)
- RDS Postgres 16 (Multi-AZ) with `pgvector` extension
- ElastiCache Redis 7 cluster
- S3 buckets (`fora-prod-artefacts`, `fora-prod-audit-archive`)
- KMS customer-managed keys
- Secrets Manager secrets with rotation
- CloudWatch log groups + dashboards
- Route 53 records + ACM certificates
- CloudFront distribution + AWS WAF

## 4. Configure secrets

```bash
# After terraform apply, populate the secrets
aws secretsmanager put-secret-value \
  --secret-id fora/prod/anthropic \
  --secret-string '{"api_key":"sk-ant-..."}'

aws secretsmanager put-secret-value \
  --secret-id fora/prod/jira \
  --secret-string '{"client_id":"...","client_secret":"...","redirect_uri":"https://fora.your-corp.com/oauth/jira/callback"}'
```

See [Environment variables →](/self-host/environment/) for the full list.

## 5. Deploy the platform via ArgoCD

```bash
# from infra/argocd/
argocd app create fora-prod \
  --repo https://github.com/your-corp/fora-config \
  --path prod/ \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace fora \
  --sync-policy automated

argocd app sync fora-prod
```

ArgoCD syncs the cluster state from `infra/argocd/<env>/`. Any drift in the cluster triggers an alert.

## 6. Verify

```bash
# Cluster health
kubectl get nodes
kubectl get pods -n fora

# Platform health
curl -fsS https://fora.your-corp.com/healthz | jq

# First run
fora-cli run new --tenant=demo --type=smoke --prompt="Health check" --wait
```

## What you got

- ✅ 3-AZ HA platform account
- ✅ Separate audit account (read-only from Forge AI)
- ✅ Per-tenant MCP namespace IAM
- ✅ Customer-managed KMS keys
- ✅ CloudWatch + Grafana dashboards
- ✅ ArgoCD GitOps sync
- ✅ PagerDuty alert routing

## What to wire next

1. **Customer SSO** — see [Identity & access →](/security/iam/#customer-sso).
2. **MCP integrations** — see [Integrations →](/integrations/).
3. **Backups** — RDS automated + S3 lifecycle + audit-bucket object lock.
4. **Disaster recovery** — see [Architecture → Multi-tenancy →](/architecture/multi-tenancy/#disaster-recovery).

## Cost

| Resource | Cost (~$ / mo) |
| --- | --- |
| EKS control plane | 73 |
| EKS worker nodes (3 × m6i.large) | 420 |
| RDS Postgres (db.r6g.large, Multi-AZ) | 380 |
| ElastiCache Redis (cache.r6g.large) | 320 |
| S3 + cross-region replication | 80 |
| KMS + Secrets Manager | 50 |
| CloudWatch + OTLP | 100 |
| Data transfer + CloudFront | 100 |
| **Total (estimate)** | **~$1,500 / mo** |

Add LLM costs on top: **median $5/run, p99 $20/run, hard ceiling $50/run**.

## Where to next

- **[Kubernetes (EKS) →](/self-host/kubernetes/)** — the Helm chart + ArgoCD wiring.
- **[Environment variables →](/self-host/environment/)** — every env var.
- **[Security →](/security/)** — the threat model, IAM, and compliance.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/tech-stack.md</code> + <code>workspace/memory/devops.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
