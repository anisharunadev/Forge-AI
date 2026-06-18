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
cp .env.example .env                  # edit ANTHROPIC_API_KEY
./scripts/dev-up.sh                   # boots infra + apps + runs the smoke gate
```

`scripts/dev-up.sh` wraps `pnpm install`, `docker compose up -d`, `pnpm -r build`, `pnpm -r migrate`, and the four `pnpm --filter @fora/* dev` runs (agent-runtime, orchestrator, customer-cloud-broker, **forge**) into one command. It also runs the smoke test at the end and exits non-zero on any failure, so the boot is a single green-or-red signal. Re-run `./scripts/smoke.sh` any time to re-verify the stack.

The first boot takes ~2 minutes on a cold cache; subsequent boots are under 30 seconds because the pnpm store, docker layer cache, and named volumes (postgres, redis, localstack) are warm.

The first boot seeds the local DB with one demo tenant (`acme-corp`). The persona dashboards render against the orchestrator REST API; if no runs have been created yet they show the empty state. The seed run id the personas look for is `demo-run-001` — create one with `curl -X POST http://localhost:4000/v1/runs -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" -d '{"goal_id":"demo","project_id":"demo","triggered_by":{"type":"manual","actor":"quickstart"}}'` (see the [Orchestrator README](https://github.com/fora-platform/fora/blob/main/apps/orchestrator/README.md) for the full contract).

## 2. Open the Forge console

Open <http://localhost:3000> in your browser.

You'll see three views:

| View | What it shows | What it's for |
| --- | --- | --- |
| **Product Manager** | PRDs, roadmaps, capacity | Read-mostly dashboards |
| **Engineering Lead** | Runs in flight, blocked work, cost | Read + approve |
| **CTO / VP Eng** | Throughput, MTTR, audit, cost by team | Read-only |

If you don't see the Forge console at <http://localhost:3000>, run `./scripts/smoke.sh` to confirm the orchestrator (:4000), agent-runtime (:4001), customer-cloud-broker (:4003), and the Forge console itself (:3000, `/healthz` + `/personas/pm`) are all up. The smoke script is the green-or-red gate — if it's red, the stack is not fully booted and no Forge console will render.

Switch personas via the avatar menu in the top-right.

## 4. Trigger your first run

The Forge console is a read + operator shell; runs are created via the orchestrator REST API (`POST /v1/runs`). The Engineering Lead dashboard then renders the new run, and the timeline page (`/runs/<id>`) shows the seven stages as they progress.

```bash
# in another terminal, from the repo root — create a run for the seeded tenant
RUN_ID=$(curl -fsS -X POST http://localhost:4000/v1/runs \
  -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"goal_id":"demo","project_id":"demo","triggered_by":{"type":"manual","actor":"quickstart"}}' \
  | jq -r .id)
echo "Created run $RUN_ID — open http://localhost:3000/runs/$RUN_ID"
```

The Master Orchestrator wakes the Ideation agent, which produces a draft PRD. You'll see it appear in the **Forge → Ideation** tab.

## 5. Approve a stage

Open the draft PRD in the Forge console and click **Approve**. The Orchestrator wakes the Architect agent next.

Repeat the approve cycle through **Architect → Dev → QA → Security → DevOps → Docs**. Each stage's artefact appears in the Forge console as it's produced.

## 6. Inspect the audit log

The audit log is the JSONL file at `$FORA_AUDIT_LOG` (default `.fora/audit/tenancy-denied.jsonl`) and the broker audit at `$FORA_CCB_AUDIT_LOG_PATH` (default `.fora/audit/customer-cloud-broker.jsonl`). Read with `jq`:

```bash
tail -n 20 .fora/audit/customer-cloud-broker.jsonl | jq .
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
