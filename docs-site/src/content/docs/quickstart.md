---
title: Quickstart
description: Run Forge AI in dev mode in under 5 minutes.
draft: false
last_generated_at: 2026-06-18T00:00:00Z
source_sha: forareal-final
source_path: workspace/project/PRD.md
generator: readme
approval_required: false
---

Get Forge AI running locally in under 5 minutes. This is the dev-mode quickstart — it boots the **Master Orchestrator**, the **Forge console**, and the **Documentation agent** with in-memory mocks so you can poke at the platform without provisioning AWS.

## Prerequisites

- **Node.js 20 LTS** or newer (Node 22 also works)
- **pnpm 9** or newer (`npm install -g pnpm`)
- **Docker Desktop** (for Postgres + Redis via docker-compose)
- **Git**

> **Model provider.** The dev quickstart uses **Anthropic Claude Haiku 4.5** by default (cheapest tier). You'll need an `ANTHROPIC_API_KEY` in your `.env`. You can swap providers in [Environment variables →](/self-host/environment/).

## 1. Clone & install

```bash
git clone https://github.com/fora-platform/fora.git
cd fora
pnpm install --frozen-lockfile
```

The monorepo has 6 apps and 12 packages. The install takes ~2 minutes on a cold cache.

## 2. Boot the local stack

```bash
# from the repo root
docker compose up -d                  # Postgres 16 + Redis 7 + LocalStack (AWS mocks)
pnpm --filter @fora/agent-runtime dev # Python agent runtime on :4001
pnpm --filter @fora/orchestrator dev  # TypeScript orchestrator on :4000
pnpm --filter @fora/forge dev         # Next.js Forge console on :3000
```

The first boot seeds the local DB with one demo tenant (`acme-corp`) and one demo run (`demo-run-001`) so you can click around without writing data.

## 3. Open the Forge console

Open <http://localhost:3000> in your browser.

You'll see three views:

| View | What it shows | What it's for |
| --- | --- | --- |
| **Product Manager** | PRDs, roadmaps, capacity | Read-mostly dashboards |
| **Engineering Lead** | Runs in flight, blocked work, cost | Read + approve |
| **CTO / VP Eng** | Throughput, MTTR, audit, cost by team | Read-only |

Switch personas via the avatar menu in the top-right.

## 4. Trigger your first run

```bash
# in another terminal, from the repo root
pnpm --filter @fora/forge cli run new \
  --tenant=acme-corp \
  --type=feature \
  --prompt="Add a /health endpoint to the API"
```

The Master Orchestrator wakes the Ideation agent, which produces a draft PRD. You'll see it appear in the **Forge → Ideation** tab.

## 5. Approve a stage

Open the draft PRD in the Forge console and click **Approve**. The Orchestrator wakes the Architect agent next.

Repeat the approve cycle through **Architect → Dev → QA → Security → DevOps → Docs**. Each stage's artefact appears in the Forge console as it's produced.

## 6. Inspect the audit log

```bash
pnpm --filter @fora/orchestrator cli audit list --run=demo-run-001
```

Every tool call, every secret read, every config change is logged with `tenant_id`, `run_id`, `stage`, `tool`, `actor`, and a SHA over the input. The audit log is append-only and ships to a separate account in production.

## What you've seen

✅ The **Master Orchestrator** woke a sub-agent and enforced the gate.
✅ The **staged workflow** moved a work item through all 7 stages.
✅ The **Knowledge Layer** read your tenant context to seed the run.
✅ The **audit log** captured every action.

## Where to next

- **[Install in production →](/installation/production/)** — Stand up Forge AI on EKS.
- **[Self-host on AWS →](/self-host/aws/)** — The reference architecture.
- **[Add an MCP integration →](/integrations/)** — Jira, GitHub, Confluence, more.
- **[Read the architecture →](/architecture/)** — How the pieces fit.

<div class="freshness-footer">
  <dl>
    <dt>Source SHA</dt><dd><code>forareal-final</code></dd>
    <dt>Source path</dt><dd><code>workspace/project/PRD.md</code> + <code>README.md</code></dd>
    <dt>Last generated</dt><dd>2026-06-18T00:00:00Z</dd>
    <dt>Generator</dt><dd><code>readme</code> · DocAgent v1.0 ([FORA-298](/FORA/issues/FORA-298))</dd>
  </dl>
</div>
