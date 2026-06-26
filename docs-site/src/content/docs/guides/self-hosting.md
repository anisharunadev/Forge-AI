---
draft: false
title: Self-hosting
description: Run Forge AI in your own cloud — Docker Compose, Helm, Terraform, and air-gapped installs.
---

import { Icon } from '../../../components/Icon.astro';
import Callout from '../../../components/Callout.astro';
import CommandExample from '../../../components/CommandExample.astro';

Forge AI ships in three self-hosted flavors:

1. **Docker Compose** — single-host, dev-friendly.
2. **Helm chart** — Kubernetes, multi-node production.
3. **Terraform module** — full AWS / GCP / Azure provisioning.

## Docker Compose

```bash
git clone https://github.com/forge-ai/forge-ai
cd forge-ai
cp .env.example .env && $EDITOR .env
docker compose up -d
```

Components:

- Postgres 17 with pgvector + Apache AGE
- Redis 7
- FastAPI backend (ECS-ready container)
- Next.js dashboard
- LiteLLM proxy
- LiteMCP server (for MCP integrations)

<CommandExample command="docker compose ps" description="List running services." />
<CommandExample command="docker compose logs -f backend" description="Tail backend logs." />
<CommandExample command="docker compose down && docker compose up -d" description="Restart the stack." />

## Helm chart

```bash
helm repo add forge-ai https://forge-ai.github.io/helm
helm install forge forge-ai/forge-ai \
  --namespace forge --create-namespace \
  --values values.yaml
```

`values.yaml` lets you configure:

- Replica counts per component
- RDS / ElastiCache endpoints
- KMS key IDs
- LiteLLM provider keys
- Ingress + cert-manager

<Callout type="info" title="Production-grade defaults">
  The Helm chart ships with sensible defaults: 3 backend replicas, 2 LiteLLM
  replicas, horizontal pod autoscaling, and pod disruption budgets.
</Callout>

## Terraform module

For full cloud provisioning:

```hcl
module "forge_ai" {
  source  = "forge-ai/forge-ai/aws"
  version = "~> 2.0"

  tenant_name        = "acme"
  region             = "us-east-1"
  vpc_id             = "vpc-..."
  db_password        = var.db_password
  anthropic_api_key  = var.anthropic_api_key
}
```

Provisions: ECS Fargate, RDS PostgreSQL, ElastiCache Redis, S3 + KMS, LiteLLM
on EC2, ALB + Route53, IAM roles.

## Air-gapped installs

For air-gapped environments:

1. Pull the Docker images to a registry mirror.
2. Sync the LiteLLM model registry (or use Bedrock / Vertex in your VPC).
3. Run the Terraform / Helm deploy with `--set airgap.enabled=true`.
4. Replace outbound calls with VPC-internal endpoints.

<Callout type="warning" title="Audit requirements">
  Air-gapped installs still emit audit events — they land in the tenant's local
  S3 bucket, not a SaaS sink.
</Callout>

## Where to next

- [Quickstart](/start-here/quickstart/) — local Docker Compose.
- [Production deploy](/guides/production-deploy/) — Helm + Terraform.
- [Concepts → Multi-tenancy](/concepts/multi-tenancy/) — per-tenant isolation.
