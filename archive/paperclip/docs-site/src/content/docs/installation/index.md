---
title: Installation overview
description: Three paths to install Forge AI — local dev mode, single-node production, and a multi-tenant EKS cluster.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/tech-stack.md
generator: readme
approval_required: false
---

Three ways to install Forge AI, in increasing order of commitment:

| Path | Audience | Time | Where |
| --- | --- | --- | --- |
| **Dev mode** | Curious, evaluating | 5 min | Your laptop, docker-compose |
| **Single-node prod** | Single-tenant design partner | ~30 min | One VM (e.g., `t3.large`) with Postgres + Redis |
| **Multi-tenant EKS** | Production, multi-customer | ~2 h | AWS EKS cluster + RDS + ElastiCache |

:::tip[Pick one]
If you just want to **see Forge AI work**, start with [Quickstart →](/quickstart/) (dev mode). If you're a **design partner**, jump to [Self-host on AWS →](/self-host/aws/). If you're a **platform engineer** setting up multi-tenant production, read the [Self-hosting overview →](/self-host/) and then [AWS reference architecture →](/self-host/aws/).
:::

## What every install needs

Regardless of path, every Forge AI install requires:

1. **Postgres 16** — primary OLTP + `pgvector` for embeddings. RDS or self-hosted.
2. **Redis 7** — BullMQ queues, sessions, idempotency keys, rate limiting. ElastiCache or self-hosted.
3. **An LLM API key** — Anthropic Claude (recommended) or OpenAI. Set in the orchestrator's env.
4. **An AWS account** *(only for prod)* — for the audit-account boundary, Secrets Manager, KMS, and the S3 audit-log archive.

## What every install produces

A running instance of:

- **The Orchestrator** (`apps/orchestrator`) — the TypeScript brain, port `:4000`.
- **The Agent Runtime** (`apps/agent-runtime`) — the Python workers, port `:4001`.
- **The Forge console** (`apps/forge`) — the Next.js web UI, port `:3000`.
- **The MCP servers** (`mcp-servers/*`) — one process per tool, in per-tenant namespaces.

Each component logs to stdout in structured JSON and ships to CloudWatch (or Loki) via the OTLP exporter.

## Decision tree

```
Where will you run Forge AI?
├── On my laptop
│   └── Dev mode → /quickstart/
│
├── On one VM, one tenant
│   └── Single-node prod → /installation/production/
│
├── On AWS EKS, multi-tenant
│   └── Self-host on AWS → /self-host/aws/
│
└── On Azure or GCP
    └── Roadmap (Q2 2027). For now, AWS only. /security/iam/#cloud-providers
```

## Where to next

- **[Prerequisites →](/installation/prerequisites/)** — what to install before you begin.
- **[Dev setup →](/installation/dev-setup/)** — local development, including how to add a new MCP server.
- **[Production deploy →](/installation/production/)** — single-node production with Postgres + Redis.
- **[Self-host on AWS →](/self-host/aws/)** — the full EKS reference architecture.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/tech-stack.md</code> + <code>PRD.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
