---
title: Prerequisites
description: What to install before you boot Forge AI — Node, pnpm, Docker, Postgres, Redis, and an LLM API key.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/tech-stack.md
generator: readme
approval_required: false
---

The minimum and recommended tooling to run Forge AI. Pick the **minimum** for a dev quickstart; pick the **recommended** for a long-lived install.

## Toolchain

| Tool | Minimum | Recommended | Why |
| --- | --- | --- | --- |
| **Node.js** | 20 LTS | 22 LTS | Runtime for the orchestrator, Forge, and most MCP servers |
| **pnpm** | 9 | 9 (matches lockfile) | Workspace manager; lockfile is pnpm |
| **Python** | 3.12 | 3.12 | Agent runtime + evals |
| **Docker** | 24 | 27 + Compose v2 | Local Postgres + Redis + LocalStack |
| **Git** | 2.40 | latest | Monorepo |
| **Postgres client** | 15 | 16 | `psql` for debugging |
| **Redis client** | 7 | 7 | `redis-cli` for debugging |

### Verify

```bash
node --version    # v20.x or v22.x
pnpm --version    # 9.x
python3 --version # 3.12.x
docker --version  # 24+ (Compose v2 prints `docker compose version`)
psql --version    # 15+ or 16+
redis-cli --version
```

## LLM provider

Forge AI is **model-agnostic**, but the dev quickstart defaults to **Anthropic Claude Haiku 4.5** (cheapest tier).

| Provider | Default model | Cost (per 1M tokens, ~) | Notes |
| --- | --- | --- | --- |
| **Anthropic** *(primary)* | `claude-haiku-4-5` | $1 / $5 | Recommended. Best safety posture. |
| **Anthropic** *(premium)* | `claude-sonnet-4-6` | $3 / $15 | For harder reasoning. |
| **Anthropic** *(flagship)* | `claude-opus-4-8` | $15 / $75 | Reserved for ADRs + critical reasoning. |
| **OpenAI** *(backup)* | `gpt-4o` | $5 / $15 | Used when Anthropic is unavailable. |

Get an API key at <https://console.anthropic.com/>. Set it in your `.env`:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

:::caution[Cost ceiling]
Forge AI enforces a **$50/run hard ceiling**. Above that, a human approval is required to continue. See [Cost transparency →](/features/#cost-transparency).
:::

## Cloud account (production only)

For production self-hosting, you need an **AWS account** with permission to create:

- EKS cluster (or EC2 for single-node)
- RDS for Postgres 16
- ElastiCache for Redis 7
- S3 bucket (audit-log archive)
- KMS key (BYOK)
- Secrets Manager secrets
- IAM roles for cross-account audit shipping

See [Self-host on AWS →](/self-host/aws/) for the full Terraform.

## Optional: MCP server integrations

For each integration you want, you'll need the corresponding credentials. The minimum useful set is **Jira + GitHub**.

| Integration | What you need | Where to get it |
| --- | --- | --- |
| **Jira** | OAuth 2.0 (3LO) app | <https://developer.atlassian.com/> |
| **GitHub** | GitHub App (per-tenant) | <https://github.com/settings/apps/new> |
| **Confluence** | OAuth 2.0 (3LO) app | <https://developer.atlassian.com/> |
| **SonarQube** | Token | Your SonarQube instance → Account → Security |
| **Figma** | OAuth 2.0 app | <https://www.figma.com/developers/> |
| **AWS** | Cross-account IAM role | Your AWS account → IAM → Roles |
| **Slack** | OAuth 2.0 app | <https://api.slack.com/apps> |

See [Integrations →](/integrations/) for per-tool setup.

## Network egress

Forge AI's agent runtime makes outbound calls to:

- `api.anthropic.com` *(or `api.openai.com`)* — LLM provider
- `*.atlassian.net` — Jira, Confluence
- `api.github.com` — GitHub
- `*.amazonaws.com` — AWS API
- `*.sqs.<region>.amazonaws.com` — audit-account shipping

If you're behind a corporate proxy, set `HTTPS_PROXY` in the orchestrator's env.

## Hardware sizing

| Tier | vCPU | RAM | Storage | Concurrent runs | Cost (AWS, ~) |
| --- | --- | --- | --- | --- | --- |
| **Dev** (laptop) | 4 | 8 GB | 20 GB | 1 | $0 |
| **Single-node prod** | 4 | 16 GB | 100 GB | 10 | ~$200/mo |
| **EKS multi-tenant** | 8+ per pod | 16 GB+ | 500 GB+ | 100+ | ~$1,500/mo |

## Where to next

- **[Dev setup →](/installation/dev-setup/)** — bootstrap the repo, run the test suite, add an MCP server.
- **[Production deploy →](/installation/production/)** — single-node with Postgres + Redis.
- **[Self-host on AWS →](/self-host/aws/)** — the full EKS reference architecture.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([Forge AI-298](/Forge AI/issues/Forge AI-298))</dd>
  </dl>
</div>
