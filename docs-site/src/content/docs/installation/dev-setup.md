---
title: Dev setup
description: Bootstrap the repo, run the test suite, add a new MCP server. The contributor-friendly guide.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/tech-stack.md
generator: readme
approval_required: false
---

This is the contributor-friendly guide. If you want to **run Forge AI** as a user, jump to [Quickstart →](/quickstart/). If you want to **hack on Forge AI** (build a new agent, add a new MCP integration, ship a fix), read on.

## Bootstrap

```bash
git clone https://github.com/fora-platform/fora.git
cd fora
pnpm install --frozen-lockfile        # ~2 min on a cold cache
pnpm -r build                         # builds every package once
docker compose up -d                  # Postgres + Redis + LocalStack
```

The first `pnpm -r build` is slow (TypeScript + Python wheel builds). Subsequent builds are incremental.

## Project layout

```
fora/                                  # the monorepo
├── apps/
│   ├── agent-runtime/                 # Python agent execution layer
│   ├── orchestrator/                  # TypeScript Master Orchestrator
│   ├── forge/                         # Next.js customer-facing console
│   ├── customer-cloud-broker/         # per-tenant IAM broker
│   ├── event-bus-bridge/              # cross-account event shipping
│   └── identity-broker/               # SSO + IdP integration
├── agents/                            # the sub-agent implementations
│   ├── ideation/  architect/  development/  qa/  security/
│   ├── devops/  documentation/  memory_mcp/  audit/  cost/
├── mcp-servers/                       # MCP server implementations
│   ├── jira/  github/  confluence/  sonarqube/  figma/
│   ├── aws/  slack/  arch-analyzer/  secrets/
├── packages/
│   ├── contracts/                     # stage-to-stage handoff JSON schemas
│   ├── evals/                         # safety + capability eval set
│   └── ui/                            # shared React components
├── workspace/                         # the Knowledge Layer (markdown-as-source-of-truth)
│   ├── customer/   project/   memory/
├── infra/                             # Terraform + Helm + ArgoCD
├── docs-site/                         # ← this Astro docs site
└── README.md
```

## Run the test suite

```bash
# from the repo root
pnpm -r test                          # unit + integration for every package
pnpm test:e2e                         # Playwright end-to-end (requires docker compose)
pnpm test:safety                      # the LLM safety eval set (LLM01–LLM10)
pnpm test:golden                      # golden-trace regression for the staged workflow
```

The four layers of the test pyramid (per [`memory/coding.md` §5](https://github.com/fora-platform/fora/blob/main/workspace/memory/coding.md)) are:

1. **Unit** — every package, fast (≤ 5 s total).
2. **Integration** — service-to-service, requires docker compose.
3. **E2E** — Playwright, the user journey from Slack message to merged PR.
4. **Eval** — the prompt / contract / agent-loop evals. The safety subset is gated.

## Add a new MCP server

MCP servers live in `mcp-servers/<tool>/`. To add one, e.g., `linear`:

```bash
mkdir -p mcp-servers/linear/{src,test}
pnpm init
# ... write src/index.ts ...
```

The contract is:

```typescript
import { createServer } from '@modelcontextprotocol/sdk/server';

export const server = createServer({
  name: 'fora-linear',
  version: '0.1.0',
});

server.tool(
  'create_issue',
  'Create a Linear issue',
  {
    title: { type: 'string' },
    teamId: { type: 'string' },
  },
  async ({ title, teamId }, ctx) => {
    // tenant_id is on ctx.tenant; auth is on ctx.auth
    const client = await getLinearClient(ctx.tenant, ctx.auth);
    const issue = await client.createIssue({ title, teamId });
    ctx.audit.log({ tool: 'create_issue', input: { title, teamId }, output: { id: issue.id } });
    return issue;
  },
);
```

Then register it in `apps/orchestrator/src/mcp/registry.ts` and add a per-tenant namespace entry to `infra/terraform/modules/mcp-namespace/`.

## Add a new agent stage

Adding a stage is a **one-way door** and requires an ADR + CTO sign-off (per [`memory/architecture.md` §3](https://github.com/fora-platform/fora/blob/main/workspace/memory/architecture.md)). Don't.

## Lint + typecheck

```bash
pnpm lint                             # ESLint + Prettier (TS packages)
pnpm typecheck                        # tsc --noEmit for every TS package
ruff check .                          # Python lint
mypy apps/agent-runtime               # Python type check
```

Pre-commit hooks (`.pre-commit-config.yaml`) run `gitleaks`, `prettier`, `ruff`, and `tsc` automatically on every commit.

## Where to next

- **[Production deploy →](/installation/production/)** — single-node with Postgres + Redis.
- **[Self-host on AWS →](/self-host/aws/)** — the EKS reference architecture.
- **[Integrations →](/integrations/)** — Jira, GitHub, Confluence, more.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/tech-stack.md</code> + <code>README.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
