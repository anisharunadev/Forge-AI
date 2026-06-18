---
title: Environment variables
description: Every env var consumed by the orchestrator, agent runtime, Forge, and the MCP servers.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/tech-stack.md
generator: readme
approval_required: false
---

The complete reference for every environment variable consumed by the Forge AI platform. **Secrets never go in env** — they come from AWS Secrets Manager (or Doppler in dev). The list below is the **non-secret** configuration.

## Orchestrator (`apps/orchestrator`)

| Var | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `production` | Runtime mode |
| `PORT` | `4000` | HTTP port |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `DATABASE_URL` | — | Postgres connection string |
| `REDIS_URL` | — | Redis connection string |
| `STAGE_ENGINE_ADAPTER` | `in-process` | `in-process` (default) \| `grpc` (production target) |
| `STAGE_ENGINE_GRPC_URL` | — | gRPC URL when `STAGE_ENGINE_ADAPTER=grpc` |
| `TENANT_ISOLATION_MODE` | `strict` | `strict` (refuses cross-tenant) \| `audit-only` (logs and continues — dev only) |
| `COST_CEILING_USD` | `50` | Hard cap per run; above this, a human approval is required |
| `COST_WARN_USD` | `20` | Run logs a warning above this |
| `TOKEN_BUDGET` | `2000000` | Hard cap on prompt+completion tokens per run |
| `AUDIT_SQS_URL` | — | SQS URL in the audit account |
| `AUDIT_BATCH_SIZE` | `100` | Audit batch size |
| `AUDIT_FLUSH_MS` | `1000` | Audit flush interval |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP endpoint for traces (Tempo, Honeycomb, etc.) |
| `OTEL_SERVICE_NAME` | `orchestrator` | Service name in traces |

## Agent runtime (`apps/agent-runtime`)

| Var | Default | Description |
| --- | --- | --- |
| `PYTHON_ENV` | `production` | Runtime mode |
| `PORT` | `4001` | HTTP port |
| `ANTHROPIC_API_KEY` | — | (secret) Anthropic API key |
| `ANTHROPIC_DEFAULT_MODEL` | `claude-haiku-4-5` | Default model |
| `ANTHROPIC_PREMIUM_MODEL` | `claude-sonnet-4-6` | For harder reasoning |
| `ANTHROPIC_FLAGSHIP_MODEL` | `claude-opus-4-8` | For ADRs and critical reasoning |
| `OPENAI_API_KEY` | — | (secret, optional) OpenAI backup |
| `OPENAI_DEFAULT_MODEL` | `gpt-4o` | Backup model |
| `LLM_PROVIDER` | `anthropic` | `anthropic` \| `openai` \| `vllm` (v1.1) |
| `EGRESS_PROXY_URL` | — | The egress proxy the runtime uses for all outbound HTTP |
| `TOOL_OUTPUT_SANITISATION` | `true` | Wrap tool results in `<tool_output source="...">` |

## Forge console (`apps/forge`)

| Var | Default | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | — | The orchestrator's public URL |
| `NEXT_PUBLIC_TENANT` | — | The default tenant slug |
| `OIDC_ISSUER_URL` | — | Customer OIDC issuer |
| `OIDC_CLIENT_ID` | — | OIDC client ID |
| `OIDC_CLIENT_SECRET` | — | (secret) OIDC client secret |
| `OIDC_REDIRECT_URI` | — | OIDC callback URL |
| `FORGE_THEME` | `dark` | `dark` \| `light` \| `auto` |

## Per-MCP-server env

Every MCP server accepts the same baseline:

| Var | Description |
| --- | --- |
| `TENANT_ID` | The kebab-case tenant slug (e.g., `acme-corp`) |
| `MCP_NAMESPACE` | The MCP namespace (e.g., `mcp-acme-corp`) |
| `MCP_AUTH_*` | Per-tool auth (e.g., `MCP_AUTH_GITHUB_APP_ID`, `MCP_AUTH_GITHUB_PRIVATE_KEY`) |
| `MCP_RPS_LIMIT` | Requests-per-second limit (default 10) |
| `MCP_CIRCUIT_BREAKER_THRESHOLD` | Failures before opening the breaker (default 5) |
| `MCP_CIRCUIT_BREAKER_COOLDOWN_S` | Cooldown in seconds (default 30) |

## Tenant overrides

Per-tenant overrides live in `engagements/<customer-slug>/conventions.md` and are loaded by the orchestrator at boot. See [Customer conventions →](/reference/glossary/#tenant).

## Loading secrets

In dev: use a `.env` file (gitignored).

In staging/prod: use **AWS Secrets Manager** via the [Secrets Store CSI Driver](https://secrets-store-csi-driver.sigs.k8s.io/), or **Doppler** (dev/staging). The orchestrator, the agent runtime, and every MCP server read from `secret://<name>` paths.

```bash
# example: load a secret into the orchestrator's env
fora-cli secrets bind fora/orchestrator anthropic-api-key
```

## Where to next

- **[AWS reference architecture →](/self-host/aws/)** — full Terraform.
- **[Security → IAM →](/security/iam/)** — how secrets are scoped per tenant.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/tech-stack.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
